using MagicWall.Api.Auth;
using MagicWall.Api.Data;
using MagicWall.Api.Hosting;
using MagicWall.Api.Hubs;
using MagicWall.Api.Modules.Sports.Feed;
using MagicWall.Api.Modules.Sports.Media;
using MagicWall.Api.Wall;
using MagicWall.Api.Workflow;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace MagicWall.Api.Modules.Sports;

public record MatchDataDto(
    int Id, string Title, SportType Sport, DateTime MatchDate, string? Competition,
    string TeamA, string TeamB, string? TeamABadge, string? TeamBBadge,
    string? FeedMatchId, string? FeedStatus, int? ScoreA, int? ScoreB, DateTime? FeedUpdatedAt,
    int ApprovedEvents, int PendingEvents);

public record TeamDataDto(string Team, string? Badge, string? BadgeSource, DateTime? CheckedAt, int Matches, int Players);

public record PlayerDataDto(
    int Id, string Name, string Team, string Role, string? ExternalId,
    string? Photo, string? PhotoSource, DateTime? MediaCheckedAt, int Events);

public record FeedDataDto(IReadOnlyList<MatchDataDto> Matches, IReadOnlyList<TeamDataDto> Teams);

public record RawPayloadDto(string Provider, DateTime FetchedAt, string Json);

/// <param name="ScoreA">Only for matches not linked to a feed; a linked match's score belongs to the provider.</param>
public record UpdateMatchDataRequest(string Title, string? Competition, DateTime MatchDate, int? ScoreA, int? ScoreB);

public record UpdatePlayerDataRequest(string Name, string? Role);

public record RenameTeamRequest(string From, string To);

public record TeamRequest(string Team);

/// <summary>
/// "Feed data": everything the providers brought in (matches, teams, players, pictures), visible and
/// correctable by the sports desk without the approval queue — that queue is for events that go on
/// air; this is reference data. Every change is saved at once and the wall redraws.
/// </summary>
public static class SportsDataEndpoints
{
    public static IEndpointRouteBuilder MapSportsDataEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/sports/data").WithTags("Sports data").RequireAuthorization(Policies.ManageSports);

        group.MapGet("/", Overview);
        group.MapGet("/players", Players);
        group.MapGet("/raw/{matchId:int}", Raw);
        group.MapPut("/matches/{id:int}", UpdateMatch);
        group.MapPut("/players/{id:int}", UpdatePlayer);
        group.MapPost("/players/{id:int}/refresh-photo", RefreshPhoto);
        group.MapPost("/teams/rename", RenameTeam);
        group.MapPost("/teams/refresh-badge", RefreshBadge);

        return app;
    }

    private static async Task<FeedDataDto> Overview(AppDbContext db, CancellationToken ct)
    {
        var badges = await db.TeamMedia.AsNoTracking().ToDictionaryAsync(t => t.Team, ct);
        var counts = await db.MatchEvents.GroupBy(e => new { e.MatchId, e.Status })
            .Select(g => new { g.Key.MatchId, g.Key.Status, Count = g.Count() }).ToListAsync(ct);
        int Count(int matchId, ApprovalStatus status) => counts.FirstOrDefault(c => c.MatchId == matchId && c.Status == status)?.Count ?? 0;

        var matches = (await db.Matches.AsNoTracking().OrderByDescending(m => m.MatchDate).ToListAsync(ct))
            .Select(m => new MatchDataDto(m.Id, m.Title, m.Sport, m.MatchDate, m.Competition, m.TeamA, m.TeamB,
                SportsMedia.Url(badges.GetValueOrDefault(m.TeamA)?.BadgeFile), SportsMedia.Url(badges.GetValueOrDefault(m.TeamB)?.BadgeFile),
                m.FeedMatchId, m.FeedStatus, m.ScoreA, m.ScoreB, m.FeedUpdatedAt,
                Count(m.Id, ApprovalStatus.Approved), Count(m.Id, ApprovalStatus.Pending)))
            .ToList();

        var playerCounts = await db.Players.GroupBy(p => p.Team).Select(g => new { Team = g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Team, x => x.Count, ct);
        var teams = matches.SelectMany(m => new[] { m.TeamA, m.TeamB }).Distinct().OrderBy(t => t)
            .Select(team =>
            {
                var media = badges.GetValueOrDefault(team);
                return new TeamDataDto(team, SportsMedia.Url(media?.BadgeFile), media?.BadgeSourceUrl, media?.CheckedAt,
                    matches.Count(m => m.TeamA == team || m.TeamB == team), playerCounts.GetValueOrDefault(team));
            })
            .ToList();

        return new FeedDataDto(matches, teams);
    }

    private static async Task<Results<Ok<List<PlayerDataDto>>, NotFound>> Players(int matchId, AppDbContext db, CancellationToken ct)
    {
        var match = await db.Matches.AsNoTracking().Where(m => m.Id == matchId).Select(m => new { m.TeamA, m.TeamB }).SingleOrDefaultAsync(ct);
        if (match is null) return TypedResults.NotFound();

        var players = await db.Players.AsNoTracking()
            .Where(p => p.Team == match.TeamA || p.Team == match.TeamB)
            .OrderBy(p => p.Team).ThenBy(p => p.Name)
            .Select(p => new PlayerDataDto(p.Id, p.Name, p.Team, p.Role, p.ExternalId,
                SportsMedia.Url(p.PhotoFile), p.PhotoSourceUrl, p.MediaCheckedAt,
                p.Events.Count(e => e.MatchId == matchId)))
            .ToListAsync(ct);
        return TypedResults.Ok(players);
    }

    private static async Task<Results<Ok<RawPayloadDto>, NotFound<string>>> Raw(int matchId, AppDbContext db, FeedPayloadLog payloads, CancellationToken ct)
    {
        var feedId = await db.Matches.Where(m => m.Id == matchId).Select(m => m.FeedMatchId).SingleOrDefaultAsync(ct);
        var entry = feedId is null ? null : payloads.Get(feedId);
        return entry is null
            ? TypedResults.NotFound(Text.L("এই ম্যাচের কোনো কাঁচা ডেটা এখনো আসেনি (সার্ভার চালু হওয়ার পর থেকে)।",
                                           "No raw data has come in for this match yet (since the server started)."))
            : TypedResults.Ok(new RawPayloadDto(entry.Provider, entry.FetchedAt, entry.Json));
    }

    private static async Task<Results<NoContent, NotFound, ValidationProblem>> UpdateMatch(
        int id, UpdateMatchDataRequest request, AppDbContext db, IHubContext<MagicWallHub> hub, CancellationToken ct)
    {
        var match = await db.Matches.FindAsync([id], ct);
        if (match is null) return TypedResults.NotFound();

        var title = request.Title?.Trim() ?? string.Empty;
        var competition = string.IsNullOrWhiteSpace(request.Competition) ? null : request.Competition.Trim();
        var errors = new Dictionary<string, string[]>();
        if (title.Length is 0 or > 200) errors["title"] = [Text.L("ম্যাচের শিরোনাম দিন (সর্বোচ্চ ২০০ অক্ষর)।", "Enter a match title (up to 200 characters).")];
        if (competition is { Length: > 100 }) errors["competition"] = [Text.L("প্রতিযোগিতা সর্বোচ্চ ১০০ অক্ষর হতে পারে।", "The competition can be up to 100 characters.")];
        var scoreChanged = request.ScoreA != match.ScoreA || request.ScoreB != match.ScoreB;
        if (scoreChanged && match.FeedMatchId is not null)
            errors["scoreA"] = [Text.L("এই ম্যাচের স্কোর লাইভ ফিড থেকে আসে; বদলাতে আগে ফিড বন্ধ করুন।", "This match's score comes from the live feed; unlink the feed to change it.")];
        if (request.ScoreA is < 0 or > 999 || request.ScoreB is < 0 or > 999 || (request.ScoreA is null) != (request.ScoreB is null))
            errors["scoreB"] = [Text.L("দুই দলের স্কোরই দিন (০ বা বেশি), অথবা কোনোটিই নয়।", "Give both teams' scores (0 or more), or neither.")];
        if (errors.Count > 0) return TypedResults.ValidationProblem(errors);

        match.Title = title;
        match.Competition = competition;
        match.MatchDate = request.MatchDate;
        match.ScoreA = request.ScoreA;
        match.ScoreB = request.ScoreB;
        await db.SaveChangesAsync(ct);
        await hub.BroadcastDataChangedAsync(WallModule.Sports, $"{id}:score", ct);
        return TypedResults.NoContent();
    }

    private static async Task<Results<NoContent, NotFound, ValidationProblem>> UpdatePlayer(
        int id, UpdatePlayerDataRequest request, AppDbContext db, IHubContext<MagicWallHub> hub, CancellationToken ct)
    {
        var player = await db.Players.FindAsync([id], ct);
        if (player is null) return TypedResults.NotFound();

        var name = request.Name?.Trim() ?? string.Empty;
        var role = request.Role?.Trim() ?? string.Empty;
        var errors = new Dictionary<string, string[]>();
        if (name.Length is 0 or > 150) errors["name"] = [Text.L("খেলোয়াড়ের নাম দিন (সর্বোচ্চ ১৫০ অক্ষর)।", "Enter the player's name (up to 150 characters).")];
        if (role.Length > 50) errors["role"] = [Text.L("ভূমিকা সর্বোচ্চ ৫০ অক্ষর হতে পারে।", "The role can be up to 50 characters.")];
        if (errors.Count > 0) return TypedResults.ValidationProblem(errors);

        // Feed events keep matching this player by provider id, so a corrected name sticks.
        player.Name = name;
        player.Role = role;
        await db.SaveChangesAsync(ct);
        await hub.BroadcastDataChangedAsync(WallModule.Sports, "media", ct);
        return TypedResults.NoContent();
    }

    /// <summary>Forget the photo (e.g. the wrong person was matched); the media worker looks it up again.</summary>
    private static async Task<Results<NoContent, NotFound>> RefreshPhoto(
        int id, AppDbContext db, SportsMediaSignal media, IHubContext<MagicWallHub> hub, CancellationToken ct)
    {
        var updated = await db.Players.Where(p => p.Id == id).ExecuteUpdateAsync(set => set
            .SetProperty(p => p.PhotoFile, (string?)null)
            .SetProperty(p => p.PhotoSourceUrl, (string?)null)
            .SetProperty(p => p.MediaCheckedAt, (DateTime?)null), ct);
        if (updated == 0) return TypedResults.NotFound();
        media.Nudge();
        await hub.BroadcastDataChangedAsync(WallModule.Sports, "media", ct);
        return TypedResults.NoContent();
    }

    private static async Task<Results<NoContent, NotFound>> RefreshBadge(
        TeamRequest request, AppDbContext db, SportsMediaSignal media, IHubContext<MagicWallHub> hub, CancellationToken ct)
    {
        var removed = await db.TeamMedia.Where(t => t.Team == request.Team).ExecuteDeleteAsync(ct);
        if (removed == 0 && !await db.Matches.AnyAsync(m => m.TeamA == request.Team || m.TeamB == request.Team, ct)) return TypedResults.NotFound();
        media.Nudge();
        await hub.BroadcastDataChangedAsync(WallModule.Sports, "media", ct);
        return TypedResults.NoContent();
    }

    /// <summary>
    /// Correct a team's name everywhere (matches, players, badge). Renaming onto an existing team
    /// merges the two ("Arsenal FC" into "Arsenal"). Feeds map teams by home/away, so links survive.
    /// </summary>
    private static async Task<Results<NoContent, NotFound, ValidationProblem>> RenameTeam(
        RenameTeamRequest request, AppDbContext db, SportsMediaSignal media, IHubContext<MagicWallHub> hub, CancellationToken ct)
    {
        var from = request.From?.Trim() ?? string.Empty;
        var to = request.To?.Trim() ?? string.Empty;
        if (to.Length is 0 or > 100)
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["to"] = [Text.L("দলের নাম দিন (সর্বোচ্চ ১০০ অক্ষর)।", "Enter the team name (up to 100 characters).")] });
        if (!await db.Matches.AnyAsync(m => m.TeamA == from || m.TeamB == from, ct)) return TypedResults.NotFound();
        if (from == to) return TypedResults.NoContent();
        if (await db.Matches.AnyAsync(m => (m.TeamA == from && m.TeamB == to) || (m.TeamA == to && m.TeamB == from), ct))
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["to"] = [Text.L("এই দুই দল একই ম্যাচে খেলছে — একটিকে অন্যটির নাম দেওয়া যায় না।", "These two teams play each other — one can't take the other's name.")] });

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.Matches.Where(m => m.TeamA == from).ExecuteUpdateAsync(s => s.SetProperty(m => m.TeamA, to), ct);
        await db.Matches.Where(m => m.TeamB == from).ExecuteUpdateAsync(s => s.SetProperty(m => m.TeamB, to), ct);
        await db.Players.Where(p => p.Team == from).ExecuteUpdateAsync(s => s.SetProperty(p => p.Team, to), ct);
        // Badge: keep the target's if it has one, else carry this one over.
        if (await db.TeamMedia.AnyAsync(t => t.Team == to, ct)) await db.TeamMedia.Where(t => t.Team == from).ExecuteDeleteAsync(ct);
        else await db.TeamMedia.Where(t => t.Team == from).ExecuteUpdateAsync(s => s.SetProperty(t => t.Team, to), ct);
        await tx.CommitAsync(ct);

        media.Nudge();
        await hub.BroadcastDataChangedAsync(WallModule.Sports, "media", ct);
        return TypedResults.NoContent();
    }
}
