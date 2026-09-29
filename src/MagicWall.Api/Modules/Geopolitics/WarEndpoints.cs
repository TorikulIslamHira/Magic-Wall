using MagicWall.Api.Auth;
using MagicWall.Api.Data;
using MagicWall.Api.Hubs;
using MagicWall.Api.Wall;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace MagicWall.Api.Modules.Geopolitics;

public record TimelineEventDto(
    int Id,
    DateOnly Date,
    string ControllingForce,
    int Casualties,
    string Description);

/// <summary>
/// A zone's history up to <see cref="AsOf"/>, plus its state on that date
/// (who controls it and cumulative casualties) for the timeline slider.
/// </summary>
public record ZoneTimelineDto(
    int ZoneId,
    string RegionName,
    string SvgPathId,
    DateOnly AsOf,
    string? CurrentControllingForce,
    int CumulativeCasualties,
    IReadOnlyList<TimelineEventDto> Events);

/// <summary>A zone with its complete history, so the wall's slider can scrub without refetching.</summary>
public record ZoneHistoryDto(int Id, string RegionName, string SvgPathId, IReadOnlyList<TimelineEventDto> Events);

public record CreateZoneRequest(string RegionName, string SvgPathId);

public record CreateTimelineEventRequest(
    int ConflictZoneId,
    DateOnly Date,
    string ControllingForce,
    int Casualties,
    string? Description);

public static class WarEndpoints
{
    public static IEndpointRouteBuilder MapWarEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/war").WithTags("War & Geopolitics");

        // {date} is ISO yyyy-MM-dd, e.g. /api/war/timeline/Gaza%20Strip/2024-05-01
        group.MapGet("/timeline/{regionName}/{date}", GetTimelineUpToDate);
        group.MapGet("/zones", GetZones);

        group.MapPost("/zones", CreateZone).RequireAuthorization(Policies.EditDesk);
        group.MapPost("/events", CreateEvent).RequireAuthorization(Policies.EditDesk);
        group.MapDelete("/events/{id:int}", DeleteEvent).RequireAuthorization(Policies.EditDesk);

        return app;
    }

    private static async Task<Results<Ok<ZoneTimelineDto>, NotFound>> GetTimelineUpToDate(
        string regionName, DateOnly date, AppDbContext db, CancellationToken ct)
    {
        // Case-insensitive so presenters/producers don't have to match capitalisation.
        var normalizedRegion = regionName.Trim().ToLower();

        var zone = await db.ConflictZones
            .AsNoTracking()
            .Where(z => z.RegionName.ToLower() == normalizedRegion)
            .Select(z => new
            {
                z.Id,
                z.RegionName,
                z.SvgPathId,
                Events = z.TimelineEvents
                    .Where(e => e.Date <= date)
                    .OrderBy(e => e.Date)
                    .ThenBy(e => e.Id)
                    .Select(e => new TimelineEventDto(
                        e.Id, e.Date, e.ControllingForce, e.Casualties, e.Description))
                    .ToList()
            })
            .SingleOrDefaultAsync(ct);

        if (zone is null)
        {
            return TypedResults.NotFound();
        }

        return TypedResults.Ok(new ZoneTimelineDto(
            zone.Id,
            zone.RegionName,
            zone.SvgPathId,
            date,
            zone.Events.LastOrDefault()?.ControllingForce,
            zone.Events.Sum(e => e.Casualties),
            zone.Events));
    }

    private static Task<List<ZoneHistoryDto>> GetZones(AppDbContext db, CancellationToken ct) =>
        db.ConflictZones
            .AsNoTracking()
            .OrderBy(z => z.RegionName)
            .Select(z => new ZoneHistoryDto(
                z.Id,
                z.RegionName,
                z.SvgPathId,
                z.TimelineEvents
                    .OrderBy(e => e.Date)
                    .ThenBy(e => e.Id)
                    .Select(e => new TimelineEventDto(e.Id, e.Date, e.ControllingForce, e.Casualties, e.Description))
                    .ToList()))
            .ToListAsync(ct);

    private static async Task<Results<Created<ZoneHistoryDto>, Conflict<string>, ValidationProblem>> CreateZone(
        CreateZoneRequest request, AppDbContext db, IHubContext<MagicWallHub> hub, CancellationToken ct)
    {
        var regionName = request.RegionName?.Trim() ?? string.Empty;
        var svgPathId = request.SvgPathId?.Trim() ?? string.Empty;

        var errors = new Dictionary<string, string[]>();
        if (regionName.Length is 0 or > 150) errors["regionName"] = ["অঞ্চলের নাম দিন (সর্বোচ্চ ১৫০ অক্ষর)।"];
        if (svgPathId.Length is 0 or > 100) errors["svgPathId"] = ["মানচিত্র কোড দিন (সর্বোচ্চ ১০০ অক্ষর)।"];
        if (errors.Count > 0) return TypedResults.ValidationProblem(errors);

        if (await db.ConflictZones.AnyAsync(z => z.SvgPathId == svgPathId, ct))
        {
            return TypedResults.Conflict($"\"{svgPathId}\" মানচিত্র কোড আগেই অন্য একটি অঞ্চলে ব্যবহৃত হয়েছে।");
        }

        var zone = new ConflictZone { RegionName = regionName, SvgPathId = svgPathId };
        db.ConflictZones.Add(zone);
        await db.SaveChangesAsync(ct);
        await hub.BroadcastDataChangedAsync(WallModule.War, "*", ct);

        return TypedResults.Created($"/api/war/zones/{zone.Id}", new ZoneHistoryDto(zone.Id, zone.RegionName, zone.SvgPathId, []));
    }

    private static async Task<Results<Created<TimelineEventDto>, NotFound<string>, ValidationProblem>> CreateEvent(
        CreateTimelineEventRequest request, AppDbContext db, IHubContext<MagicWallHub> hub, CancellationToken ct)
    {
        var force = request.ControllingForce?.Trim() ?? string.Empty;
        var description = request.Description?.Trim() ?? string.Empty;

        var errors = new Dictionary<string, string[]>();
        if (force.Length is 0 or > 150) errors["controllingForce"] = ["নিয়ন্ত্রণকারী পক্ষের নাম দিন (সর্বোচ্চ ১৫০ অক্ষর)।"];
        if (request.Casualties < 0) errors["casualties"] = ["হতাহতের সংখ্যা ঋণাত্মক হতে পারে না।"];
        if (description.Length > 2000) errors["description"] = ["বিবরণ সর্বোচ্চ ২০০০ অক্ষর হতে পারে।"];
        if (errors.Count > 0) return TypedResults.ValidationProblem(errors);

        var regionName = await db.ConflictZones
            .Where(z => z.Id == request.ConflictZoneId)
            .Select(z => z.RegionName)
            .SingleOrDefaultAsync(ct);

        if (regionName is null)
        {
            return TypedResults.NotFound("সংঘাতপূর্ণ অঞ্চলটি পাওয়া যায়নি।");
        }

        var entity = new TimelineEvent
        {
            ConflictZoneId = request.ConflictZoneId,
            Date = request.Date,
            ControllingForce = force,
            Casualties = request.Casualties,
            Description = description
        };

        db.TimelineEvents.Add(entity);
        await db.SaveChangesAsync(ct);
        await hub.BroadcastDataChangedAsync(WallModule.War, regionName, ct);

        return TypedResults.Created(
            $"/api/war/events/{entity.Id}",
            new TimelineEventDto(entity.Id, entity.Date, entity.ControllingForce, entity.Casualties, entity.Description));
    }

    private static async Task<Results<NoContent, NotFound>> DeleteEvent(
        int id, AppDbContext db, IHubContext<MagicWallHub> hub, CancellationToken ct)
    {
        var entity = await db.TimelineEvents
            .Include(e => e.ConflictZone)
            .SingleOrDefaultAsync(e => e.Id == id, ct);

        if (entity is null)
        {
            return TypedResults.NotFound();
        }

        db.TimelineEvents.Remove(entity);
        await db.SaveChangesAsync(ct);
        await hub.BroadcastDataChangedAsync(WallModule.War, entity.ConflictZone.RegionName, ct);

        return TypedResults.NoContent();
    }
}
