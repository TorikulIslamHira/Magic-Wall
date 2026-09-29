using MagicWall.Api.Workflow;

namespace MagicWall.Api.Modules.Election;

public class Constituency
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;

    /// <summary>The <c>id</c> attribute of this constituency's &lt;path&gt; in the SVG map.</summary>
    public string SvgPathId { get; set; } = string.Empty;

    public int TotalVoters { get; set; }

    /// <summary>District code from maps/bd-districts.geojson (e.g. "dhaka"); groups seats on the district map.</summary>
    public string? DistrictCode { get; set; }

    public List<ElectionResult> Results { get; set; } = [];
}

public class Candidate
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string PartyName { get; set; } = string.Empty;

    /// <summary>Electoral symbol name (e.g. "Boat") or an icon URL/key for the frontend.</summary>
    public string Symbol { get; set; } = string.Empty;

    /// <summary>
    /// The seat this candidate stands in (their nomination), so a field reporter can pick from
    /// the right list before any votes exist. Null for candidates created before seats were linked.
    /// </summary>
    public int? ConstituencyId { get; set; }
    public Constituency? Constituency { get; set; }

    public List<ElectionResult> Results { get; set; } = [];
}

/// <summary>
/// The APPROVED vote count for one candidate in one seat. Only the desk's approval (or a
/// direct desk correction) writes here, so everything the wall reads is approved by construction.
/// Proposed changes live in <see cref="ElectionResultSubmission"/> until reviewed.
/// </summary>
public class ElectionResult
{
    public int Id { get; set; }

    public int ConstituencyId { get; set; }
    public Constituency Constituency { get; set; } = null!;

    public int CandidateId { get; set; }
    public Candidate Candidate { get; set; } = null!;

    public int VotesReceived { get; set; }
}

/// <summary>
/// A field reporter's proposed vote count, waiting for the desk (maker-checker).
/// Approval copies <see cref="VotesReceived"/> into <see cref="ElectionResult"/>.
/// </summary>
public class ElectionResultSubmission
{
    public int Id { get; set; }

    public int ConstituencyId { get; set; }
    public Constituency Constituency { get; set; } = null!;

    public int CandidateId { get; set; }
    public Candidate Candidate { get; set; } = null!;

    /// <summary>The proposed count.</summary>
    public int VotesReceived { get; set; }

    /// <summary>The approved count when this was submitted, so the desk sees the change (null = first count).</summary>
    public int? PreviousVotes { get; set; }

    public ApprovalStatus Status { get; set; } = ApprovalStatus.Pending;

    /// <summary>Optional context from the reporter, e.g. "centre 14 of 32 counted".</summary>
    public string? Note { get; set; }

    public string SubmittedBy { get; set; } = string.Empty;
    public string SubmittedByName { get; set; } = string.Empty;
    public DateTime SubmittedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Who approved or rejected it (null while pending).</summary>
    public string? ReviewedBy { get; set; }
    public string? ReviewedByName { get; set; }
    public DateTime? ReviewedAt { get; set; }

    /// <summary>Reason for a rejection, or a note on approval.</summary>
    public string? ReviewNote { get; set; }
}
