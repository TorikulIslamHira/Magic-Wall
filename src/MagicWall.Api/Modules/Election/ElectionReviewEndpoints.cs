using System.Security.Claims;
using MagicWall.Api.Auth;
using MagicWall.Api.Data;
using MagicWall.Api.Hubs;
using MagicWall.Api.Wall;
using MagicWall.Api.Workflow;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace MagicWall.Api.Modules.Election;

public record SubmitVotesRequest(int ConstituencyId, int CandidateId, int VotesReceived, string? Note);

public record ReviewRequest(string? Note);

public record SubmissionDto(
    int Id,
    int ConstituencyId,
    string ConstituencyName,
    string SvgPathId,
    int CandidateId,
    string CandidateName,
    string PartyName,
    int VotesReceived,
    int? PreviousVotes,
    ApprovalStatus Status,
    string? Note,
    string SubmittedBy,
    string SubmittedByName,
    DateTime SubmittedAt,
    string? ReviewedByName,
    DateTime? ReviewedAt,
    string? ReviewNote);

/// <summary>
/// Maker-checker for live results: field reporters submit, the desk approves or rejects.
/// Only approval touches <see cref="ElectionResult"/> and notifies the wall.
/// </summary>
public static class ElectionReviewEndpoints
{
    public static IEndpointRouteBuilder MapElectionReviewEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/election/submissions").WithTags("Election review");

        group.MapPost("/", Submit).RequireAuthorization(Policies.SubmitElection);
        group.MapGet("/", List).RequireAuthorization(Policies.SubmitElection);
        group.MapPost("/{id:int}/approve", Approve).RequireAuthorization(Policies.ReviewElection);
        group.MapPost("/{id:int}/reject", Reject).RequireAuthorization(Policies.ReviewElection);

        return app;
    }

    private static async Task<Results<Created<SubmissionDto>, NotFound<string>, ValidationProblem>> Submit(
        SubmitVotesRequest request, ClaimsPrincipal user, AppDbContext db, IHubContext<MagicWallHub> hub, CancellationToken ct)
    {
        var note = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim();
        var errors = new Dictionary<string, string[]>();
        if (request.VotesReceived < 0) errors["votesReceived"] = ["ভোট ঋণাত্মক হতে পারে না।"];
        if (note is { Length: > 500 }) errors["note"] = ["মন্তব্য সর্বোচ্চ ৫০০ অক্ষর হতে পারে।"];
        if (errors.Count > 0) return TypedResults.ValidationProblem(errors);

        if (!await db.Constituencies.AnyAsync(c => c.Id == request.ConstituencyId, ct)) return TypedResults.NotFound("আসনটি পাওয়া যায়নি।");
        if (!await db.Candidates.AnyAsync(c => c.Id == request.CandidateId, ct)) return TypedResults.NotFound("প্রার্থী পাওয়া যায়নি।");

        var approved = await db.ElectionResults
            .Where(r => r.ConstituencyId == request.ConstituencyId && r.CandidateId == request.CandidateId)
            .Select(r => (int?)r.VotesReceived)
            .SingleOrDefaultAsync(ct);

        var submission = new ElectionResultSubmission
        {
            ConstituencyId = request.ConstituencyId,
            CandidateId = request.CandidateId,
            VotesReceived = request.VotesReceived,
            PreviousVotes = approved,
            Note = note,
            SubmittedBy = user.UserName(),
            SubmittedByName = user.DisplayNameOf()
        };
        db.ElectionResultSubmissions.Add(submission);
        await db.SaveChangesAsync(ct);

        // The desk's queue updates live; the wall is NOT told anything yet.
        await hub.BroadcastQueueChangedAsync(WallModule.Election, await PendingCount(db, ct), ct);

        return TypedResults.Created($"/api/election/submissions/{submission.Id}", (await Load(db, submission.Id, ct))!);
    }

    /// <summary>
    /// The desk sees everyone's submissions; a field reporter only ever sees their own.
    /// Optional filter: ?status=Pending
    /// </summary>
    private static Task<List<SubmissionDto>> List(ApprovalStatus? status, ClaimsPrincipal user, AppDbContext db, CancellationToken ct)
    {
        var query = db.ElectionResultSubmissions.AsNoTracking();
        if (status is not null) query = query.Where(s => s.Status == status);
        if (user.IsInRole(nameof(UserRole.FieldReporter)))
        {
            var me = user.UserName();
            query = query.Where(s => s.SubmittedBy == me);
        }

        return Project(query
                .OrderBy(s => s.Status == ApprovalStatus.Pending ? 0 : 1)
                .ThenBy(s => s.Status == ApprovalStatus.Pending ? s.SubmittedAt : DateTime.MinValue)
                .ThenByDescending(s => s.ReviewedAt)
                .Take(200))
            .ToListAsync(ct);
    }

    private static async Task<Results<Ok<SubmissionDto>, NotFound, Conflict<string>, ProblemHttpResult>> Approve(
        int id, ReviewRequest? request, ClaimsPrincipal user, AppDbContext db, IHubContext<MagicWallHub> hub, CancellationToken ct)
    {
        var submission = await db.ElectionResultSubmissions.AsNoTracking()
            .Where(s => s.Id == id)
            .Select(s => new { s.SubmittedBy, s.Status, s.ConstituencyId, s.CandidateId, s.VotesReceived, s.SubmittedAt, s.Constituency.SvgPathId })
            .SingleOrDefaultAsync(ct);
        if (submission is null) return TypedResults.NotFound();

        // Four-eyes principle: the maker can never be the checker.
        if (submission.SubmittedBy == user.UserName())
        {
            return TypedResults.Problem("নিজের জমা দেওয়া তথ্য নিজে অনুমোদন করা যায় না — অন্য একজন ডেস্ক প্রতিবেদককে অনুমোদন করতে হবে।", statusCode: StatusCodes.Status403Forbidden);
        }

        await using var tx = await db.Database.BeginTransactionAsync(ct);

        // Claim it atomically: if two desk reporters click Approve at once, only one wins.
        var now = DateTime.UtcNow;
        var claimed = await db.ElectionResultSubmissions
            .Where(s => s.Id == id && s.Status == ApprovalStatus.Pending)
            .ExecuteUpdateAsync(set => set
                .SetProperty(s => s.Status, ApprovalStatus.Approved)
                .SetProperty(s => s.ReviewedBy, user.UserName())
                .SetProperty(s => s.ReviewedByName, user.DisplayNameOf())
                .SetProperty(s => s.ReviewedAt, now)
                .SetProperty(s => s.ReviewNote, request == null ? null : request.Note), ct);
        if (claimed == 0)
        {
            return TypedResults.Conflict("এটি ইতিমধ্যে পর্যালোচনা করা হয়েছে।");
        }

        // Apply to the approved figure the wall reads.
        var result = await db.ElectionResults.SingleOrDefaultAsync(
            r => r.ConstituencyId == submission.ConstituencyId && r.CandidateId == submission.CandidateId, ct);
        if (result is null)
        {
            db.ElectionResults.Add(new ElectionResult
            {
                ConstituencyId = submission.ConstituencyId,
                CandidateId = submission.CandidateId,
                VotesReceived = submission.VotesReceived
            });
        }
        else
        {
            result.VotesReceived = submission.VotesReceived;
        }
        await db.SaveChangesAsync(ct);

        // Older pending proposals for the same figure are now obsolete; newer ones stay pending.
        await db.ElectionResultSubmissions
            .Where(s => s.ConstituencyId == submission.ConstituencyId && s.CandidateId == submission.CandidateId
                        && s.Status == ApprovalStatus.Pending && s.SubmittedAt < submission.SubmittedAt)
            .ExecuteUpdateAsync(set => set
                .SetProperty(s => s.Status, ApprovalStatus.Superseded)
                .SetProperty(s => s.ReviewedBy, user.UserName())
                .SetProperty(s => s.ReviewedByName, user.DisplayNameOf())
                .SetProperty(s => s.ReviewedAt, now), ct);

        await tx.CommitAsync(ct);

        // Only now does the wall hear about it.
        await hub.BroadcastDataChangedAsync(WallModule.Election, submission.SvgPathId, ct);
        await hub.BroadcastQueueChangedAsync(WallModule.Election, await PendingCount(db, ct), ct);

        return TypedResults.Ok((await Load(db, id, ct))!);
    }

    private static async Task<Results<Ok<SubmissionDto>, NotFound, Conflict<string>, ValidationProblem>> Reject(
        int id, ReviewRequest? request, ClaimsPrincipal user, AppDbContext db, IHubContext<MagicWallHub> hub, CancellationToken ct)
    {
        var note = request?.Note?.Trim();
        if (string.IsNullOrEmpty(note) || note.Length > 500)
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["note"] = ["প্রত্যাখ্যানের কারণ লিখুন (সর্বোচ্চ ৫০০ অক্ষর), যাতে প্রতিবেদক জানতে পারেন কী ঠিক করতে হবে।"]
            });
        }

        if (!await db.ElectionResultSubmissions.AnyAsync(s => s.Id == id, ct)) return TypedResults.NotFound();

        var claimed = await db.ElectionResultSubmissions
            .Where(s => s.Id == id && s.Status == ApprovalStatus.Pending)
            .ExecuteUpdateAsync(set => set
                .SetProperty(s => s.Status, ApprovalStatus.Rejected)
                .SetProperty(s => s.ReviewedBy, user.UserName())
                .SetProperty(s => s.ReviewedByName, user.DisplayNameOf())
                .SetProperty(s => s.ReviewedAt, DateTime.UtcNow)
                .SetProperty(s => s.ReviewNote, note), ct);
        if (claimed == 0) return TypedResults.Conflict("এটি ইতিমধ্যে পর্যালোচনা করা হয়েছে।");

        await hub.BroadcastQueueChangedAsync(WallModule.Election, await PendingCount(db, ct), ct);
        return TypedResults.Ok((await Load(db, id, ct))!);
    }

    private static Task<int> PendingCount(AppDbContext db, CancellationToken ct) =>
        db.ElectionResultSubmissions.CountAsync(s => s.Status == ApprovalStatus.Pending, ct);

    private static Task<SubmissionDto?> Load(AppDbContext db, int id, CancellationToken ct) =>
        Project(db.ElectionResultSubmissions.AsNoTracking().Where(s => s.Id == id)).SingleOrDefaultAsync(ct);

    private static IQueryable<SubmissionDto> Project(IQueryable<ElectionResultSubmission> query) =>
        query.Select(s => new SubmissionDto(
            s.Id, s.ConstituencyId, s.Constituency.Name, s.Constituency.SvgPathId,
            s.CandidateId, s.Candidate.Name, s.Candidate.PartyName,
            s.VotesReceived, s.PreviousVotes, s.Status, s.Note,
            s.SubmittedBy, s.SubmittedByName, s.SubmittedAt, s.ReviewedByName, s.ReviewedAt, s.ReviewNote));
}
