namespace MagicWall.Api.Modules.Sports;

public enum SportType
{
    Football,
    Cricket
}

/// <summary>
/// Stored as its name (e.g. "Goal"), so new values can be appended without a data migration.
/// </summary>
public enum MatchEventType
{
    // Football
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
    Delivery
}

public class Match
{
    public int Id { get; set; }
    public string Title { get; set; } = string.Empty;

    /// <summary>Tells the wall which surface to draw (football pitch vs. cricket field).</summary>
    public SportType Sport { get; set; }

    public DateTime MatchDate { get; set; }
    public string TeamA { get; set; } = string.Empty;
    public string TeamB { get; set; } = string.Empty;

    public List<MatchEvent> Events { get; set; } = [];
}

public class Player
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Team { get; set; } = string.Empty;

    /// <summary>Free text because roles differ by sport ("Striker", "Wicket-keeper").</summary>
    public string Role { get; set; } = string.Empty;

    public List<MatchEvent> Events { get; set; } = [];
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
    /// </summary>
    public float CoordinateX { get; set; }

    /// <inheritdoc cref="CoordinateX"/>
    public float CoordinateY { get; set; }

    /// <summary>Optional end point for passes and shots, used to draw arrows.</summary>
    public float? EndCoordinateX { get; set; }

    /// <inheritdoc cref="EndCoordinateX"/>
    public float? EndCoordinateY { get; set; }

    public int Minute { get; set; }
}
