using MagicWall.Api.Hosting;
using MagicWall.Api.Auth;
using MagicWall.Api.Data;
using MagicWall.Api.Modules.Sports.Media;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace MagicWall.Api.Modules.Sports.Feed;

public record FeedStatusDto(string Provider, bool CanImport, IReadOnlyList<string> Competitions, bool MediaEnabled, string? MediaProvider);

/// <param name="MatchId">Our match, if this fixture has been imported already.</param>
public record FixtureDto(
    string FeedMatchId, string Competition, DateTime KickoffUtc, string HomeTeam, string AwayTeam,
    string Status, int? ScoreHome, int? ScoreAway, int? MatchId, string? HomeBadge = null, string? AwayBadge = null);

public record ImportFixtureRequest(string FeedMatchId, string Competition);

/// <summary>
/// The sports desk browses the provider's schedule and imports the matches it will cover: the
/// match is created with the provider's teams (home = TeamA) and linked to the feed at once.
/// Fixture lists are cached for five minutes, because every call spends the provider's quota.
/// </summary>
public static class SportsFeedEndpoints
{
    private static readonly TimeSpan FixtureCache = TimeSpan.FromMinutes(5);

    public static IEndpointRouteBuilder MapSportsFeedEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/sports/feed").WithTags("Sports feed").RequireAuthorization(Policies.ManageSports);

        group.MapGet("/status", Status);
        group.MapGet("/fixtures", Fixtures);
        group.MapPost("/import", Import);

        return app;
    }

    /// <summary>Serves downloaded photos and badges (from the server's own disk, never the internet).</summary>
    public static IEndpointRouteBuilder MapSportsMediaEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet($"{SportsMedia.RoutePrefix}{{kind}}/{{file}}", (string kind, string file, MediaStore store, HttpContext http) =>
        {
            var path = store.Resolve(kind, file);
            if (path is null) return Results.NotFound();
            // File names carry a content hash, so a changed picture gets a new name: cache hard.
            http.Response.Headers.CacheControl = "public, max-age=604800, immutable";
            var type = Path.GetExtension(path) switch { ".png" => "image/png", ".webp" => "image/webp", _ => "image/jpeg" };
            return Results.File(path, type);
        }).ExcludeFromDescription();
        return app;
    }

    private static FeedStatusDto Status(ISportsFeedProvider provider, IOptions<SportsMediaOptions> media, IServiceProvider services)
    {
        var fixtures = provider as IFixtureSource;
        return new FeedStatusDto(provider.Name, fixtures is not null, fixtures?.Competitions ?? [],
            media.Value.Enabled, media.Value.Enabled ? services.GetService<ISportsMediaProvider>()?.Name : null);
    }

    /// <summary>?competition=PL — yesterday to 10 days ahead.</summary>
    private static async Task<Results<Ok<List<FixtureDto>>, NotFound<string>, ValidationProblem, ProblemHttpResult>> Fixtures(
        string? competition, ISportsFeedProvider provider, IMemoryCache cache, AppDbContext db, ILoggerFactory loggers, CancellationToken ct)
    {
        if (provider is not IFixtureSource source) return TypedResults.NotFound(Text.L("এই ফিড প্রোভাইডার সূচি দেয় না।", "This feed provider doesn't publish fixtures."));
        if (string.IsNullOrWhiteSpace(competition) || !source.Competitions.Contains(competition))
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["competition"] = [Text.L("তালিকা থেকে একটি প্রতিযোগিতা বেছে নিন।", "Choose a competition from the list.")] });
        }

        List<FeedFixture> fixtures;
        try
        {
            fixtures = await LoadFixturesAsync(source, competition, cache, ct);
        }
        catch (HttpRequestException ex)
        {
            loggers.CreateLogger("MagicWall.SportsFeed").LogWarning("Fixture list for {Competition} failed: {Message}", competition, ex.Message);
            return TypedResults.Problem(Text.L($"প্রোভাইডার থেকে সূচি আনা যায়নি: {ex.Message}", $"Couldn't load fixtures from the provider: {ex.Message}"), statusCode: StatusCodes.Status502BadGateway);
        }

        var ids = fixtures.Select(f => f.FeedMatchId).ToList();
        var imported = await db.Matches.Where(m => m.FeedMatchId != null && ids.Contains(m.FeedMatchId))
            .ToDictionaryAsync(m => m.FeedMatchId!, m => m.Id, ct);

        var badges = await db.TeamMedia.AsNoTracking().Where(t => t.BadgeFile != null).ToDictionaryAsync(t => t.Team, t => t.BadgeFile, ct);
        return TypedResults.Ok(fixtures.Select(f => new FixtureDto(f.FeedMatchId, f.Competition, f.KickoffUtc, f.HomeTeam, f.AwayTeam,
            f.Status, f.ScoreHome, f.ScoreAway, imported.TryGetValue(f.FeedMatchId, out var id) ? id : null,
            SportsMedia.Url(badges.GetValueOrDefault(f.HomeTeam)), SportsMedia.Url(badges.GetValueOrDefault(f.AwayTeam)))).ToList());
    }

    private static async Task<Results<Created<MatchSummaryDto>, Ok<MatchSummaryDto>, NotFound<string>>> Import(
        ImportFixtureRequest request, ISportsFeedProvider provider, IMemoryCache cache, AppDbContext db, SportsMediaSignal media, CancellationToken ct)
    {
        if (provider is not IFixtureSource source || !source.Competitions.Contains(request.Competition ?? string.Empty))
        {
            return TypedResults.NotFound(Text.L("এই ফিড প্রোভাইডার সূচি দেয় না।", "This feed provider doesn't publish fixtures."));
        }

        // Import only what the provider actually listed (from the cached list, no extra request).
        var fixture = (await LoadFixturesAsync(source, request.Competition!, cache, ct)).FirstOrDefault(f => f.FeedMatchId == request.FeedMatchId);
        if (fixture is null) return TypedResults.NotFound(Text.L("ম্যাচটি সূচিতে নেই — তালিকা আবার লোড করুন।", "That match isn't in the fixture list — reload the list."));

        var existing = await db.Matches.FirstOrDefaultAsync(m => m.FeedMatchId == fixture.FeedMatchId, ct);
        if (existing is not null) return TypedResults.Ok(Summary(existing));   // importing twice is harmless

        var match = new Match
        {
            Title = Truncate($"{fixture.HomeTeam} – {fixture.AwayTeam}", 200),   // language-neutral; editable in Feed data
            Sport = SportType.Football,
            MatchDate = fixture.KickoffUtc,
            TeamA = Truncate(fixture.HomeTeam, 100),
            TeamB = Truncate(fixture.AwayTeam, 100),
            Competition = Truncate(fixture.Competition, 100),
            FeedMatchId = fixture.FeedMatchId,
            FeedStatus = fixture.Status,
            ScoreA = fixture.ScoreHome,
            ScoreB = fixture.ScoreAway
        };
        db.Matches.Add(match);
        await db.SaveChangesAsync(ct);
        media.Nudge();   // fetch the two badges now

        return TypedResults.Created($"/api/sports/matches/{match.Id}", Summary(match));
    }

    private static Task<List<FeedFixture>> LoadFixturesAsync(IFixtureSource source, string competition, IMemoryCache cache, CancellationToken ct) =>
        cache.GetOrCreateAsync($"fixtures:{competition}", async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = FixtureCache;
            var today = DateOnly.FromDateTime(DateTime.UtcNow);
            return (await source.GetFixturesAsync(competition, today.AddDays(-1), today.AddDays(10), ct)).ToList();
        })!;

    private static MatchSummaryDto Summary(Match m) =>
        new(m.Id, m.Title, m.Sport, m.MatchDate, m.TeamA, m.TeamB, m.FeedMatchId, m.Competition, m.FeedStatus, m.ScoreA, m.ScoreB);

    private static string Truncate(string value, int max) => value.Length <= max ? value : value[..max];
}
