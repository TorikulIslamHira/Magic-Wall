using MagicWall.Api.Workflow;

namespace MagicWall.Api.Modules.Sports;

/// <summary>Stored as its name, so new sports can be appended without a data migration.</summary>
public enum SportType
{
    Football,
    Cricket,
    Hockey,
    Kabaddi,
    Basketball,
    Tennis
}

/// <summary>
/// Stored as its name (e.g. "Goal"), so new values can be appended without a data migration.
/// Which types are valid for which sport is defined in <see cref="SportEvents"/>.
/// </summary>
public enum MatchEventType
{
    // Football / hockey / basketball share these
    Pass,
    Shot,
    Goal,
    Tackle,
    Foul,
    Save,

    // Cricket
    Four,
    Six,
    Wicket,
    Catch,
    Delivery,

    // Hockey
    PenaltyCorner,

    // Kabaddi
    Raid,
    Bonus,
    AllOut,

    // Basketball
    TwoPointer,
    ThreePointer,
    FreeThrow,
    Rebound,

    // Tennis
    Ace,
    Winner,
    UnforcedError,
    DoubleFault,

    // Football, as live data providers report it (no pitch position)
    OwnGoal,
    YellowCard,
    RedCard,
    Substitution
}

/// <summary>The event types that make sense for each sport (mirrored in wwwroot/js/pitch.js).</summary>
public static class SportEvents
{
    public static readonly IReadOnlyDictionary<SportType, MatchEventType[]> Allowed = new Dictionary<SportType, MatchEventType[]>
    {
        [SportType.Football] = [MatchEventType.Pass, MatchEventType.Shot, MatchEventType.Goal, MatchEventType.Tackle, MatchEventType.Foul, MatchEventType.Save,
                                MatchEventType.OwnGoal, MatchEventType.YellowCard, MatchEventType.RedCard, MatchEventType.Substitution],
        [SportType.Cricket] = [MatchEventType.Four, MatchEventType.Six, MatchEventType.Wicket, MatchEventType.Catch, MatchEventType.Delivery],
        [SportType.Hockey] = [MatchEventType.Pass, MatchEventType.Shot, MatchEventType.Goal, MatchEventType.Tackle, MatchEventType.PenaltyCorner, MatchEventType.Save],
        [SportType.Kabaddi] = [MatchEventType.Raid, MatchEventType.Tackle, MatchEventType.Bonus, MatchEventType.AllOut],
        [SportType.Basketball] = [MatchEventType.Pass, MatchEventType.TwoPointer, MatchEventType.ThreePointer, MatchEventType.FreeThrow, MatchEventType.Rebound, MatchEventType.Foul],
        [SportType.Tennis] = [MatchEventType.Ace, MatchEventType.Winner, MatchEventType.UnforcedError, MatchEventType.DoubleFault]
    };

    public static bool IsValid(SportType sport, MatchEventType type) =>
        Allowed.TryGetValue(sport, out var types) && types.Contains(type);

    /// <summary>Moments that belong on the match timeline and can open the player spotlight.</summary>
    public static readonly IReadOnlySet<MatchEventType> Major = new HashSet<MatchEventType>
    {
        MatchEventType.Goal, MatchEventType.OwnGoal, MatchEventType.YellowCard, MatchEventType.RedCard,
        MatchEventType.Substitution, MatchEventType.Wicket, MatchEventType.Six, MatchEventType.AllOut
    };
}

public class Match
{
    public int Id { get; set; }
    public string Title { get; set; } = string.Empty;

    /// <summary>Tells the wall which surface to draw (football pitch, cricket oval, kabaddi mat…).</summary>
    public SportType Sport { get; set; }

    public DateTime MatchDate { get; set; }
    public string TeamA { get; set; } = string.Empty;
    public string TeamB { get; set; } = string.Empty;

    /// <summary>
    /// The match's id at the live data provider. When set, <c>SportsFeedWorker</c> polls it and
    /// queues what it finds for the sports desk; when null, events are entered by hand only.
    /// </summary>
    public string? FeedMatchId { get; set; }

    // Live state from the provider (null for matches entered by hand). Score and status are
    // published straight to the wall; individual events still go through the sports desk.
    public string? Competition { get; set; }

    /// <summary>Provider status: SCHEDULED, TIMED, IN_PLAY, PAUSED, FINISHED, POSTPONED, …</summary>
    public string? FeedStatus { get; set; }

    public int? ScoreA { get; set; }
    public int? ScoreB { get; set; }

    /// <summary>When the provider last answered for this match; drives how often it is polled.</summary>
    public DateTime? FeedUpdatedAt { get; set; }

    public List<MatchEvent> Events { get; set; } = [];
}

public class Player
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Team { get; set; } = string.Empty;

    /// <summary>Free text because roles differ by sport ("Striker", "Wicket-keeper").</summary>
    public string Role { get; set; } = string.Empty;

    /// <summary>The live provider's id for this player (e.g. "fd:1234"), when the feed created them.</summary>
    public string? ExternalId { get; set; }

    /// <summary>Where the photo came from (TheSportsDB), kept for attribution and re-downloads.</summary>
    public string? PhotoSourceUrl { get; set; }

    /// <summary>The downloaded copy under the media folder; the wall only ever loads this local file.</summary>
    public string? PhotoFile { get; set; }

    /// <summary>When the photo was last looked up (found or not), so a miss isn't retried every poll.</summary>
    public DateTime? MediaCheckedAt { get; set; }

    public List<MatchEvent> Events { get; set; } = [];
}

/// <summary>A team's badge, looked up once by team name (TheSportsDB) and cached locally.</summary>
public class TeamMedia
{
    public int Id { get; set; }
    public string Team { get; set; } = string.Empty;
    public string? BadgeSourceUrl { get; set; }
    public string? BadgeFile { get; set; }
    public DateTime? CheckedAt { get; set; }
}

public class MatchEvent
{
    public int Id { get; set; }

    public int MatchId { get; set; }
    public Match Match { get; set; } = null!;

    public int PlayerId { get; set; }
    public Player Player { get; set; } = null!;

    public MatchEventType EventType { get; set; }

    /// <summary>
    /// Position as a percentage of the playing surface (0–100), origin at the top-left
    /// of the canvas. Resolution-independent, so the wall scales it to any screen size.
    /// Null when the source has no position (live score APIs report goals and cards without
    /// one): such events appear on the timeline, never at a made-up spot on the pitch.
    /// </summary>
    public float? CoordinateX { get; set; }

    /// <inheritdoc cref="CoordinateX"/>
    public float? CoordinateY { get; set; }

    /// <summary>Optional end point for passes and shots, used to draw arrows.</summary>
    public float? EndCoordinateX { get; set; }

    /// <inheritdoc cref="EndCoordinateX"/>
    public float? EndCoordinateY { get; set; }

    public int Minute { get; set; }

    /// <summary>
    /// Extra context, as " · "-separated tokens the UI translates: "penalty", "+2" (stoppage time),
    /// "assist: Name", "off: Name" (substitution), "second-yellow". Other text is shown as it is.
    /// </summary>
    public string? Detail { get; set; }

    /// <summary>Only Approved events are drawn on the wall. Feed events arrive Pending.</summary>
    public ApprovalStatus Status { get; set; } = ApprovalStatus.Pending;

    public EventSource Source { get; set; } = EventSource.Manual;

    /// <summary>The provider's id for this event, so a re-poll never inserts it twice (null for manual entries).</summary>
    public string? ExternalId { get; set; }

    /// <summary>User name, or "feed:&lt;provider&gt;" for fetched data.</summary>
    public string SubmittedBy { get; set; } = string.Empty;
    public DateTime SubmittedAt { get; set; } = DateTime.UtcNow;

    public string? ReviewedBy { get; set; }
    public DateTime? ReviewedAt { get; set; }
}
