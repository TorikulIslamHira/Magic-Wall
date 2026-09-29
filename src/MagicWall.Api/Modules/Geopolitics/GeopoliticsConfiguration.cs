using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace MagicWall.Api.Modules.Geopolitics;

internal class ConflictZoneConfiguration : IEntityTypeConfiguration<ConflictZone>
{
    public void Configure(EntityTypeBuilder<ConflictZone> builder)
    {
        builder.Property(z => z.RegionName).HasMaxLength(150).IsRequired();
        builder.Property(z => z.SvgPathId).HasMaxLength(100).IsRequired();

        builder.HasIndex(z => z.SvgPathId).IsUnique();
        builder.HasIndex(z => z.RegionName);
    }
}

internal class TimelineEventConfiguration : IEntityTypeConfiguration<TimelineEvent>
{
    public void Configure(EntityTypeBuilder<TimelineEvent> builder)
    {
        builder.Property(e => e.ControllingForce).HasMaxLength(150).IsRequired();
        builder.Property(e => e.Description).HasMaxLength(2000);

        builder.HasOne(e => e.ConflictZone)
            .WithMany(z => z.TimelineEvents)
            .HasForeignKey(e => e.ConflictZoneId)
            .OnDelete(DeleteBehavior.Cascade);

        // Covers the slider query: latest event per zone on or before a date.
        builder.HasIndex(e => new { e.ConflictZoneId, e.Date });

        builder.ToTable(t => t.HasCheckConstraint("CK_TimelineEvent_Casualties", "Casualties >= 0"));
    }
}
