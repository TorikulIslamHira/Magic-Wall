using Microsoft.AspNetCore.SignalR;

namespace MagicWall.Api.Hubs;

/// <summary>
/// Real-time channel between the admin dashboard and the presenter wall.
/// The server pushes to clients (see <see cref="Wall.WallEvents"/>); admin writes go
/// through REST endpoints that broadcast via IHubContext.
/// </summary>
public class MagicWallHub(ILogger<MagicWallHub> logger) : Hub
{
    public const string Route = "/hubs/magicwall";

    public override Task OnConnectedAsync()
    {
        logger.LogInformation("Wall client connected: {ConnectionId}", Context.ConnectionId);
        return base.OnConnectedAsync();
    }

    public override Task OnDisconnectedAsync(Exception? exception)
    {
        logger.LogInformation("Wall client disconnected: {ConnectionId}", Context.ConnectionId);
        return base.OnDisconnectedAsync(exception);
    }
}
