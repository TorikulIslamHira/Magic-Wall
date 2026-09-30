using MagicWall.Api.Hosting;
using MagicWall.Api.Auth;
using MagicWall.Api.Data;
using MagicWall.Api.Hubs;
using MagicWall.Api.Wall;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace MagicWall.Api.Modules.Election;

public record CandidateResultDto(
    int CandidateId,
    string CandidateName,
    string PartyName,
    string Symbol,
    int VotesReceived,
    double VoteSharePercentage);

public record ConstituencyResultsDto(
    int ConstituencyId,
    string Name,
    string SvgPathId,
    string? DistrictCode,
    int TotalVoters,
    int TotalVotesCast,
    double TurnoutPercentage,
    IReadOnlyList<CandidateResultDto> Results);

/// <summary>One row per seat, enough to colour the whole map in a single request.</summary>
public record ConstituencySummaryDto(
    int Id,
    string Name,
    string SvgPathId,
    string? DistrictCode,
    int TotalVoters,
    int TotalVotesCast,
    string? LeadingParty,
    string? LeadingCandidate,
    int LeadMargin);

public record CandidateDto(int Id, string Name, string PartyName, string Symbol, int? ConstituencyId = null);

/// <summary>A candidate standing in one seat, with their currently APPROVED votes (null = none yet).</summary>
public record SeatCandidateDto(int CandidateId, string Name, string PartyName, string Symbol, int? ApprovedVotes);

public record UpsertResultRequest(int ConstituencyId, int CandidateId, int VotesReceived);

public record SaveConstituencyRequest(string Name, string SvgPathId, int TotalVoters, string? DistrictCode);

/// <param name="ConstituencyId">The seat they stand in (recommended, so field reporters can find them).</param>
public record SaveCandidateRequest(string Name, string PartyName, string? Symbol, int? ConstituencyId = null);

public static class ElectionEndpoints
{
    public static IEndpointRouteBuilder MapElectionEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/election").WithTags("Election");

        group.MapGet("/results/{svgPathId}", GetResultsBySvgPathId);
        group.MapGet("/constituencies", GetConstituencySummaries);
        group.MapGet("/candidates", GetCandidates);
        group.MapGet("/constituencies/{svgPathId}/candidates", GetSeatCandidates);

        group.MapPut("/results", UpsertResult).RequireAuthorization(Policies.EditDesk);
        group.MapPost("/constituencies", CreateConstituency).RequireAuthorization(Policies.EditDesk);
        group.MapPut("/constituencies/{id:int}", UpdateConstituency).RequireAuthorization(Policies.EditDesk);
        group.MapPost("/candidates", CreateCandidate).RequireAuthorization(Policies.EditDesk);

        return app;
    }

    private static async Task<Results<Created<ConstituencySummaryDto>, Conflict<string>, ValidationProblem>> CreateConstituency(
        SaveConstituencyRequest request, AppDbContext db, IHubContext<MagicWallHub> hub, CancellationToken ct)
    {
        var (name, svgPathId, districtCode, errors) = ValidateConstituency(request);
        if (errors.Count > 0) return TypedResults.ValidationProblem(errors);

        if (await db.Constituencies.AnyAsync(c => c.SvgPathId == svgPathId, ct))
        {
            return TypedResults.Conflict(Text.L($"\"{svgPathId}\" মানচিত্র আইডি আগেই অন্য একটি আসনে ব্যবহৃত হয়েছে।", $"Map id \"{svgPathId}\" is already used by another constituency."));
        }

        var constituency = new Constituency
        {
            Name = name,
            SvgPathId = svgPathId,
            TotalVoters = request.TotalVoters,
            DistrictCode = districtCode
        };
        db.Constituencies.Add(constituency);
        await db.SaveChangesAsync(ct);
        await hub.BroadcastDataChangedAsync(WallModule.Election, svgPathId, ct);

        return TypedResults.Created(
            $"/api/election/results/{svgPathId}",
            new ConstituencySummaryDto(constituency.Id, name, svgPathId, districtCode, request.TotalVoters, 0, null, null, 0));
    }

    private static async Task<Results<NoContent, NotFound, Conflict<string>, ValidationProblem>> UpdateConstituency(
        int id, SaveConstituencyRequest request, AppDbContext db, IHubContext<MagicWallHub> hub, CancellationToken ct)
    {
        var (name, svgPathId, districtCode, errors) = ValidateConstituency(request);
        if (errors.Count > 0) return TypedResults.ValidationProblem(errors);

        var constituency = await db.Constituencies.FindAsync([id], ct);
        if (constituency is null) return TypedResults.NotFound();

        if (await db.Constituencies.AnyAsync(c => c.Id != id && c.SvgPathId == svgPathId, ct))
        {
            return TypedResults.Conflict(Text.L($"\"{svgPathId}\" মানচিত্র আইডি আগেই অন্য একটি আসনে ব্যবহৃত হয়েছে।", $"Map id \"{svgPathId}\" is already used by another constituency."));
        }

        constituency.Name = name;
        constituency.SvgPathId = svgPathId;
        constituency.TotalVoters = request.TotalVoters;
        constituency.DistrictCode = districtCode;
        await db.SaveChangesAsync(ct);
        await hub.BroadcastDataChangedAsync(WallModule.Election, svgPathId, ct);

        return TypedResults.NoContent();
    }

    private static async Task<Results<Created<CandidateDto>, NotFound<string>, ValidationProblem>> CreateCandidate(
        SaveCandidateRequest request, AppDbContext db, CancellationToken ct)
    {
        if (request.ConstituencyId is { } seatId && !await db.Constituencies.AnyAsync(c => c.Id == seatId, ct))
        {
            return TypedResults.NotFound(Text.L("আসনটি পাওয়া যায়নি।", "Constituency not found."));
        }

        var name = request.Name?.Trim() ?? string.Empty;
        var partyName = request.PartyName?.Trim() ?? string.Empty;
        var symbol = request.Symbol?.Trim() ?? string.Empty;

        var errors = new Dictionary<string, string[]>();
        if (name.Length is 0 or > 150) errors["name"] = [Text.L("প্রার্থীর নাম দিন (সর্বোচ্চ ১৫০ অক্ষর)।", "Enter the candidate's name (up to 150 characters).")];
        if (partyName.Length is 0 or > 150) errors["partyName"] = [Text.L("দলের নাম দিন (সর্বোচ্চ ১৫০ অক্ষর)।", "Enter the party name (up to 150 characters).")];
        if (symbol.Length > 200) errors["symbol"] = [Text.L("প্রতীক সর্বোচ্চ ২০০ অক্ষর হতে পারে।", "The symbol can be up to 200 characters.")];
        if (errors.Count > 0) return TypedResults.ValidationProblem(errors);

        var candidate = new Candidate { Name = name, PartyName = partyName, Symbol = symbol, ConstituencyId = request.ConstituencyId };
        db.Candidates.Add(candidate);
        await db.SaveChangesAsync(ct);

        // No broadcast: a candidate appears on the wall only once votes are approved for a seat.
        return TypedResults.Created(
            $"/api/election/candidates/{candidate.Id}",
            new CandidateDto(candidate.Id, name, partyName, symbol, candidate.ConstituencyId));
    }

    /// <summary>
    /// Everyone standing in a seat (nominated there, or already with votes there) and their
    /// approved votes: the list a field reporter submits against.
    /// </summary>
    private static async Task<Results<Ok<List<SeatCandidateDto>>, NotFound>> GetSeatCandidates(
        string svgPathId, AppDbContext db, CancellationToken ct)
    {
        var seatId = await db.Constituencies.Where(c => c.SvgPathId == svgPathId).Select(c => (int?)c.Id).SingleOrDefaultAsync(ct);
        if (seatId is null) return TypedResults.NotFound();

        var candidates = await db.Candidates.AsNoTracking()
            .Where(c => c.ConstituencyId == seatId || c.Results.Any(r => r.ConstituencyId == seatId))
            .Select(c => new
            {
                c.Id, c.Name, c.PartyName, c.Symbol,
                Votes = c.Results.Where(r => r.ConstituencyId == seatId).Select(r => (int?)r.VotesReceived).FirstOrDefault()
            })
            .OrderByDescending(c => c.Votes ?? -1)
            .ThenBy(c => c.PartyName)
            .ToListAsync(ct);

        return TypedResults.Ok(candidates.Select(c => new SeatCandidateDto(c.Id, c.Name, c.PartyName, c.Symbol, c.Votes)).ToList());
    }

    private static (string Name, string SvgPathId, string? DistrictCode, Dictionary<string, string[]> Errors) ValidateConstituency(
        SaveConstituencyRequest r)
    {
        var name = r.Name?.Trim() ?? string.Empty;
        var svgPathId = r.SvgPathId?.Trim() ?? string.Empty;
        var districtCode = string.IsNullOrWhiteSpace(r.DistrictCode) ? null : r.DistrictCode.Trim().ToLowerInvariant();

        var errors = new Dictionary<string, string[]>();
        if (name.Length is 0 or > 150) errors["name"] = [Text.L("আসনের নাম দিন (সর্বোচ্চ ১৫০ অক্ষর)।", "Enter the constituency name (up to 150 characters).")];
        if (svgPathId.Length is 0 or > 100) errors["svgPathId"] = [Text.L("মানচিত্র আইডি দিন (সর্বোচ্চ ১০০ অক্ষর)।", "Enter the map id (up to 100 characters).")];
        if (r.TotalVoters < 0) errors["totalVoters"] = [Text.L("মোট ভোটার ঋণাত্মক হতে পারে না।", "Total voters can't be negative.")];
        if (districtCode is { Length: > 60 }) errors["districtCode"] = [Text.L("জেলা কোড সর্বোচ্চ ৬০ অক্ষর হতে পারে।", "District code can be up to 60 characters.")];

        return (name, svgPathId, districtCode, errors);
    }

    private static async Task<Results<Ok<ConstituencyResultsDto>, NotFound>> GetResultsBySvgPathId(
        string svgPathId, AppDbContext db, CancellationToken ct)
    {
        var dto = await LoadResultsAsync(db, svgPathId, ct);
        return dto is null ? TypedResults.NotFound() : TypedResults.Ok(dto);
    }

    private static async Task<List<ConstituencySummaryDto>> GetConstituencySummaries(
        AppDbContext db, CancellationToken ct)
    {
        var rows = await db.Constituencies
            .AsNoTracking()
            .OrderBy(c => c.Name)
            .Select(c => new
            {
                c.Id,
                c.Name,
                c.SvgPathId,
                c.DistrictCode,
                c.TotalVoters,
                TotalVotesCast = c.Results.Sum(r => r.VotesReceived),
                TopTwo = c.Results
                    .OrderByDescending(r => r.VotesReceived)
                    .ThenBy(r => r.Candidate.Name)
                    .Select(r => new { r.VotesReceived, r.Candidate.PartyName, r.Candidate.Name })
                    .Take(2)
                    .ToList()
            })
            .ToListAsync(ct);

        return rows
            .Select(c =>
            {
                // No votes counted yet: nobody leads, the map shows the seat as undeclared.
                var leader = c.TotalVotesCast > 0 ? c.TopTwo.FirstOrDefault() : null;
                var runnerUpVotes = c.TopTwo.Skip(1).FirstOrDefault()?.VotesReceived ?? 0;

                return new ConstituencySummaryDto(
                    c.Id,
                    c.Name,
                    c.SvgPathId,
                    c.DistrictCode,
                    c.TotalVoters,
                    c.TotalVotesCast,
                    leader?.PartyName,
                    leader?.Name,
                    leader is null ? 0 : leader.VotesReceived - runnerUpVotes);
            })
            .ToList();
    }

    private static Task<List<CandidateDto>> GetCandidates(AppDbContext db, CancellationToken ct) =>
        db.Candidates
            .AsNoTracking()
            .OrderBy(c => c.PartyName)
            .ThenBy(c => c.Name)
            .Select(c => new CandidateDto(c.Id, c.Name, c.PartyName, c.Symbol, c.ConstituencyId))
            .ToListAsync(ct);

    private static async Task<Results<Ok<ConstituencyResultsDto>, NotFound<string>, ValidationProblem>> UpsertResult(
        UpsertResultRequest request, AppDbContext db, IHubContext<MagicWallHub> hub, CancellationToken ct)
    {
        if (request.VotesReceived < 0)
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["votesReceived"] = [Text.L("ভোট ঋণাত্মক হতে পারে না।", "Votes can't be negative.")]
            });
        }

        var svgPathId = await db.Constituencies
            .Where(c => c.Id == request.ConstituencyId)
            .Select(c => c.SvgPathId)
            .SingleOrDefaultAsync(ct);

        if (svgPathId is null)
        {
            return TypedResults.NotFound(Text.L("আসনটি পাওয়া যায়নি।", "Constituency not found."));
        }

        if (!await db.Candidates.AnyAsync(c => c.Id == request.CandidateId, ct))
        {
            return TypedResults.NotFound(Text.L("প্রার্থী পাওয়া যায়নি।", "Candidate not found."));
        }

        var result = await db.ElectionResults.SingleOrDefaultAsync(
            r => r.ConstituencyId == request.ConstituencyId && r.CandidateId == request.CandidateId, ct);

        if (result is null)
        {
            db.ElectionResults.Add(new ElectionResult
            {
                ConstituencyId = request.ConstituencyId,
                CandidateId = request.CandidateId,
                VotesReceived = request.VotesReceived
            });
        }
        else
        {
            result.VotesReceived = request.VotesReceived;
        }

        await db.SaveChangesAsync(ct);
        await hub.BroadcastDataChangedAsync(WallModule.Election, svgPathId, ct);

        return TypedResults.Ok((await LoadResultsAsync(db, svgPathId, ct))!);
    }

    private static async Task<ConstituencyResultsDto?> LoadResultsAsync(
        AppDbContext db, string svgPathId, CancellationToken ct)
    {
        var constituency = await db.Constituencies
            .AsNoTracking()
            .Where(c => c.SvgPathId == svgPathId)
            .Select(c => new
            {
                c.Id,
                c.Name,
                c.SvgPathId,
                c.DistrictCode,
                c.TotalVoters,
                Results = c.Results
                    .OrderByDescending(r => r.VotesReceived)
                    .ThenBy(r => r.Candidate.Name)
                    .Select(r => new
                    {
                        r.CandidateId,
                        r.Candidate.Name,
                        r.Candidate.PartyName,
                        r.Candidate.Symbol,
                        r.VotesReceived
                    })
                    .ToList()
            })
            .SingleOrDefaultAsync(ct);

        if (constituency is null)
        {
            return null;
        }

        var totalVotesCast = constituency.Results.Sum(r => r.VotesReceived);

        var results = constituency.Results
            .Select(r => new CandidateResultDto(
                r.CandidateId,
                r.Name,
                r.PartyName,
                r.Symbol,
                r.VotesReceived,
                Percentage(r.VotesReceived, totalVotesCast)))
            .ToList();

        return new ConstituencyResultsDto(
            constituency.Id,
            constituency.Name,
            constituency.SvgPathId,
            constituency.DistrictCode,
            constituency.TotalVoters,
            totalVotesCast,
            Percentage(totalVotesCast, constituency.TotalVoters),
            results);
    }

    private static double Percentage(int part, int whole) =>
        whole == 0 ? 0 : Math.Round(part * 100.0 / whole, 2);
}
