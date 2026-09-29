using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace MagicWall.Api.Modules.Sports;

internal class MatchConfiguration : IEntityTypeConfiguration<Match>
{
    public void Configure(EntityTypeBuilder<Match> builder)
    {
        builder.Property(m => m.Title).HasMaxLength(200).IsRequired();
        builder.Property(m => m.TeamA).HasMaxLength(100).IsRequired();
        builder.Property(m => m.TeamB).HasMaxLength(100).IsRequired();
        builder.Property(m => m.Sport).HasConversion<string>().HasMaxLength(20);
        builder.Property(m => m.FeedMatchId).HasMaxLength(100);

        builder.HasIndex(m => m.MatchDate);
    }
}

internal class PlayerConfiguration : IEntityTypeConfiguration<Player>
{
    public void Configure(EntityTypeBuilder<Player> builder)
    {
        builder.Property(p => p.Name).HasMaxLength(150).IsRequired();
        builder.Property(p => p.Team).HasMaxLength(100).IsRequired();
        builder.Property(p => p.Role).HasMaxLength(50);

        builder.HasIndex(p => p.Team);
    }
}

internal class MatchEventConfiguration : IEntityTypeConfiguration<MatchEvent>
{
    public void Configure(EntityTypeBuilder<MatchEvent> builder)
    {
        builder.Property(e => e.EventType).HasConversion<string>().HasMaxLength(30);
        builder.Property(e => e.Status).HasConversion<string>().HasMaxLength(20);
        builder.Property(e => e.Source).HasConversion<string>().HasMaxLength(20);
        builder.Property(e => e.ExternalId).HasMaxLength(100);
        builder.Property(e => e.SubmittedBy).HasMaxLength(60).IsRequired();
        builder.Property(e => e.ReviewedBy).HasMaxLength(60);

        // A provider event is stored once, however often it is polled.
        builder.HasIndex(e => e.ExternalId).IsUnique().HasFilter("ExternalId IS NOT NULL");
        // The sports desk's queue.
        builder.HasIndex(e => new { e.Status, e.SubmittedAt });

        builder.HasOne(e => e.Match)
            .WithMany(m => m.Events)
            .HasForeignKey(e => e.MatchId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(e => e.Player)
            .WithMany(p => p.Events)
            .HasForeignKey(e => e.PlayerId)
            .OnDelete(DeleteBehavior.Restrict);

        // Covers the heatmap query: WHERE MatchId = @m AND PlayerId = @p ORDER BY Minute.
        builder.HasIndex(e => new { e.MatchId, e.PlayerId, e.Minute });

        builder.ToTable(t =>
        {
            t.HasCheckConstraint("CK_MatchEvent_X", "CoordinateX BETWEEN 0 AND 100");
            t.HasCheckConstraint("CK_MatchEvent_Y", "CoordinateY BETWEEN 0 AND 100");
            t.HasCheckConstraint("CK_MatchEvent_EndX", "EndCoordinateX IS NULL OR EndCoordinateX BETWEEN 0 AND 100");
            t.HasCheckConstraint("CK_MatchEvent_EndY", "EndCoordinateY IS NULL OR EndCoordinateY BETWEEN 0 AND 100");
            t.HasCheckConstraint("CK_MatchEvent_Minute", "Minute >= 0");
        });
    }
}
