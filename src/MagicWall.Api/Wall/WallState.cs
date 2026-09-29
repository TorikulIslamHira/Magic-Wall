using MagicWall.Api.Hubs;
using Microsoft.AspNetCore.SignalR;

namespace MagicWall.Api.Wall;

public enum WallModule
{
    Election,
    Sports,
    War,
    Budget
}

/// <summary>
/// What the presenter wall is showing right now. Transient on purpose: it lives in memory
/// and resets to the Election view when the server restarts.
/// </summary>
public record WallState
{
    public WallModule ActiveModule { get; init; } = WallModule.Election;

    /// <summary>Election: constituency the wall should open.</summary>
    public string? SvgPathId { get; init; }

    /// <summary>Sports: match and player whose events are drawn.</summary>
    public int? MatchId { get; init; }
    public int? PlayerId { get; init; }

    /// <summary>War: region and slider date.</summary>
    public string? RegionName { get; init; }
    public DateOnly? Date { get; init; }

    /// <summary>Budget: fiscal year filter, e.g. "2025-26".</summary>
    public string? FiscalYear { get; init; }

    public DateTimeOffset UpdatedAt { get; init; } = DateTimeOffset.UtcNow;
}

public class WallStateStore
{
    // Records are immutable, so swapping the reference is the whole update.
    private volatile WallState _current = new();

    public WallState Current
    {
        get => _current;
        set => _current = value;
    }
}

/// <summary>Server-to-client SignalR method names.</summary>
public static class WallEvents
{
    /// <summary>Payload: <see cref="WallState"/>. The wall switches module or focus.</summary>
    public const string StateChanged = "StateChanged";

    /// <summary>Payload: <see cref="DataChangedMessage"/>. The wall refetches if it shows that data.</summary>
    public const string DataChanged = "DataChanged";
}

/// <param name="Key">Module-specific: a SvgPathId for Election, "matchId:playerId" for Sports.</param>
public record DataChangedMessage(WallModule Module, string Key);

public static class WallHubExtensions
{
    public static Task BroadcastDataChangedAsync(
        this IHubContext<MagicWallHub> hub, WallModule module, string key, CancellationToken ct = default) =>
        hub.Clients.All.SendAsync(WallEvents.DataChanged, new DataChangedMessage(module, key), ct);
}
