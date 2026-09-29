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

    public List<ElectionResult> Results { get; set; } = [];
}

public class ElectionResult
{
    public int Id { get; set; }

    public int ConstituencyId { get; set; }
    public Constituency Constituency { get; set; } = null!;

    public int CandidateId { get; set; }
    public Candidate Candidate { get; set; } = null!;

    public int VotesReceived { get; set; }
}
