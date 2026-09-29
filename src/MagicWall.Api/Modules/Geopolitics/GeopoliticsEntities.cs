namespace MagicWall.Api.Modules.Geopolitics;

public class ConflictZone
{
    public int Id { get; set; }
    public string RegionName { get; set; } = string.Empty;

    /// <summary>The <c>id</c> attribute of this region's &lt;path&gt; in the SVG map.</summary>
    public string SvgPathId { get; set; } = string.Empty;

    public List<TimelineEvent> TimelineEvents { get; set; } = [];
}

/// <summary>
/// A snapshot of a zone on a given day. The timeline slider shows, for each zone,
/// the latest event on or before the selected date.
/// </summary>
public class TimelineEvent
{
    public int Id { get; set; }

    public int ConflictZoneId { get; set; }
    public ConflictZone ConflictZone { get; set; } = null!;

    public DateOnly Date { get; set; }
    public string ControllingForce { get; set; } = string.Empty;

    /// <summary>Casualties reported for this event (not a running total).</summary>
    public int Casualties { get; set; }

    public string Description { get; set; } = string.Empty;
}
