using System.Text.Json;

namespace MagicWall.Api.Modules.Sports.Feed;

/// <summary>Bound from "Sports:Feed" configuration.</summary>
public sealed class SportsFeedOptions
{
    public const string Section = "Sports:Feed";

    /// <summary>Off switch for the whole worker.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>"Demo" (generated data), "FootballData" (football-data.org) or "Http" (the JSON contract below).</summary>
    public string Provider { get; set; } = "Demo";

    /// <summary>
    /// How often live matches are polled. Each poll is one request per live match, and every
    /// request also waits for the provider's rate limit, so this is a floor, not a promise.
    /// </summary>
    public int IntervalSeconds { get; set; } = 20;

    /// <summary>Http provider only: base URL of the feed service.</summary>
    public string? BaseUrl { get; set; }

    public FootballDataOptions FootballData { get; set; } = new();
}

/// <summary>A match the worker should poll, with the players it can attribute events to.</summary>
public record FeedMatch(int MatchId, string FeedMatchId, SportType Sport, string TeamA, string TeamB, IReadOnlyList<FeedPlayer> Players);

public record FeedPlayer(string Name, string Team);

/// <summary>
/// One event as a provider reports it. Coordinates are 0–100 like everywhere else, or null when
/// the provider has no position (score APIs report goals and cards without one).
/// </summary>
/// <param name="Team">One of the match's TeamA / TeamB names.</param>
/// <param name="PlayerExternalId">The provider's id for the player. When set, an unknown player is created
/// (a real feed names real squads); without it, events for unknown players are skipped.</param>
public record FeedEvent(
    string ExternalId,
    string PlayerName,
    string Team,
    MatchEventType EventType,
    float? X,
    float? Y,
    float? EndX,
    float? EndY,
    int Minute,
    string? PlayerExternalId = null,
    string? Detail = null);

/// <summary>The match itself as the provider sees it right now.</summary>
/// <param name="Status">Provider status, e.g. SCHEDULED, IN_PLAY, PAUSED, FINISHED.</param>
public record FeedMatchState(string Status, int? ScoreA, int? ScoreB);

/// <summary>The provider doesn't know this match id (wrong id, or the match was removed).</summary>
public sealed class FeedMatchNotFoundException(string feedMatchId)
    : Exception($"The provider has no match '{feedMatchId}'.");

/// <summary>Everything a provider currently knows about one match.</summary>
public record FeedSnapshot(FeedMatchState? State, IReadOnlyList<FeedEvent> Events)
{
    public static readonly FeedSnapshot Empty = new(null, []);
}

/// <summary>
/// A source of live sports data. Returns everything it currently knows for a match; the worker
/// drops what it already stored (by <see cref="FeedEvent.ExternalId"/>), so providers can be stateless.
/// </summary>
public interface ISportsFeedProvider
{
    string Name { get; }

    Task<FeedSnapshot> FetchAsync(FeedMatch match, CancellationToken ct);
}

/// <summary>An upcoming or recent match the sports desk can import.</summary>
public record FeedFixture(
    string FeedMatchId,
    string Competition,
    DateTime KickoffUtc,
    string HomeTeam,
    string AwayTeam,
    string Status,
    int? ScoreHome,
    int? ScoreAway);

/// <summary>Providers that can list schedules (football-data.org). The desk imports matches from here.</summary>
public interface IFixtureSource
{
    /// <summary>Competition codes offered for import, e.g. PL, PD, CL.</summary>
    IReadOnlyList<string> Competitions { get; }

    Task<IReadOnlyList<FeedFixture>> GetFixturesAsync(string competition, DateOnly from, DateOnly to, CancellationToken ct);
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

    public Task<FeedSnapshot> FetchAsync(FeedMatch match, CancellationToken ct)
    {
        if (match.Players.Count == 0 || !SportEvents.Allowed.TryGetValue(match.Sport, out var types))
        {
            return Task.FromResult(FeedSnapshot.Empty);
        }

        // Positioned types only: the demo exercises the pitch, the real feeds exercise the timeline.
        types = types.Where(t => t is not (MatchEventType.OwnGoal or MatchEventType.YellowCard or MatchEventType.RedCard or MatchEventType.Substitution)).ToArray();

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
        return Task.FromResult(new FeedSnapshot(null, events));
    }

    private static float Round(double v) => (float)Math.Round(v, 1);
}

/// <summary>
/// Reads a simple JSON contract over HTTP, so any other source can be plugged in behind a small
/// adapter (e.g. a replay of StatsBomb's free open data, which has coordinates):
///
///   GET {BaseUrl}/matches/{feedMatchId}/events
///   → [ { "id": "...", "player": "...", "team": "...", "type": "Pass", "x": 40.5, "y": 30,
///         "endX": 60, "endY": 45, "minute": 12, "detail": null }, ... ]
///
/// "type" uses the MatchEventType names; x/y may be null for events without a position.
/// </summary>
public sealed class HttpSportsFeedProvider(HttpClient http, FeedPayloadLog payloads) : ISportsFeedProvider
{
    public string Name => "http";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<FeedSnapshot> FetchAsync(FeedMatch match, CancellationToken ct)
    {
        var json = await http.GetStringAsync($"matches/{Uri.EscapeDataString(match.FeedMatchId)}/events", ct);
        payloads.Record(Name, match.FeedMatchId, json);
        var rows = JsonSerializer.Deserialize<List<HttpFeedRow>>(json, Json) ?? [];

        var events = new List<FeedEvent>(rows.Count);
        foreach (var row in rows)
        {
            if (string.IsNullOrWhiteSpace(row.Id) || !Enum.TryParse<MatchEventType>(row.Type, ignoreCase: true, out var type)) continue;
            events.Add(new FeedEvent($"http-{row.Id}", row.Player ?? string.Empty, row.Team ?? string.Empty, type,
                row.X, row.Y, row.EndX, row.EndY, row.Minute, Detail: row.Detail));
        }
        return new FeedSnapshot(null, events);
    }

    private sealed record HttpFeedRow(string? Id, string? Player, string? Team, string? Type, float? X, float? Y, float? EndX, float? EndY, int Minute, string? Detail);
}
