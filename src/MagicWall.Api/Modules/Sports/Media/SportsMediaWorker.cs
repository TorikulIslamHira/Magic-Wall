using MagicWall.Api.Data;
using MagicWall.Api.Hubs;
using MagicWall.Api.Wall;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace MagicWall.Api.Modules.Sports.Media;

/// <summary>Lets the feed wake the media worker as soon as it has created players or a match.</summary>
public sealed class SportsMediaSignal
{
    private readonly SemaphoreSlim _signal = new(0, 1);

    public void Nudge()
    {
        if (_signal.CurrentCount == 0) try { _signal.Release(); } catch (SemaphoreFullException) { }
    }

    public Task WaitAsync(TimeSpan timeout, CancellationToken ct) => _signal.WaitAsync(timeout, ct);
}

/// <summary>
/// Fetches player photos and team badges in the background, apart from the score feed, so a slow
/// or missing picture never delays a goal reaching the sports desk. Works through players and
/// teams that have not been looked up yet (and retries misses after a few days), within
/// TheSportsDB's rate limit, then tells the wall to refresh.
/// </summary>
public sealed class SportsMediaWorker(
    IServiceScopeFactory scopes,
    ISportsMediaProvider provider,
    MediaStore store,
    SportsMediaSignal signal,
    IOptions<SportsMediaOptions> options,
    IHubContext<MagicWallHub> hub,
    ILogger<SportsMediaWorker> logger) : BackgroundService
{
    private const int BatchSize = 10;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Value.Enabled)
        {
            logger.LogInformation("Sports media lookups are disabled (Sports:Media:Enabled = false).");
            return;
        }
        logger.LogInformation("Sports media: photos and badges from {Provider}.", provider.Name);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var found = await RunOnceAsync(stoppingToken);
                if (found.More) continue;   // a full batch: keep going without waiting
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Sports media lookup failed; retrying later.");
            }
            try
            {
                await signal.WaitAsync(TimeSpan.FromMinutes(2), stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    /// <summary>One batch of lookups. Public so tests can drive it.</summary>
    public async Task<(int Saved, bool More)> RunOnceAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var retryBefore = DateTime.UtcNow.AddDays(-Math.Max(1, options.Value.RetryMissAfterDays));
        var saved = 0;

        // Teams first: a handful per match, and every event card shows the badge.
        var teamNames = await db.Matches.Select(m => m.TeamA).Union(db.Matches.Select(m => m.TeamB)).ToListAsync(ct);
        var known = await db.TeamMedia.ToDictionaryAsync(t => t.Team, ct);
        var teamSports = await db.Matches.Select(m => new { m.TeamA, m.TeamB, m.Sport }).ToListAsync(ct);
        var dueTeams = teamNames
            .Where(name => !known.TryGetValue(name, out var t) || (t.BadgeFile is null && t.CheckedAt < retryBefore))
            .Take(BatchSize).ToList();

        foreach (var team in dueTeams)
        {
            var sport = teamSports.First(m => m.TeamA == team || m.TeamB == team).Sport;
            var row = known.GetValueOrDefault(team) ?? db.TeamMedia.Add(new TeamMedia { Team = team }).Entity;
            row.CheckedAt = DateTime.UtcNow;
            if (!IsLatin(team)) continue;   // TheSportsDB is indexed by English names

            var (url, file, failed) = await LookUpAsync(() => provider.FindTeamBadgeAsync(team, sport, ct), "teams", team, ct);
            if (file is not null)
            {
                (row.BadgeSourceUrl, row.BadgeFile) = (url, file);
                saved++;
            }
            else if (failed) row.CheckedAt = null;   // provider trouble, not a miss: try again next round
        }

        var duePlayers = await db.Players
            .Where(p => p.MediaCheckedAt == null || (p.PhotoFile == null && p.MediaCheckedAt < retryBefore))
            .OrderBy(p => p.MediaCheckedAt != null).ThenByDescending(p => p.Id)   // never-checked (newest) first
            .Take(BatchSize)
            .ToListAsync(ct);

        foreach (var player in duePlayers)
        {
            player.MediaCheckedAt = DateTime.UtcNow;
            if (!IsLatin(player.Name)) continue;
            var sport = teamSports.FirstOrDefault(m => m.TeamA == player.Team || m.TeamB == player.Team)?.Sport ?? SportType.Football;

            var (url, file, failed) = await LookUpAsync(() => provider.FindPlayerPhotoAsync(player.Name, player.Team, sport, ct), "players", player.Name, ct);
            if (file is not null)
            {
                (player.PhotoSourceUrl, player.PhotoFile) = (url, file);
                saved++;
            }
            else if (failed) player.MediaCheckedAt = null;
        }

        await db.SaveChangesAsync(ct);
        if (saved > 0)
        {
            // New faces and badges: the wall redraws the match on air.
            await hub.BroadcastDataChangedAsync(WallModule.Sports, "media", ct);
            logger.LogInformation("Sports media: {Saved} new picture(s).", saved);
        }
        // Carry straight on only while lookups are succeeding; during an outage, wait for the next round.
        return (saved, saved > 0 && (dueTeams.Count == BatchSize || duePlayers.Count == BatchSize));
    }

    /// <summary>
    /// Find + download one picture. "Failed" means the provider had trouble (retry soon), as opposed
    /// to a clean miss (no picture exists; retried after RetryMissAfterDays). Never fatal for the batch.
    /// </summary>
    private async Task<(string? Url, string? File, bool Failed)> LookUpAsync(Func<Task<string?>> find, string kind, string name, CancellationToken ct)
    {
        try
        {
            var url = await find();
            var file = url is null ? null : await store.DownloadAsync(url, kind, name, ct);
            return (url, file, false);
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            logger.LogWarning("Sports media: lookup for '{Name}' failed: {Message}", name, ex.Message);
            return (null, null, true);
        }
    }

    /// <summary>Latin script (with accents) only: Bangla demo names have no entry to find.</summary>
    private static bool IsLatin(string name) =>
        name.Any(char.IsLetter) && name.All(c => !char.IsLetter(c) || c <= 'ɏ');
}
