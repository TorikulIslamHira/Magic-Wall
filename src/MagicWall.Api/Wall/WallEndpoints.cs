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
        group.MapPut("/state", SetState).RequireAdminKey();

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
