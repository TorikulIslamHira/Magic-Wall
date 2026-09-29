using MagicWall.Api.Hubs;

namespace MagicWall.Api.Hosting;

/// <summary>
/// The two listening ports. The presenter port faces the studio floor (wall screens, touch
/// displays); the admin port is for the control room and can be firewalled separately.
/// </summary>
public sealed class PortOptions
{
    public const string Section = "Ports";

    /// <summary>Wall and interactive hub: public pages, read-only API, SignalR.</summary>
    public int Presenter { get; set; } = 8080;

    /// <summary>Control room: admin dashboard, sign-in and every write endpoint.</summary>
    public int Admin { get; set; } = 8081;
}

/// <summary>
/// Keeps the presenter port read-only. It is an allow-list: anything not listed here
/// (the admin dashboard and its scripts, sign-in, approval queues, every write) answers 404
/// on the presenter port, including files and endpoints added later, until they are listed.
/// The admin port serves everything, so the dashboard's live preview can load the wall.
/// </summary>
public static class PortIsolation
{
    private static readonly HashSet<string> PresenterFiles = new(StringComparer.OrdinalIgnoreCase)
    {
        "/", "/favicon.ico",
        "/interactive-hub.html", "/magic-wall.html",
        "/css/wall.css", "/css/fonts.css",
        "/config/parties.json",
        // Shared modules the wall and hub import (admin.js, review.js, field.js, users.js, admin-ui.js are not here).
        "/js/api.js", "/js/dom.js", "/js/i18n.js", "/js/stage.js", "/js/wall.js", "/js/hub.js",
        "/js/fullscreen.js", "/js/geo.js", "/js/palette.js", "/js/parties.js", "/js/pitch.js"
    };

    private static readonly string[] PresenterFolders = ["/js/views/", "/lib/", "/maps/", "/fonts/"];

    /// <summary>Read-only endpoints the presenter pages call. GET/HEAD only.</summary>
    private static readonly HashSet<string> PresenterReads = new(StringComparer.OrdinalIgnoreCase)
    {
        "/api/wall/state",
        "/api/election/constituencies", "/api/election/candidates",
        "/api/sports/matches", "/api/sports/players",
        "/api/war/zones",
        "/api/budget/sectors", "/api/budget/fiscal-years"
    };

    private static readonly string[] PresenterReadPrefixes =
    [
        "/api/election/results/", "/api/sports/events/", "/api/war/timeline/"
    ];

    public static bool IsAllowedOnPresenter(HttpRequest request)
    {
        var path = request.Path.Value ?? "/";

        // SignalR: negotiate is a POST, and the hub has no client-callable methods (push only).
        if (path.Equals(MagicWallHub.Route, StringComparison.OrdinalIgnoreCase)
            || path.StartsWith(MagicWallHub.Route + "/", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (!HttpMethods.IsGet(request.Method) && !HttpMethods.IsHead(request.Method)) return false;

        // No ".." tricks: static files resolve normalised paths, but refuse them outright anyway.
        if (path.Contains("..", StringComparison.Ordinal)) return false;

        return PresenterFiles.Contains(path)
            || PresenterReads.Contains(path)
            || PresenterFolders.Any(f => path.StartsWith(f, StringComparison.OrdinalIgnoreCase))
            || PresenterReadPrefixes.Any(p => path.StartsWith(p, StringComparison.OrdinalIgnoreCase));
    }

    public static bool IsPresenterPort(this HttpContext context, PortOptions ports) =>
        context.Connection.LocalPort == ports.Presenter;

    /// <summary>Must run before static files, authentication and endpoints.</summary>
    public static IApplicationBuilder UsePortIsolation(this IApplicationBuilder app, PortOptions ports, ILogger logger) =>
        app.Use(async (context, next) =>
        {
            if (context.IsPresenterPort(ports) && !IsAllowedOnPresenter(context.Request))
            {
                // 404, not 403: the presenter network shouldn't learn what exists on the admin side.
                logger.LogInformation("Presenter port refused {Method} {Path} from {Client}",
                    context.Request.Method, context.Request.Path, context.Connection.RemoteIpAddress);
                context.Response.StatusCode = StatusCodes.Status404NotFound;
                return;
            }
            await next();
        });
}
