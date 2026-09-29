using MagicWall.Api.Data;
using MagicWall.Api.Hubs;
using MagicWall.Api.Wall;
using MagicWall.Api.Workflow;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace MagicWall.Api.Modules.Sports.Feed;

/// <summary>
/// Polls the live sports provider for every match linked to the feed (Match.FeedMatchId) and
/// stores new events as Pending for the sports desk. It never approves anything and never
/// notifies the wall; only the desk's approval does (see SportsReviewEndpoints).
/// </summary>
public sealed class SportsFeedWorker(
    IServiceScopeFactory scopes,
    ISportsFeedProvider provider,
    IOptions<SportsFeedOptions> options,
    IHubContext<MagicWallHub> hub,
    ILogger<SportsFeedWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var settings = options.Value;
        if (!settings.Enabled)
        {
            logger.LogInformation("Sports feed is disabled (Sports:Feed:Enabled = false).");
            return;
        }

        var interval = TimeSpan.FromSeconds(Math.Max(5, settings.IntervalSeconds));
        logger.LogInformation("Sports feed started: provider '{Provider}', every {Seconds}s.", provider.Name, interval.TotalSeconds);

        using var timer = new PeriodicTimer(interval);
        do
        {
            try
            {
                await PollOnceAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                // A provider outage must never take the API down; try again next tick.
                logger.LogError(ex, "Sports feed poll failed; retrying in {Seconds}s.", interval.TotalSeconds);
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    /// <summary>One poll of every linked match. Public so it can be triggered from tests.</summary>
    public async Task<int> PollOnceAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var linked = await db.Matches.AsNoTracking()
            .Where(m => m.FeedMatchId != null)
            .Select(m => new { m.Id, m.FeedMatchId, m.Sport, m.TeamA, m.TeamB })
            .ToListAsync(ct);
        if (linked.Count == 0) return 0;

        var queued = 0;
        foreach (var m in linked)
        {
            var players = await db.Players.AsNoTracking()
                .Where(p => p.Team == m.TeamA || p.Team == m.TeamB)
                .Select(p => new { p.Id, p.Name, p.Team })
                .ToListAsync(ct);

            var match = new FeedMatch(m.Id, m.FeedMatchId!, m.Sport, m.TeamA, m.TeamB,
                players.Select(p => new FeedPlayer(p.Name, p.Team)).ToList());

            IReadOnlyList<FeedEvent> fetched;
            try
            {
                fetched = await provider.FetchAsync(match, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "Feed fetch failed for match {MatchId} ({FeedMatchId}).", m.Id, m.FeedMatchId);
                continue;
            }
            if (fetched.Count == 0) continue;

            // Skip what is already stored: providers resend their whole list on every poll.
            var ids = fetched.Select(e => e.ExternalId).ToList();
            var known = (await db.MatchEvents.Where(e => e.ExternalId != null && ids.Contains(e.ExternalId))
                .Select(e => e.ExternalId!).ToListAsync(ct)).ToHashSet();

            foreach (var item in fetched.Where(e => !known.Contains(e.ExternalId)))
            {
                var player = players.FirstOrDefault(p => p.Team == item.Team && string.Equals(p.Name, item.PlayerName, StringComparison.OrdinalIgnoreCase));
                if (player is null)
                {
                    logger.LogWarning("Feed event {Id}: no player '{Player}' ({Team}) in match {MatchId}; skipped.", item.ExternalId, item.PlayerName, item.Team, m.Id);
                    continue;
                }
                if (!SportEvents.IsValid(m.Sport, item.EventType) || !InRange(item))
                {
                    logger.LogWarning("Feed event {Id}: invalid type or coordinates for {Sport}; skipped.", item.ExternalId, m.Sport);
                    continue;
                }

                db.MatchEvents.Add(new MatchEvent
                {
                    MatchId = m.Id,
                    PlayerId = player.Id,
                    EventType = item.EventType,
                    CoordinateX = item.X,
                    CoordinateY = item.Y,
                    EndCoordinateX = item.EndX,
                    EndCoordinateY = item.EndY,
                    Minute = Math.Max(0, item.Minute),
                    Status = ApprovalStatus.Pending,
                    Source = EventSource.Feed,
                    ExternalId = item.ExternalId,
                    SubmittedBy = $"feed:{provider.Name}"
                });
                queued++;
            }
        }

        if (queued > 0)
        {
            await db.SaveChangesAsync(ct);
            var pending = await db.MatchEvents.CountAsync(e => e.Status == ApprovalStatus.Pending, ct);
            await hub.BroadcastQueueChangedAsync(WallModule.Sports, pending, ct);
            logger.LogInformation("Sports feed queued {Count} event(s) for review; {Pending} pending.", queued, pending);
        }
        return queued;
    }

    private static bool InRange(FeedEvent e)
    {
        static bool Ok(float v) => v is >= 0 and <= 100;
        return Ok(e.X) && Ok(e.Y) && (e.EndX is null || Ok(e.EndX.Value)) && (e.EndY is null || Ok(e.EndY.Value))
               && (e.EndX is null) == (e.EndY is null);
    }
}
