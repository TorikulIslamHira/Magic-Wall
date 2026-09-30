using System.Globalization;
using System.Net;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;

namespace MagicWall.Api.Modules.Sports.Feed;

/// <summary>Bound from "Sports:Feed:FootballData".</summary>
public sealed class FootballDataOptions
{
    /// <summary>X-Auth-Token from football-data.org. Server-side only; never sent to a browser.</summary>
    public string? ApiKey { get; set; }

    public string BaseUrl { get; set; } = "https://api.football-data.org/v4/";

    /// <summary>
    /// The account's quota. Free tier: 10 (fixtures and delayed scores only). Goal scorers, cards and
    /// substitutions need a "Deep Data" plan (30/min at the time of writing).
    /// </summary>
    public int RequestsPerMinute { get; set; } = 10;

    /// <summary>Competitions offered for import (codes as football-data.org uses them).</summary>
    public string Competitions { get; set; } = "PL,PD,BL1,SA,FL1,CL,DED,PPL,ELC,BSA,WC,EC";
}

/// <summary>
/// football-data.org v4: schedules, live score/status and — on plans that include them — goals,
/// bookings and substitutions. Home is mapped to the match's TeamA and away to TeamB (matches
/// imported from here are created that way). The API has no pitch positions, so events arrive
/// without coordinates; they go on the timeline, never on a made-up spot on the pitch.
/// All requests pass through the shared rate gate (see Program.cs).
/// </summary>
public sealed partial class FootballDataOrgProvider(HttpClient http, IOptions<SportsFeedOptions> options, FeedPayloadLog payloads, ILogger<FootballDataOrgProvider> logger)
    : ISportsFeedProvider, IFixtureSource
{
    public string Name => "football-data";

    public IReadOnlyList<string> Competitions { get; } = options.Value.FootballData.Competitions
        .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
        .Where(c => CompetitionCode().IsMatch(c))
        .ToList();

    public async Task<FeedSnapshot> FetchAsync(FeedMatch match, CancellationToken ct)
    {
        if (!long.TryParse(match.FeedMatchId, NumberStyles.None, CultureInfo.InvariantCulture, out var id))
        {
            // Not a football-data.org id (e.g. a demo link): no request is spent on it.
            throw new FeedMatchNotFoundException(match.FeedMatchId);
        }

        var data = await GetAsync<FdMatch>($"matches/{id}", background: true, ct, rawFor: match.FeedMatchId) ?? throw new FeedMatchNotFoundException(match.FeedMatchId);

        var homeId = data.HomeTeam?.Id;
        string TeamOf(FdRef? team) => team?.Id == homeId ? match.TeamA : match.TeamB;
        string OtherTeam(FdRef? team) => team?.Id == homeId ? match.TeamB : match.TeamA;

        var events = new List<FeedEvent>();
        // Stable ids built from the event's own fields; a true duplicate (same player, minute and
        // kind twice in one match) gets a counter so both are kept.
        var seen = new Dictionary<string, int>();
        string Unique(string key)
        {
            var n = seen.GetValueOrDefault(key);
            seen[key] = n + 1;
            return n == 0 ? key : $"{key}:{n}";
        }

        foreach (var goal in data.Goals ?? [])
        {
            if (goal.Scorer?.Id is not { } scorerId || string.IsNullOrWhiteSpace(goal.Scorer.Name)) continue;
            var own = string.Equals(goal.Type, "OWN", StringComparison.OrdinalIgnoreCase);
            var details = new List<string>();
            // Language-neutral tokens; the wall and dashboard translate them (i18n.js, formatDetail).
            if (string.Equals(goal.Type, "PENALTY", StringComparison.OrdinalIgnoreCase)) details.Add("penalty");
            if (goal.InjuryTime is > 0) details.Add($"+{goal.InjuryTime}");
            if (goal.Assist?.Name is { Length: > 0 } assist) details.Add($"assist: {assist}");
            events.Add(new FeedEvent(
                Unique($"fd:{id}:goal:{scorerId}:{goal.Minute}:{goal.InjuryTime ?? 0}"),
                goal.Scorer.Name,
                // "team" is the side the goal counts for; an own goal's scorer plays for the other side.
                own ? OtherTeam(goal.Team) : TeamOf(goal.Team),
                own ? MatchEventType.OwnGoal : MatchEventType.Goal,
                null, null, null, null,
                goal.Minute ?? 0,
                $"fd:{scorerId}",
                Joined(details)));
        }

        foreach (var booking in data.Bookings ?? [])
        {
            if (booking.Player?.Id is not { } playerId || string.IsNullOrWhiteSpace(booking.Player.Name)) continue;
            var card = booking.Card?.ToUpperInvariant();
            var type = card is "RED" or "YELLOW_RED" ? MatchEventType.RedCard : MatchEventType.YellowCard;
            events.Add(new FeedEvent(
                Unique($"fd:{id}:card:{playerId}:{booking.Minute}:{card}"),
                booking.Player.Name, TeamOf(booking.Team), type,
                null, null, null, null, booking.Minute ?? 0,
                $"fd:{playerId}",
                card == "YELLOW_RED" ? "second-yellow" : null));
        }

        foreach (var sub in data.Substitutions ?? [])
        {
            if (sub.PlayerIn?.Id is not { } inId || string.IsNullOrWhiteSpace(sub.PlayerIn.Name)) continue;
            events.Add(new FeedEvent(
                Unique($"fd:{id}:sub:{inId}:{sub.PlayerOut?.Id}"),
                sub.PlayerIn.Name, TeamOf(sub.Team), MatchEventType.Substitution,
                null, null, null, null, sub.Minute ?? 0,
                $"fd:{inId}",
                sub.PlayerOut?.Name is { Length: > 0 } off ? $"off: {off}" : null));
        }

        // In v4, score.fullTime holds the running score while a match is in play.
        var state = new FeedMatchState(data.Status ?? "UNKNOWN", data.Score?.FullTime?.Home, data.Score?.FullTime?.Away);
        return new FeedSnapshot(state, events);
    }

    public async Task<IReadOnlyList<FeedFixture>> GetFixturesAsync(string competition, DateOnly from, DateOnly to, CancellationToken ct)
    {
        if (!CompetitionCode().IsMatch(competition)) return [];

        var query = $"competitions/{competition}/matches?dateFrom={from:yyyy-MM-dd}&dateTo={to:yyyy-MM-dd}";
        var data = await GetAsync<FdMatchList>(query, background: false, ct);   // a person is waiting
        return (data?.Matches ?? [])
            .Where(m => m.Id is not null && m.HomeTeam?.Name is not null && m.AwayTeam?.Name is not null)
            .Select(m => new FeedFixture(
                m.Id!.Value.ToString(CultureInfo.InvariantCulture),
                data?.Competition?.Name ?? competition,
                m.UtcDate?.UtcDateTime ?? DateTime.MinValue,
                TeamName(m.HomeTeam!), TeamName(m.AwayTeam!),
                m.Status ?? "UNKNOWN",
                m.Score?.FullTime?.Home, m.Score?.FullTime?.Away))
            .OrderBy(f => f.KickoffUtc)
            .ToList();
    }

    /// <summary>football-data.org's own quota headers: seconds until the per-minute counter resets.</summary>
    public static TimeSpan? RetryAfter(HttpResponseMessage response) =>
        response.Headers.TryGetValues("X-RequestCounter-Reset", out var values)
        && int.TryParse(values.FirstOrDefault(), out var seconds) && seconds is > 0 and <= 3600
            ? TimeSpan.FromSeconds(seconds + 1)
            : RateGateHandler.StandardRetryAfter(response);

    private async Task<T?> GetAsync<T>(string path, bool background, CancellationToken ct, string? rawFor = null) where T : class
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Options.Set(RateGateHandler.Background, background);
        using var response = await http.SendAsync(request, ct);
        switch (response.StatusCode)
        {
            case HttpStatusCode.OK:
                var json = await response.Content.ReadAsStringAsync(ct);
                if (rawFor is not null) payloads.Record(Name, rawFor, json);   // what exactly came in, for the desk
                return JsonSerializer.Deserialize<T>(json);
            case HttpStatusCode.NotFound:
                logger.LogWarning("football-data.org: {Path} not found.", path);
                return null;
            case HttpStatusCode.Forbidden:
                // Wrong key, or the competition / data isn't in this plan.
                throw new HttpRequestException($"football-data.org refused {path} (403): check the API key and the plan's competitions.", null, response.StatusCode);
            default:
                throw new HttpRequestException($"football-data.org answered {(int)response.StatusCode} for {path}.", null, response.StatusCode);
        }
    }

    private static string TeamName(FdRef team) => team.ShortName is { Length: > 0 } s ? s : team.Name!;

    private static string? Joined(List<string> parts) => parts.Count == 0 ? null : string.Join(" · ", parts);

    [GeneratedRegex("^[A-Z0-9]{2,5}$")]
    private static partial Regex CompetitionCode();

    // ---- the parts of the v4 JSON we read (https://docs.football-data.org/general/v4/match.html) ----

    private sealed record FdMatchList(
        [property: JsonPropertyName("competition")] FdRef? Competition,
        [property: JsonPropertyName("matches")] List<FdMatch>? Matches);

    private sealed record FdMatch(
        [property: JsonPropertyName("id")] long? Id,
        [property: JsonPropertyName("utcDate")] DateTimeOffset? UtcDate,
        [property: JsonPropertyName("status")] string? Status,
        [property: JsonPropertyName("homeTeam")] FdRef? HomeTeam,
        [property: JsonPropertyName("awayTeam")] FdRef? AwayTeam,
        [property: JsonPropertyName("score")] FdScore? Score,
        [property: JsonPropertyName("goals")] List<FdGoal>? Goals,
        [property: JsonPropertyName("bookings")] List<FdBooking>? Bookings,
        [property: JsonPropertyName("substitutions")] List<FdSubstitution>? Substitutions);

    private sealed record FdRef(
        [property: JsonPropertyName("id")] long? Id,
        [property: JsonPropertyName("name")] string? Name,
        [property: JsonPropertyName("shortName")] string? ShortName);

    private sealed record FdScore([property: JsonPropertyName("fullTime")] FdScoreLine? FullTime);

    private sealed record FdScoreLine(
        [property: JsonPropertyName("home")] int? Home,
        [property: JsonPropertyName("away")] int? Away);

    private sealed record FdGoal(
        [property: JsonPropertyName("minute")] int? Minute,
        [property: JsonPropertyName("injuryTime")] int? InjuryTime,
        [property: JsonPropertyName("type")] string? Type,
        [property: JsonPropertyName("team")] FdRef? Team,
        [property: JsonPropertyName("scorer")] FdRef? Scorer,
        [property: JsonPropertyName("assist")] FdRef? Assist);

    private sealed record FdBooking(
        [property: JsonPropertyName("minute")] int? Minute,
        [property: JsonPropertyName("team")] FdRef? Team,
        [property: JsonPropertyName("player")] FdRef? Player,
        [property: JsonPropertyName("card")] string? Card);

    private sealed record FdSubstitution(
        [property: JsonPropertyName("minute")] int? Minute,
        [property: JsonPropertyName("team")] FdRef? Team,
        [property: JsonPropertyName("playerOut")] FdRef? PlayerOut,
        [property: JsonPropertyName("playerIn")] FdRef? PlayerIn);
}
