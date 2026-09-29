using System.Net.Http.Json;

namespace MagicWall.Api.Modules.Sports.Feed;

/// <summary>Bound from "Sports:Feed" configuration.</summary>
public sealed class SportsFeedOptions
{
    public const string Section = "Sports:Feed";

    /// <summary>Off switch for the whole worker.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>"Demo" (generated data) or "Http" (the JSON contract below).</summary>
    public string Provider { get; set; } = "Demo";

    public int IntervalSeconds { get; set; } = 20;

    /// <summary>Http provider only: base URL of the feed service.</summary>
    public string? BaseUrl { get; set; }
}

/// <summary>A match the worker should poll, with the players it can attribute events to.</summary>
public record FeedMatch(int MatchId, string FeedMatchId, SportType Sport, string TeamA, string TeamB, IReadOnlyList<FeedPlayer> Players);

public record FeedPlayer(string Name, string Team);

/// <summary>One event as a provider reports it. Coordinates are 0–100 like everywhere else.</summary>
public record FeedEvent(
    string ExternalId,
    string PlayerName,
    string Team,
    MatchEventType EventType,
    float X,
    float Y,
    float? EndX,
    float? EndY,
    int Minute);

/// <summary>
/// A source of live sports data. Returns everything it currently knows for a match; the worker
/// drops what it already stored (by <see cref="FeedEvent.ExternalId"/>), so providers can be stateless.
/// </summary>
public interface ISportsFeedProvider
{
    string Name { get; }

    Task<IReadOnlyList<FeedEvent>> FetchAsync(FeedMatch match, CancellationToken ct);
}

/// <summary>
/// Stand-in for a live API: produces a few plausible events per poll for each linked match, using
/// that sport's event types and the match's real players. Lets the whole fetch → queue → approve →
/// wall path be rehearsed without a paid data contract.
/// </summary>
public sealed class DemoSportsFeedProvider : ISportsFeedProvider
{
    private readonly Random _random = new();

    public string Name => "demo";

    public Task<IReadOnlyList<FeedEvent>> FetchAsync(FeedMatch match, CancellationToken ct)
    {
        if (match.Players.Count == 0 || !SportEvents.Allowed.TryGetValue(match.Sport, out var types))
        {
            return Task.FromResult<IReadOnlyList<FeedEvent>>([]);
        }

        var minute = Math.Min(120, (int)(DateTime.UtcNow - DateTime.UtcNow.Date).TotalMinutes % 90 + 1);
        var events = new List<FeedEvent>();
        for (var i = _random.Next(1, 4); i > 0; i--)
        {
            var player = match.Players[_random.Next(match.Players.Count)];
            var type = types[_random.Next(types.Length)];
            var x = Round(_random.NextDouble() * 84 + 8);
            var y = Round(_random.NextDouble() * 76 + 12);
            var hasArrow = type is MatchEventType.Pass or MatchEventType.Shot;
            events.Add(new FeedEvent(
                $"demo-{match.FeedMatchId}-{Guid.NewGuid():N}",
                player.Name, player.Team, type, x, y,
                hasArrow ? Math.Min(100, x + Round(_random.NextDouble() * 18 + 4)) : null,
                hasArrow ? Math.Clamp(y + Round(_random.NextDouble() * 24 - 12), 0, 100) : null,
                minute));
        }
        return Task.FromResult<IReadOnlyList<FeedEvent>>(events);
    }

    private static float Round(double v) => (float)Math.Round(v, 1);
}

/// <summary>
/// Reads a simple JSON contract over HTTP, so any real source can be plugged in behind a small
/// adapter (a paid live API, or a replay of StatsBomb's free open data, which has coordinates):
///
///   GET {BaseUrl}/matches/{feedMatchId}/events
///   → [ { "id": "...", "player": "...", "team": "...", "type": "Pass", "x": 40.5, "y": 30,
///         "endX": 60, "endY": 45, "minute": 12 }, ... ]
///
/// "type" uses the MatchEventType names. Free public score APIs don't publish per-event
/// coordinates, which is why an adapter sits in between.
/// </summary>
public sealed class HttpSportsFeedProvider(HttpClient http) : ISportsFeedProvider
{
    public string Name => "http";

    public async Task<IReadOnlyList<FeedEvent>> FetchAsync(FeedMatch match, CancellationToken ct)
    {
        var rows = await http.GetFromJsonAsync<List<HttpFeedRow>>(
            $"matches/{Uri.EscapeDataString(match.FeedMatchId)}/events", ct) ?? [];

        var events = new List<FeedEvent>(rows.Count);
        foreach (var row in rows)
        {
            if (string.IsNullOrWhiteSpace(row.Id) || !Enum.TryParse<MatchEventType>(row.Type, ignoreCase: true, out var type)) continue;
            events.Add(new FeedEvent($"http-{row.Id}", row.Player ?? string.Empty, row.Team ?? string.Empty, type,
                row.X, row.Y, row.EndX, row.EndY, row.Minute));
        }
        return events;
    }

    private sealed record HttpFeedRow(string? Id, string? Player, string? Team, string? Type, float X, float Y, float? EndX, float? EndY, int Minute);
}
