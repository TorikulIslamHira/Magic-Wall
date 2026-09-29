namespace MagicWall.Api.Workflow;

/// <summary>
/// Maker-checker state of a submitted change. Stored as its name. Only Approved data ever
/// reaches the presenter wall.
/// </summary>
public enum ApprovalStatus
{
    Pending,
    Approved,
    Rejected,

    /// <summary>A newer submission for the same figure was approved first; this one is obsolete.</summary>
    Superseded
}

/// <summary>Where a sports event came from.</summary>
public enum EventSource
{
    /// <summary>Entered by the sports desk; trusted, so approved on entry.</summary>
    Manual,

    /// <summary>Fetched by <c>SportsFeedWorker</c>; waits in the approval queue.</summary>
    Feed
}
