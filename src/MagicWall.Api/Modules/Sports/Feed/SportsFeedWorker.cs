using MagicWall.Api.Data;
using MagicWall.Api.Hubs;
using MagicWall.Api.Modules.Sports.Media;
using MagicWall.Api.Wall;
using MagicWall.Api.Workflow;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace MagicWall.Api.Modules.Sports.Feed;

/// <summary>
/// Polls the live sports provider for every match linked to the feed (Match.FeedMatchId):
///  - events are stored as Pending for the sports desk; the worker never approves anything;
///  - score and status are the provider's live state and go straight to the wall;
///  - players the feed names but we don't know yet are created, and the media worker is woken
///    to find their photos (asynchronously: a slow picture never delays a goal).
/// Each poll is one request per match that needs one (see <see cref="IsDue"/>); the provider's
/// HttpClient waits on its rate gate, so the quota is respected however many matches are linked.
/// </summary>
public sealed class SportsFeedWorker(
    IServiceScopeFactory scopes,
    ISportsFeedProvider provider,
    SportsMediaSignal mediaSignal,
    IOptions<SportsFeedOptions> options,
    IHubContext<MagicWallHub> hub,
    ILogger<SportsFeedWorker> logger) : BackgroundService
{
    private static readonly HashSet<string> Live = new(StringComparer.OrdinalIgnoreCase) { "IN_PLAY", "PAUSED", "LIVE" };
    private static readonly HashSet<string> Over = new(StringComparer.OrdinalIgnoreCase) { "FINISHED", "AWARDED", "CANCELLED", "POSTPONED", "SUSPENDED" };

    /// <summary>Stored when the provider doesn't know the linked id; the desk sees it, and it's rarely re-checked.</summary>
    public const string NotFound = "NOT_FOUND";
    private static readonly TimeSpan MaxBackoff = TimeSpan.FromMinutes(15);

    // Matches whose last fetch failed: skip them until the time given, so one broken or retired
    // match can't eat the quota the live ones need. Transient errors double the wait each time;
    // an id the provider doesn't know waits the maximum at once. Keyed by the feed id too, so
    // correcting a wrong id is polled straight away.
    private readonly Dictionary<(int MatchId, string FeedMatchId), (int Failures, DateTime RetryAt)> _backoff = [];

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

    /// <summary>
    /// Whether a match needs a request now. Live matches: every poll. Not started: every 15 min,
    /// then every poll from 10 min before kick-off. Over: every 30 min, for late corrections.
    /// Unknown to the provider: every 15 min (survives restarts, unlike the in-memory backoff).
    /// Providers without a status (demo, custom HTTP) are polled every time.
    /// </summary>
    public static bool IsDue(string? status, DateTime kickoffUtc, DateTime? updatedAt, DateTime now)
    {
        if (status == NotFound) return updatedAt is null || now - updatedAt >= TimeSpan.FromMinutes(15);
        if (status is null || updatedAt is null || Live.Contains(status)) return true;
        if (Over.Contains(status)) return now - updatedAt >= TimeSpan.FromMinutes(30);
        return kickoffUtc - now <= TimeSpan.FromMinutes(10) || now - updatedAt >= TimeSpan.FromMinutes(15);
    }

    /// <summary>One poll of every linked match that is due. Public so it can be triggered from tests.</summary>
    public async Task<int> PollOnceAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var now = DateTime.UtcNow;

        var linked = (await db.Matches
                .Where(m => m.FeedMatchId != null)
                .ToListAsync(ct))
            .Where(m => IsDue(m.FeedStatus, m.MatchDate, m.FeedUpdatedAt, now))
            .Where(m => !_backoff.TryGetValue((m.Id, m.FeedMatchId!), out var b) || b.RetryAt <= now)
            .ToList();
        if (linked.Count == 0) return 0;

        var queued = 0;
        var createdPlayers = 0;
        var changedScores = new List<int>();

        foreach (var m in linked)
        {
            var players = await db.Players
                .Where(p => p.Team == m.TeamA || p.Team == m.TeamB)
                .ToListAsync(ct);

            var match = new FeedMatch(m.Id, m.FeedMatchId!, m.Sport, m.TeamA, m.TeamB,
                players.Select(p => new FeedPlayer(p.Name, p.Team)).ToList());

            FeedSnapshot snapshot;
            try
            {
                snapshot = await provider.FetchAsync(match, ct);
            }
            catch (Exception ex) when (!ct.IsCancellationRequested)
            {
                // One match failing (timeout, provider error, unknown id) must not stop the others.
                var key = (m.Id, m.FeedMatchId!);
                var failures = _backoff.GetValueOrDefault(key).Failures + 1;
                var wait = ex is FeedMatchNotFoundException
                    ? MaxBackoff
                    : TimeSpan.FromSeconds(Math.Min(MaxBackoff.TotalSeconds, options.Value.IntervalSeconds * Math.Pow(2, failures)));
                _backoff[key] = (failures, now + wait);
                if (ex is FeedMatchNotFoundException)
                {
                    // Remember across restarts, and show the desk that the link is wrong.
                    if (m.FeedStatus != NotFound) changedScores.Add(m.Id);
                    m.FeedStatus = NotFound;
                    m.FeedUpdatedAt = now;
                }
                logger.LogWarning("Feed fetch failed for match {MatchId} ({FeedMatchId}): {Message} Next try in {Seconds:0}s.",
                    m.Id, m.FeedMatchId, ex.Message, wait.TotalSeconds);
                continue;
            }
            _backoff.Remove((m.Id, m.FeedMatchId!));

            if (snapshot.State is { } state)
            {
                if (m.FeedStatus != state.Status || m.ScoreA != state.ScoreA || m.ScoreB != state.ScoreB) changedScores.Add(m.Id);
                m.FeedStatus = state.Status;
                m.ScoreA = state.ScoreA;
                m.ScoreB = state.ScoreB;
                m.FeedUpdatedAt = now;
            }
            if (snapshot.Events.Count == 0) continue;

            // Skip what is already stored: providers resend their whole list on every poll.
            var ids = snapshot.Events.Select(e => e.ExternalId).ToList();
            var known = (await db.MatchEvents.Where(e => e.ExternalId != null && ids.Contains(e.ExternalId))
                .Select(e => e.ExternalId!).ToListAsync(ct)).ToHashSet();

            foreach (var item in snapshot.Events.Where(e => !known.Contains(e.ExternalId)))
            {
                if (!SportEvents.IsValid(m.Sport, item.EventType) || !InRange(item) || (item.Team != m.TeamA && item.Team != m.TeamB))
                {
                    logger.LogWarning("Feed event {Id}: invalid type, team or coordinates for {Sport}; skipped.", item.ExternalId, m.Sport);
                    continue;
                }

                var player = FindPlayer(players, item);
                if (player is null && item.PlayerExternalId is not null && !string.IsNullOrWhiteSpace(item.PlayerName))
                {
                    // A real feed names the real squad: add the player instead of losing the goal.
                    var name = item.PlayerName.Trim();
                    player = new Player { Name = name.Length > 150 ? name[..150] : name, Team = item.Team, ExternalId = item.PlayerExternalId };
                    db.Players.Add(player);
                    players.Add(player);
                    createdPlayers++;
                }
                if (player is null)
                {
                    logger.LogWarning("Feed event {Id}: no player '{Player}' ({Team}) in match {MatchId}; skipped.", item.ExternalId, item.PlayerName, item.Team, m.Id);
                    continue;
                }

                db.MatchEvents.Add(new MatchEvent
                {
                    MatchId = m.Id,
                    Player = player,
                    EventType = item.EventType,
                    CoordinateX = item.X,
                    CoordinateY = item.Y,
                    EndCoordinateX = item.EndX,
                    EndCoordinateY = item.EndY,
                    Minute = Math.Max(0, item.Minute),
                    Detail = item.Detail is { Length: > 200 } d ? d[..200] : item.Detail,
                    Status = ApprovalStatus.Pending,
                    Source = EventSource.Feed,
                    ExternalId = item.ExternalId,
                    SubmittedBy = $"feed:{provider.Name}"
                });
                queued++;
            }
        }

        await db.SaveChangesAsync(ct);

        foreach (var id in changedScores)
        {
            // Score and status are the provider's official state: straight to the wall.
            await hub.BroadcastDataChangedAsync(WallModule.Sports, $"{id}:score", ct);
        }
        if (createdPlayers > 0)
        {
            logger.LogInformation("Sports feed added {Count} player(s) from the provider.", createdPlayers);
            mediaSignal.Nudge();
        }
        if (queued > 0)
        {
            var pending = await db.MatchEvents.CountAsync(e => e.Status == ApprovalStatus.Pending, ct);
            await hub.BroadcastQueueChangedAsync(WallModule.Sports, pending, ct);
            logger.LogInformation("Sports feed queued {Count} event(s) for review; {Pending} pending.", queued, pending);
        }
        return queued;
    }

    /// <summary>By provider id first (names can change spelling), then by name within the team.</summary>
    private static Player? FindPlayer(List<Player> players, FeedEvent item) =>
        (item.PlayerExternalId is null ? null : players.FirstOrDefault(p => p.ExternalId == item.PlayerExternalId))
        ?? players.FirstOrDefault(p => p.Team == item.Team && string.Equals(p.Name, item.PlayerName, StringComparison.OrdinalIgnoreCase));

    private static bool InRange(FeedEvent e)
    {
        static bool Ok(float? v) => v is null or (>= 0 and <= 100);
        return Ok(e.X) && Ok(e.Y) && Ok(e.EndX) && Ok(e.EndY)
               && (e.X is null) == (e.Y is null)
               && (e.EndX is null) == (e.EndY is null)
               && (e.EndX is null || e.X is not null);
    }
}
