using System.Security.Claims;
using MagicWall.Api.Auth;
using MagicWall.Api.Data;
using MagicWall.Api.Hubs;
using MagicWall.Api.Wall;
using MagicWall.Api.Workflow;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace MagicWall.Api.Modules.Sports;

public record MatchEventDto(
    int Id,
    MatchEventType EventType,
    float X,
    float Y,
    float? EndX,
    float? EndY,
    int Minute);

public record PlayerMatchEventsDto(
    int MatchId,
    string MatchTitle,
    SportType Sport,
    int PlayerId,
    string PlayerName,
    string Team,
    IReadOnlyList<MatchEventDto> Events);

public record MatchSummaryDto(int Id, string Title, SportType Sport, DateTime MatchDate, string TeamA, string TeamB, string? FeedMatchId = null);

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
            .Select(p => new { p.Name, p.Team })
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
                e.Minute))
            .ToListAsync(ct);

        return TypedResults.Ok(new PlayerMatchEventsDto(
            matchId, match.Title, match.Sport, playerId, player.Name, player.Team, events));
    }

    // Optional filter: /api/sports/matches?sport=Cricket
    private static Task<List<MatchSummaryDto>> GetMatches(SportType? sport, AppDbContext db, CancellationToken ct) =>
        db.Matches
            .AsNoTracking()
            .Where(m => sport == null || m.Sport == sport)
            .OrderByDescending(m => m.MatchDate)
            .Select(m => new MatchSummaryDto(m.Id, m.Title, m.Sport, m.MatchDate, m.TeamA, m.TeamB, m.FeedMatchId))
            .ToListAsync(ct);

    /// <summary>Links a match to the live feed (the worker starts queuing its events) or unlinks it.</summary>
    private static async Task<Results<NoContent, NotFound, ValidationProblem>> LinkFeed(
        int id, LinkFeedRequest request, AppDbContext db, CancellationToken ct)
    {
        var feedMatchId = string.IsNullOrWhiteSpace(request.FeedMatchId) ? null : request.FeedMatchId.Trim();
        if (feedMatchId is { Length: > 100 })
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["feedMatchId"] = ["ফিড আইডি সর্বোচ্চ ১০০ অক্ষর হতে পারে।"] });
        }

        var updated = await db.Matches.Where(m => m.Id == id).ExecuteUpdateAsync(set => set.SetProperty(m => m.FeedMatchId, feedMatchId), ct);
        return updated == 0 ? TypedResults.NotFound() : TypedResults.NoContent();
    }

    private static async Task<Results<Created<MatchSummaryDto>, ValidationProblem>> CreateMatch(
        CreateMatchRequest request, AppDbContext db, CancellationToken ct)
    {
        var title = request.Title?.Trim() ?? string.Empty;
        var teamA = request.TeamA?.Trim() ?? string.Empty;
        var teamB = request.TeamB?.Trim() ?? string.Empty;

        var errors = new Dictionary<string, string[]>();
        if (!Enum.IsDefined(request.Sport)) errors["sport"] = ["অজানা খেলা।"];
        if (title.Length is 0 or > 200) errors["title"] = ["ম্যাচের শিরোনাম দিন (সর্বোচ্চ ২০০ অক্ষর)।"];
        if (teamA.Length is 0 or > 100) errors["teamA"] = ["প্রথম দলের নাম দিন (সর্বোচ্চ ১০০ অক্ষর)।"];
        if (teamB.Length is 0 or > 100) errors["teamB"] = ["দ্বিতীয় দলের নাম দিন (সর্বোচ্চ ১০০ অক্ষর)।"];
        if (teamA.Length > 0 && teamA == teamB) errors["teamB"] = ["দুই দলের নাম আলাদা হতে হবে।"];
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
        if (name.Length is 0 or > 150) errors["name"] = ["খেলোয়াড়ের নাম দিন (সর্বোচ্চ ১৫০ অক্ষর)।"];
        if (team.Length is 0 or > 100) errors["team"] = ["দলের নাম দিন (সর্বোচ্চ ১০০ অক্ষর)।"];
        if (role.Length > 50) errors["role"] = ["ভূমিকা সর্বোচ্চ ৫০ অক্ষর হতে পারে।"];
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
            return TypedResults.NotFound("ম্যাচটি পাওয়া যায়নি।");
        }

        // A "Six" in a football match would draw nonsense on the wall.
        if (!SportEvents.IsValid(sport.Value, request.EventType))
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["eventType"] = ["এই খেলার জন্য এই ঘটনার ধরন প্রযোজ্য নয়।"]
            });
        }

        if (!await db.Players.AnyAsync(p => p.Id == request.PlayerId, ct))
        {
            return TypedResults.NotFound("খেলোয়াড় পাওয়া যায়নি।");
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
            entity.EndCoordinateX, entity.EndCoordinateY, entity.Minute);

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
            errors["eventType"] = ["অজানা ঘটনার ধরন।"];
        }

        if (!InRange(r.X) || !InRange(r.Y))
        {
            errors["x"] = ["অবস্থান ০ থেকে ১০০-এর মধ্যে হতে হবে।"];
        }

        if (r.EndX.HasValue != r.EndY.HasValue)
        {
            errors["endX"] = ["তীরের শেষ বিন্দুর দুটি মানই দিন, অথবা কোনোটিই নয়।"];
        }
        else if (r.EndX is { } endX && r.EndY is { } endY && (!InRange(endX) || !InRange(endY)))
        {
            errors["endX"] = ["তীরের শেষ বিন্দু ০ থেকে ১০০-এর মধ্যে হতে হবে।"];
        }

        if (r.Minute is < 0 or > 200)
        {
            errors["minute"] = ["মিনিট ০ থেকে ২০০-এর মধ্যে হতে হবে।"];
        }

        return errors;
    }
}
