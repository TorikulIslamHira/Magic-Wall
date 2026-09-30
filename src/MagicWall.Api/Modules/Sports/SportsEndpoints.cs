using MagicWall.Api.Hosting;
using System.Security.Claims;
using MagicWall.Api.Auth;
using MagicWall.Api.Data;
using MagicWall.Api.Hubs;
using MagicWall.Api.Modules.Sports.Media;
using MagicWall.Api.Wall;
using MagicWall.Api.Workflow;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace MagicWall.Api.Modules.Sports;

/// <param name="X">Null when the source had no position (live score feeds): timeline only, not on the pitch.</param>
public record MatchEventDto(
    int Id,
    MatchEventType EventType,
    float? X,
    float? Y,
    float? EndX,
    float? EndY,
    int Minute,
    string? Detail = null);

/// <param name="PlayerPhoto">Local URL of the player's photo (see SportsMedia), or null.</param>
public record PlayerMatchEventsDto(
    int MatchId,
    string MatchTitle,
    SportType Sport,
    int PlayerId,
    string PlayerName,
    string Team,
    IReadOnlyList<MatchEventDto> Events,
    string? PlayerPhoto = null,
    string? TeamBadge = null);

public record MatchSummaryDto(
    int Id, string Title, SportType Sport, DateTime MatchDate, string TeamA, string TeamB, string? FeedMatchId = null,
    string? Competition = null, string? FeedStatus = null, int? ScoreA = null, int? ScoreB = null,
    string? TeamABadge = null, string? TeamBBadge = null);

/// <summary>One moment on the match timeline (goals, cards, substitutions, wickets…).</summary>
public record TimelineEventDto(
    int Id, int Minute, MatchEventType EventType, string? Detail,
    int PlayerId, string PlayerName, string Team, string? PlayerPhoto);

/// <summary>Everything the wall's scoreboard and timeline need, approved events only.</summary>
public record MatchTimelineDto(
    int MatchId, string Title, SportType Sport, string? Competition, DateTime MatchDate,
    string TeamA, string TeamB, string? TeamABadge, string? TeamBBadge,
    string? FeedStatus, int? ScoreA, int? ScoreB,
    IReadOnlyList<TimelineEventDto> Events);

/// <param name="FeedMatchId">The match's id at the data provider; null unlinks it from the feed.</param>
public record LinkFeedRequest(string? FeedMatchId);

public record PlayerDto(int Id, string Name, string Team, string Role);

public record CreateMatchRequest(string Title, SportType Sport, DateTime MatchDate, string TeamA, string TeamB);

public record CreatePlayerRequest(string Name, string Team, string? Role);

public record CreateMatchEventRequest(
    int MatchId,
    int PlayerId,
    MatchEventType EventType,
    float X,
    float Y,
    float? EndX,
    float? EndY,
    int Minute);

public static class SportsEndpoints
{
    public static IEndpointRouteBuilder MapSportsEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/sports").WithTags("Sports");

        group.MapGet("/events/{matchId:int}/{playerId:int}", GetPlayerEvents);
        group.MapGet("/matches", GetMatches);
        group.MapGet("/matches/{id:int}/timeline", GetTimeline);

        // Optional filter: /api/sports/players?matchId=1 returns both teams' players.
        group.MapGet("/players", GetPlayers);

        group.MapPost("/matches", CreateMatch).RequireAuthorization(Policies.ManageSports);
        group.MapPut("/matches/{id:int}/feed", LinkFeed).RequireAuthorization(Policies.ManageSports);
        group.MapPost("/players", CreatePlayer).RequireAuthorization(Policies.ManageSports);
        group.MapPost("/events", CreateEvent).RequireAuthorization(Policies.ManageSports);
        group.MapDelete("/events/{id:int}", DeleteEvent).RequireAuthorization(Policies.ManageSports);

        return app;
    }

    private static async Task<Results<Ok<PlayerMatchEventsDto>, NotFound>> GetPlayerEvents(
        int matchId, int playerId, AppDbContext db, CancellationToken ct)
    {
        var match = await db.Matches
            .AsNoTracking()
            .Where(m => m.Id == matchId)
            .Select(m => new { m.Title, m.Sport })
            .SingleOrDefaultAsync(ct);

        var player = await db.Players
            .AsNoTracking()
            .Where(p => p.Id == playerId)
            .Select(p => new { p.Name, p.Team, p.PhotoFile })
            .SingleOrDefaultAsync(ct);

        // Distinguish "unknown match/player" (404) from "player has no events yet" (empty list).
        if (match is null || player is null)
        {
            return TypedResults.NotFound();
        }

        // Coordinates are 0–100 percentages; the canvas scales them to pixels.
        // Approved only: fetched events waiting in the sports desk's queue never reach the wall.
        var events = await db.MatchEvents
            .AsNoTracking()
            .Where(e => e.MatchId == matchId && e.PlayerId == playerId && e.Status == ApprovalStatus.Approved)
            .OrderBy(e => e.Minute)
            .ThenBy(e => e.Id)
            .Select(e => new MatchEventDto(
                e.Id,
                e.EventType,
                e.CoordinateX,
                e.CoordinateY,
                e.EndCoordinateX,
                e.EndCoordinateY,
                e.Minute,
                e.Detail))
            .ToListAsync(ct);

        var badge = await db.TeamMedia.AsNoTracking().Where(t => t.Team == player.Team).Select(t => t.BadgeFile).FirstOrDefaultAsync(ct);
        return TypedResults.Ok(new PlayerMatchEventsDto(
            matchId, match.Title, match.Sport, playerId, player.Name, player.Team, events,
            SportsMedia.Url(player.PhotoFile), SportsMedia.Url(badge)));
    }

    /// <summary>Scoreboard + timeline for the wall: live score/status and the approved major moments.</summary>
    private static async Task<Results<Ok<MatchTimelineDto>, NotFound>> GetTimeline(int id, AppDbContext db, CancellationToken ct)
    {
        var match = await db.Matches.AsNoTracking().SingleOrDefaultAsync(m => m.Id == id, ct);
        if (match is null) return TypedResults.NotFound();

        var major = SportEvents.Major.ToList();
        var events = await db.MatchEvents
            .AsNoTracking()
            .Where(e => e.MatchId == id && e.Status == ApprovalStatus.Approved && major.Contains(e.EventType))
            .OrderBy(e => e.Minute).ThenBy(e => e.Id)
            .Select(e => new TimelineEventDto(e.Id, e.Minute, e.EventType, e.Detail,
                e.PlayerId, e.Player.Name, e.Player.Team, SportsMedia.Url(e.Player.PhotoFile)))
            .ToListAsync(ct);

        var badges = await db.TeamMedia.AsNoTracking()
            .Where(t => t.Team == match.TeamA || t.Team == match.TeamB)
            .ToDictionaryAsync(t => t.Team, t => t.BadgeFile, ct);

        return TypedResults.Ok(new MatchTimelineDto(
            match.Id, match.Title, match.Sport, match.Competition, match.MatchDate,
            match.TeamA, match.TeamB,
            SportsMedia.Url(badges.GetValueOrDefault(match.TeamA)), SportsMedia.Url(badges.GetValueOrDefault(match.TeamB)),
            match.FeedStatus, match.ScoreA, match.ScoreB, events));
    }

    // Optional filter: /api/sports/matches?sport=Cricket
    private static async Task<List<MatchSummaryDto>> GetMatches(SportType? sport, AppDbContext db, CancellationToken ct)
    {
        var badges = await db.TeamMedia.AsNoTracking().Where(t => t.BadgeFile != null).ToDictionaryAsync(t => t.Team, t => t.BadgeFile, ct);
        return (await db.Matches
                .AsNoTracking()
                .Where(m => sport == null || m.Sport == sport)
                .OrderByDescending(m => m.MatchDate)
                .ToListAsync(ct))
            .Select(m => new MatchSummaryDto(m.Id, m.Title, m.Sport, m.MatchDate, m.TeamA, m.TeamB, m.FeedMatchId,
                m.Competition, m.FeedStatus, m.ScoreA, m.ScoreB,
                SportsMedia.Url(badges.GetValueOrDefault(m.TeamA)), SportsMedia.Url(badges.GetValueOrDefault(m.TeamB))))
            .ToList();
    }

    /// <summary>Links a match to the live feed (the worker starts queuing its events) or unlinks it.</summary>
    private static async Task<Results<NoContent, NotFound, ValidationProblem>> LinkFeed(
        int id, LinkFeedRequest request, AppDbContext db, CancellationToken ct)
    {
        var feedMatchId = string.IsNullOrWhiteSpace(request.FeedMatchId) ? null : request.FeedMatchId.Trim();
        if (feedMatchId is { Length: > 100 })
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["feedMatchId"] = [Text.L("ফিড আইডি সর্বোচ্চ ১০০ অক্ষর হতে পারে।", "The feed id can be up to 100 characters.")] });
        }

        // A new (or no) link starts fresh: the old id's status — e.g. NOT_FOUND — must not delay polling the new one.
        var updated = await db.Matches.Where(m => m.Id == id).ExecuteUpdateAsync(set => set
            .SetProperty(m => m.FeedMatchId, feedMatchId)
            .SetProperty(m => m.FeedStatus, (string?)null)
            .SetProperty(m => m.FeedUpdatedAt, (DateTime?)null), ct);
        return updated == 0 ? TypedResults.NotFound() : TypedResults.NoContent();
    }

    private static async Task<Results<Created<MatchSummaryDto>, ValidationProblem>> CreateMatch(
        CreateMatchRequest request, AppDbContext db, CancellationToken ct)
    {
        var title = request.Title?.Trim() ?? string.Empty;
        var teamA = request.TeamA?.Trim() ?? string.Empty;
        var teamB = request.TeamB?.Trim() ?? string.Empty;

        var errors = new Dictionary<string, string[]>();
        if (!Enum.IsDefined(request.Sport)) errors["sport"] = [Text.L("অজানা খেলা।", "Unknown sport.")];
        if (title.Length is 0 or > 200) errors["title"] = [Text.L("ম্যাচের শিরোনাম দিন (সর্বোচ্চ ২০০ অক্ষর)।", "Enter a match title (up to 200 characters).")];
        if (teamA.Length is 0 or > 100) errors["teamA"] = [Text.L("প্রথম দলের নাম দিন (সর্বোচ্চ ১০০ অক্ষর)।", "Enter the first team's name (up to 100 characters).")];
        if (teamB.Length is 0 or > 100) errors["teamB"] = [Text.L("দ্বিতীয় দলের নাম দিন (সর্বোচ্চ ১০০ অক্ষর)।", "Enter the second team's name (up to 100 characters).")];
        if (teamA.Length > 0 && teamA == teamB) errors["teamB"] = [Text.L("দুই দলের নাম আলাদা হতে হবে।", "The two teams must have different names.")];
        if (errors.Count > 0) return TypedResults.ValidationProblem(errors);

        var match = new Match { Title = title, Sport = request.Sport, MatchDate = request.MatchDate, TeamA = teamA, TeamB = teamB };
        db.Matches.Add(match);
        await db.SaveChangesAsync(ct);

        // No broadcast: the wall shows a match only once it is put on air.
        return TypedResults.Created(
            $"/api/sports/matches/{match.Id}",
            new MatchSummaryDto(match.Id, title, match.Sport, match.MatchDate, teamA, teamB));
    }

    private static async Task<Results<Created<PlayerDto>, ValidationProblem>> CreatePlayer(
        CreatePlayerRequest request, AppDbContext db, CancellationToken ct)
    {
        var name = request.Name?.Trim() ?? string.Empty;
        var team = request.Team?.Trim() ?? string.Empty;
        var role = request.Role?.Trim() ?? string.Empty;

        var errors = new Dictionary<string, string[]>();
        if (name.Length is 0 or > 150) errors["name"] = [Text.L("খেলোয়াড়ের নাম দিন (সর্বোচ্চ ১৫০ অক্ষর)।", "Enter the player's name (up to 150 characters).")];
        if (team.Length is 0 or > 100) errors["team"] = [Text.L("দলের নাম দিন (সর্বোচ্চ ১০০ অক্ষর)।", "Enter the team name (up to 100 characters).")];
        if (role.Length > 50) errors["role"] = [Text.L("ভূমিকা সর্বোচ্চ ৫০ অক্ষর হতে পারে।", "The role can be up to 50 characters.")];
        if (errors.Count > 0) return TypedResults.ValidationProblem(errors);

        var player = new Player { Name = name, Team = team, Role = role };
        db.Players.Add(player);
        await db.SaveChangesAsync(ct);

        return TypedResults.Created($"/api/sports/players/{player.Id}", new PlayerDto(player.Id, name, team, role));
    }

    private static async Task<Results<Ok<List<PlayerDto>>, NotFound>> GetPlayers(
        int? matchId, AppDbContext db, CancellationToken ct)
    {
        var query = db.Players.AsNoTracking();

        if (matchId is not null)
        {
            var teams = await db.Matches
                .Where(m => m.Id == matchId)
                .Select(m => new { m.TeamA, m.TeamB })
                .SingleOrDefaultAsync(ct);

            if (teams is null)
            {
                return TypedResults.NotFound();
            }

            query = query.Where(p => p.Team == teams.TeamA || p.Team == teams.TeamB);
        }

        var players = await query
            .OrderBy(p => p.Team)
            .ThenBy(p => p.Name)
            .Select(p => new PlayerDto(p.Id, p.Name, p.Team, p.Role))
            .ToListAsync(ct);

        return TypedResults.Ok(players);
    }

    /// <summary>
    /// A hand-entered event from the sports desk. The desk is the checker, so it is approved on
    /// entry (and recorded as entered and approved by that user); fetched data goes through the queue.
    /// </summary>
    private static async Task<Results<Created<MatchEventDto>, NotFound<string>, ValidationProblem>> CreateEvent(
        CreateMatchEventRequest request, ClaimsPrincipal user, AppDbContext db, IHubContext<MagicWallHub> hub, CancellationToken ct)
    {
        var errors = Validate(request);
        if (errors.Count > 0)
        {
            return TypedResults.ValidationProblem(errors);
        }

        var sport = await db.Matches
            .Where(m => m.Id == request.MatchId)
            .Select(m => (SportType?)m.Sport)
            .SingleOrDefaultAsync(ct);

        if (sport is null)
        {
            return TypedResults.NotFound(Text.L("ম্যাচটি পাওয়া যায়নি।", "Match not found."));
        }

        // A "Six" in a football match would draw nonsense on the wall.
        if (!SportEvents.IsValid(sport.Value, request.EventType))
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["eventType"] = [Text.L("এই খেলার জন্য এই ঘটনার ধরন প্রযোজ্য নয়।", "That event type doesn't apply to this sport.")]
            });
        }

        if (!await db.Players.AnyAsync(p => p.Id == request.PlayerId, ct))
        {
            return TypedResults.NotFound(Text.L("খেলোয়াড় পাওয়া যায়নি।", "Player not found."));
        }

        var entity = new MatchEvent
        {
            MatchId = request.MatchId,
            PlayerId = request.PlayerId,
            EventType = request.EventType,
            CoordinateX = request.X,
            CoordinateY = request.Y,
            EndCoordinateX = request.EndX,
            EndCoordinateY = request.EndY,
            Minute = request.Minute,
            Status = ApprovalStatus.Approved,
            Source = EventSource.Manual,
            SubmittedBy = user.UserName(),
            ReviewedBy = user.UserName(),
            ReviewedAt = DateTime.UtcNow
        };

        db.MatchEvents.Add(entity);
        await db.SaveChangesAsync(ct);
        await hub.BroadcastDataChangedAsync(WallModule.Sports, $"{entity.MatchId}:{entity.PlayerId}", ct);

        var dto = new MatchEventDto(
            entity.Id, entity.EventType, entity.CoordinateX, entity.CoordinateY,
            entity.EndCoordinateX, entity.EndCoordinateY, entity.Minute, entity.Detail);

        return TypedResults.Created($"/api/sports/events/{entity.Id}", dto);
    }

    private static async Task<Results<NoContent, NotFound>> DeleteEvent(
        int id, AppDbContext db, IHubContext<MagicWallHub> hub, CancellationToken ct)
    {
        var entity = await db.MatchEvents.FindAsync([id], ct);
        if (entity is null)
        {
            return TypedResults.NotFound();
        }

        db.MatchEvents.Remove(entity);
        await db.SaveChangesAsync(ct);
        await hub.BroadcastDataChangedAsync(WallModule.Sports, $"{entity.MatchId}:{entity.PlayerId}", ct);

        return TypedResults.NoContent();
    }

    private static Dictionary<string, string[]> Validate(CreateMatchEventRequest r)
    {
        static bool InRange(float v) => v is >= 0 and <= 100;

        var errors = new Dictionary<string, string[]>();

        if (!Enum.IsDefined(r.EventType))
        {
            errors["eventType"] = [Text.L("অজানা ঘটনার ধরন।", "Unknown event type.")];
        }

        if (!InRange(r.X) || !InRange(r.Y))
        {
            errors["x"] = [Text.L("অবস্থান ০ থেকে ১০০-এর মধ্যে হতে হবে।", "The position must be between 0 and 100.")];
        }

        if (r.EndX.HasValue != r.EndY.HasValue)
        {
            errors["endX"] = [Text.L("তীরের শেষ বিন্দুর দুটি মানই দিন, অথবা কোনোটিই নয়।", "Give both end-point values for the arrow, or neither.")];
        }
        else if (r.EndX is { } endX && r.EndY is { } endY && (!InRange(endX) || !InRange(endY)))
        {
            errors["endX"] = [Text.L("তীরের শেষ বিন্দু ০ থেকে ১০০-এর মধ্যে হতে হবে।", "The arrow's end point must be between 0 and 100.")];
        }

        if (r.Minute is < 0 or > 200)
        {
            errors["minute"] = [Text.L("মিনিট ০ থেকে ২০০-এর মধ্যে হতে হবে।", "The minute must be between 0 and 200.")];
        }

        return errors;
    }
}
