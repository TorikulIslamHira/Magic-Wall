using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace MagicWall.Api.Modules.Budget;

internal class BudgetSectorConfiguration : IEntityTypeConfiguration<BudgetSector>
{
    public void Configure(EntityTypeBuilder<BudgetSector> builder)
    {
        builder.Property(s => s.Name).HasMaxLength(150).IsRequired();
        builder.Property(s => s.FiscalYear).HasMaxLength(20).IsRequired();

        // A sector appears once per fiscal year.
        builder.HasIndex(s => new { s.FiscalYear, s.Name }).IsUnique();

        builder.ToTable(t => t.HasCheckConstraint("CK_BudgetSector_Allocation", "TotalAllocation >= 0"));
    }
}

internal class MegaProjectConfiguration : IEntityTypeConfiguration<MegaProject>
{
    public void Configure(EntityTypeBuilder<MegaProject> builder)
    {
        builder.Property(p => p.Name).HasMaxLength(200).IsRequired();
        builder.Property(p => p.GeoLocation).HasMaxLength(100);

        builder.HasOne(p => p.BudgetSector)
            .WithMany(s => s.MegaProjects)
            .HasForeignKey(p => p.BudgetSectorId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.ToTable(t =>
        {
            t.HasCheckConstraint("CK_MegaProject_Amount", "BudgetAmount >= 0");
            t.HasCheckConstraint("CK_MegaProject_Completion", "CompletionPercentage BETWEEN 0 AND 100");
        });
    }
}
