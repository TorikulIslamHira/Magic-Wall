namespace MagicWall.Api.Modules.Budget;

public class BudgetSector
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;

    /// <summary>Allocation in the channel's reporting unit (e.g. BDT crore).</summary>
    public decimal TotalAllocation { get; set; }

    /// <summary>Fiscal year label, e.g. "2025-26".</summary>
    public string FiscalYear { get; set; } = string.Empty;

    public List<MegaProject> MegaProjects { get; set; } = [];
}

public class MegaProject
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;

    public int BudgetSectorId { get; set; }
    public BudgetSector BudgetSector { get; set; } = null!;

    /// <summary>Same unit as <see cref="BudgetSector.TotalAllocation"/>.</summary>
    public decimal BudgetAmount { get; set; }

    /// <summary>0–100.</summary>
    public double CompletionPercentage { get; set; }

    /// <summary>"lat,lng" (e.g. "23.8103,90.4125") or an SVG path id for map placement.</summary>
    public string GeoLocation { get; set; } = string.Empty;
}
