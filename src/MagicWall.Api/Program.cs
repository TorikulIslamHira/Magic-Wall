using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using MagicWall.Api.Auth;
using MagicWall.Api.Data;
using MagicWall.Api.Hosting;
using MagicWall.Api.Hubs;
using MagicWall.Api.Modules.Budget;
using MagicWall.Api.Modules.Election;
using MagicWall.Api.Modules.Geopolitics;
using MagicWall.Api.Modules.Sports;
using MagicWall.Api.Modules.Sports.Feed;
using MagicWall.Api.Wall;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

var builder = WebApplication.CreateBuilder(args);

// ---------- two ports: presenter (read-only, studio floor) and admin (control room) ----------
var ports = builder.Configuration.GetSection(PortOptions.Section).Get<PortOptions>() ?? new PortOptions();
if (ports.Presenter == ports.Admin)
{
    throw new InvalidOperationException($"Ports:Presenter and Ports:Admin must differ (both are {ports.Presenter}).");
}
builder.WebHost.ConfigureKestrel(kestrel =>
{
    kestrel.ListenAnyIP(ports.Presenter);
    kestrel.ListenAnyIP(ports.Admin);
});

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("MagicWall")));

// Enums go over the wire as names ("Goal", "Football"), not numbers,
// for both REST responses and SignalR messages.
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

builder.Services.AddSignalR()
    .AddJsonProtocol(options =>
        options.PayloadSerializerOptions.Converters.Add(new JsonStringEnumConverter()));

builder.Services.AddSingleton<WallStateStore>();

// ---------- authentication & roles ----------
// Newsroom staff sign in (cookie); scripts and the transition-period dashboard use X-Admin-Key.
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Cookie.Name = "magicwall.auth";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Strict;   // also blocks cross-site request forgery
        options.ExpireTimeSpan = TimeSpan.FromHours(12);   // one shift
        options.SlidingExpiration = true;
        // An API answers 401/403; it never redirects to a login page.
        options.Events.OnValidatePrincipal = AuthEndpoints.ValidateSessionAsync;
        options.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = StatusCodes.Status401Unauthorized; return Task.CompletedTask; };
        options.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = StatusCodes.Status403Forbidden; return Task.CompletedTask; };
    })
    .AddScheme<AuthenticationSchemeOptions, AdminKeyAuthenticationHandler>(AdminKeyAuthenticationHandler.SchemeName, null);

string[] schemes = [CookieAuthenticationDefaults.AuthenticationScheme, AdminKeyAuthenticationHandler.SchemeName];
builder.Services.AddAuthorization(options =>
{
    options.DefaultPolicy = new AuthorizationPolicyBuilder(schemes).RequireAuthenticatedUser().Build();
    foreach (var (policy, roles) in Policies.Roles)
    {
        options.AddPolicy(policy, p => p.AddAuthenticationSchemes(schemes).RequireRole(roles.Select(r => r.ToString())));
    }
});

// Password guessing: 10 login attempts per minute per client address.
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy(AuthEndpoints.LoginRateLimit, http => RateLimitPartition.GetFixedWindowLimiter(
        http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1) }));
});

// ---------- live sports feed ----------
builder.Services.Configure<SportsFeedOptions>(builder.Configuration.GetSection(SportsFeedOptions.Section));
if (string.Equals(builder.Configuration[$"{SportsFeedOptions.Section}:Provider"], "Http", StringComparison.OrdinalIgnoreCase))
{
    builder.Services.AddHttpClient<ISportsFeedProvider, HttpSportsFeedProvider>((services, http) =>
    {
        var baseUrl = services.GetRequiredService<IOptions<SportsFeedOptions>>().Value.BaseUrl
            ?? throw new InvalidOperationException("Sports:Feed:BaseUrl is required for the Http provider.");
        http.BaseAddress = new Uri(baseUrl.TrimEnd('/') + "/");
        http.Timeout = TimeSpan.FromSeconds(10);
    });
}
else
{
    builder.Services.AddSingleton<ISportsFeedProvider, DemoSportsFeedProvider>();
}
builder.Services.AddHostedService<SportsFeedWorker>();

var app = builder.Build();

// Create or upgrade the database on startup, in every environment. Safe because the wall
// runs as a single instance (see WallStateStore), so no two processes migrate at once.
// After changing the model: dotnet ef migrations add <Name> --project src/MagicWall.Api --output-dir Data/Migrations
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.Migrate();
    await AuthEndpoints.EnsureUsersAsync(db, app.Configuration, app.Environment, app.Logger);
}

// First in the pipeline: the presenter port only ever sees the wall, the hub and read-only data.
app.UsePortIsolation(ports, app.Logger);
app.Logger.LogInformation("Presenter port {Presenter} (wall, hub, read-only API); admin port {Admin} (control room)",
    ports.Presenter, ports.Admin);

// Serves wwwroot/magic-wall.html, admin-dashboard.html and their js/css/maps/fonts.
// Unknown extensions are never served, so the map files need their type registered.
var contentTypes = new FileExtensionContentTypeProvider();
contentTypes.Mappings[".geojson"] = "application/geo+json";

// no-cache = revalidate every load (cheap 304s on the studio LAN). Without it, browsers
// heuristically cache ES modules and can mix old and new files after an upgrade.
app.UseStaticFiles(new StaticFileOptions
{
    ContentTypeProvider = contentTypes,
    OnPrepareResponse = ctx => ctx.Context.Response.Headers.CacheControl = "no-cache"
});

app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

// Each port opens on its own front page.
app.MapGet("/", (HttpContext http) => Results.Redirect(http.IsPresenterPort(ports) ? "/interactive-hub.html" : "/admin-dashboard.html"))
    .ExcludeFromDescription();

// The wall's hub stays anonymous: it carries only approved data and queue counts.
app.MapHub<MagicWallHub>(MagicWallHub.Route);

app.MapAuthEndpoints();
app.MapWallEndpoints();
app.MapElectionEndpoints();
app.MapElectionReviewEndpoints();
app.MapSportsEndpoints();
app.MapSportsReviewEndpoints();
app.MapWarEndpoints();
app.MapBudgetEndpoints();

app.Run();
