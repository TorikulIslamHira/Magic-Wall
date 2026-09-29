using MagicWall.Api.Data;
using MagicWall.Api.Hubs;
using MagicWall.Api.Wall;
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

public record MatchSummaryDto(int Id, string Title, SportType Sport, DateTime MatchDate, string TeamA, string TeamB);

public record PlayerDto(int Id, string Name, string Team, string Role);

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

        group.MapPost("/events", CreateEvent).RequireAdminKey();
        group.MapDelete("/events/{id:int}", DeleteEvent).RequireAdminKey();

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
        var events = await db.MatchEvents
            .AsNoTracking()
            .Where(e => e.MatchId == matchId && e.PlayerId == playerId)
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

    private static Task<List<MatchSummaryDto>> GetMatches(AppDbContext db, CancellationToken ct) =>
        db.Matches
            .AsNoTracking()
            .OrderByDescending(m => m.MatchDate)
            .Select(m => new MatchSummaryDto(m.Id, m.Title, m.Sport, m.MatchDate, m.TeamA, m.TeamB))
            .ToListAsync(ct);

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

    private static async Task<Results<Created<MatchEventDto>, NotFound<string>, ValidationProblem>> CreateEvent(
        CreateMatchEventRequest request, AppDbContext db, IHubContext<MagicWallHub> hub, CancellationToken ct)
    {
        var errors = Validate(request);
        if (errors.Count > 0)
        {
            return TypedResults.ValidationProblem(errors);
        }

        if (!await db.Matches.AnyAsync(m => m.Id == request.MatchId, ct))
        {
            return TypedResults.NotFound("ম্যাচটি পাওয়া যায়নি।");
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
            Minute = request.Minute
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
