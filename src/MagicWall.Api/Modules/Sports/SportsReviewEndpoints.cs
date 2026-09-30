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

public record QueuedEventDto(
    int Id,
    int MatchId,
    string MatchTitle,
    SportType Sport,
    int PlayerId,
    string PlayerName,
    string Team,
    MatchEventType EventType,
    float? X,
    float? Y,
    float? EndX,
    float? EndY,
    int Minute,
    string? Detail,
    string? PlayerPhoto,
    ApprovalStatus Status,
    EventSource Source,
    string SubmittedBy,
    DateTime SubmittedAt,
    string? ReviewedBy,
    DateTime? ReviewedAt);

public record ReviewEventsRequest(int[] Ids);

public record ReviewEventsResult(int Updated, int Skipped);

/// <summary>
/// The sports desk's queue: feed data waits here as Pending until approved. Bulk actions,
/// because a live match produces events faster than anyone can click through them singly.
/// </summary>
public static class SportsReviewEndpoints
{
    private const int MaxBatch = 500;

    public static IEndpointRouteBuilder MapSportsReviewEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/sports/queue").WithTags("Sports review").RequireAuthorization(Policies.ManageSports);

        group.MapGet("/", List);
        group.MapPost("/approve", Approve);
        group.MapPost("/reject", Reject);

        return app;
    }

    /// <summary>Optional filters: ?status=Pending&amp;matchId=3</summary>
    private static Task<List<QueuedEventDto>> List(ApprovalStatus? status, int? matchId, AppDbContext db, CancellationToken ct)
    {
        var query = db.MatchEvents.AsNoTracking().Where(e => e.Source == EventSource.Feed);
        if (status is not null) query = query.Where(e => e.Status == status);
        if (matchId is not null) query = query.Where(e => e.MatchId == matchId);

        return query
            .OrderBy(e => e.MatchId).ThenBy(e => e.Minute).ThenBy(e => e.Id)
            .Take(MaxBatch)
            .Select(e => new QueuedEventDto(
                e.Id, e.MatchId, e.Match.Title, e.Match.Sport, e.PlayerId, e.Player.Name, e.Player.Team,
                e.EventType, e.CoordinateX, e.CoordinateY, e.EndCoordinateX, e.EndCoordinateY, e.Minute,
                e.Detail, SportsMedia.Url(e.Player.PhotoFile),
                e.Status, e.Source, e.SubmittedBy, e.SubmittedAt, e.ReviewedBy, e.ReviewedAt))
            .ToListAsync(ct);
    }

    private static Task<Results<Ok<ReviewEventsResult>, ValidationProblem>> Approve(
        ReviewEventsRequest request, ClaimsPrincipal user, AppDbContext db, IHubContext<MagicWallHub> hub, CancellationToken ct) =>
        Review(request, ApprovalStatus.Approved, user, db, hub, ct);

    private static Task<Results<Ok<ReviewEventsResult>, ValidationProblem>> Reject(
        ReviewEventsRequest request, ClaimsPrincipal user, AppDbContext db, IHubContext<MagicWallHub> hub, CancellationToken ct) =>
        Review(request, ApprovalStatus.Rejected, user, db, hub, ct);

    private static async Task<Results<Ok<ReviewEventsResult>, ValidationProblem>> Review(
        ReviewEventsRequest request, ApprovalStatus outcome, ClaimsPrincipal user, AppDbContext db,
        IHubContext<MagicWallHub> hub, CancellationToken ct)
    {
        var ids = request.Ids?.Distinct().ToArray() ?? [];
        if (ids.Length is 0 or > MaxBatch)
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["ids"] = [Text.L("১ থেকে ৫০০টি ঘটনা বেছে নিন।", "Select between 1 and 500 events.")] });
        }

        // Which match:player views the wall must redraw after an approval.
        var affected = await db.MatchEvents
            .Where(e => ids.Contains(e.Id) && e.Status == ApprovalStatus.Pending)
            .Select(e => new { e.MatchId, e.PlayerId })
            .Distinct()
            .ToListAsync(ct);

        // Only still-pending rows change: re-clicking, or two desks at once, can't double-review.
        var updated = await db.MatchEvents
            .Where(e => ids.Contains(e.Id) && e.Status == ApprovalStatus.Pending)
            .ExecuteUpdateAsync(set => set
                .SetProperty(e => e.Status, outcome)
                .SetProperty(e => e.ReviewedBy, user.UserName())
                .SetProperty(e => e.ReviewedAt, DateTime.UtcNow), ct);

        if (outcome == ApprovalStatus.Approved)
        {
            foreach (var view in affected)
            {
                await hub.BroadcastDataChangedAsync(WallModule.Sports, $"{view.MatchId}:{view.PlayerId}", ct);
            }
        }
        var pending = await db.MatchEvents.CountAsync(e => e.Status == ApprovalStatus.Pending, ct);
        await hub.BroadcastQueueChangedAsync(WallModule.Sports, pending, ct);

        return TypedResults.Ok(new ReviewEventsResult(updated, ids.Length - updated));
    }
}
