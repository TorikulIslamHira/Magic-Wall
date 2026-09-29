using MagicWall.Api.Auth;
using MagicWall.Api.Hubs;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.SignalR;

namespace MagicWall.Api.Wall;

public static class WallEndpoints
{
    public static IEndpointRouteBuilder MapWallEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/wall").WithTags("Wall");

        group.MapGet("/state", (WallStateStore store) => TypedResults.Ok(store.Current));
        group.MapPut("/state", SetState).RequireAuthorization(Policies.ControlWall);

        // Local-testing convenience: lets the dashboard pre-fill the admin key. Off unless
        // Admin:AutoFillKey is true (Development config, or MAGICWALL_ADMIN_AUTOFILL in .env),
        // because anyone who can open the dashboard would then receive the key.
        group.MapGet("/admin-key", (IConfiguration config) =>
            config.GetValue<bool>("Admin:AutoFillKey") && !string.IsNullOrEmpty(config["Admin:ApiKey"])
                ? Results.Ok(new { key = config["Admin:ApiKey"] })
                : Results.NotFound());

        return app;
    }

    private static async Task<Ok<WallState>> SetState(
        WallState request, WallStateStore store, IHubContext<MagicWallHub> hub, CancellationToken ct)
    {
        var state = request with { UpdatedAt = DateTimeOffset.UtcNow };
        store.Current = state;

        await hub.Clients.All.SendAsync(WallEvents.StateChanged, state, ct);

        return TypedResults.Ok(state);
    }
}
