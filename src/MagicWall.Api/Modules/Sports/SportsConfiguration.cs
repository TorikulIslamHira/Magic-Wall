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
        builder.Property(m => m.Competition).HasMaxLength(100);
        builder.Property(m => m.FeedStatus).HasMaxLength(20);

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
        builder.Property(p => p.ExternalId).HasMaxLength(60);
        builder.Property(p => p.PhotoSourceUrl).HasMaxLength(500);
        builder.Property(p => p.PhotoFile).HasMaxLength(100);

        builder.HasIndex(p => p.Team);
        builder.HasIndex(p => p.ExternalId).IsUnique().HasFilter("ExternalId IS NOT NULL");
    }
}

internal class TeamMediaConfiguration : IEntityTypeConfiguration<TeamMedia>
{
    public void Configure(EntityTypeBuilder<TeamMedia> builder)
    {
        builder.Property(t => t.Team).HasMaxLength(100).IsRequired();
        builder.Property(t => t.BadgeSourceUrl).HasMaxLength(500);
        builder.Property(t => t.BadgeFile).HasMaxLength(100);
        builder.HasIndex(t => t.Team).IsUnique();
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
        builder.Property(e => e.Detail).HasMaxLength(200);
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
            t.HasCheckConstraint("CK_MatchEvent_X", "CoordinateX IS NULL OR CoordinateX BETWEEN 0 AND 100");
            t.HasCheckConstraint("CK_MatchEvent_Y", "CoordinateY IS NULL OR CoordinateY BETWEEN 0 AND 100");
            // A position is both coordinates or neither; an arrow needs a start point.
            t.HasCheckConstraint("CK_MatchEvent_XY", "(CoordinateX IS NULL) = (CoordinateY IS NULL)");
            t.HasCheckConstraint("CK_MatchEvent_EndNeedsStart", "EndCoordinateX IS NULL OR CoordinateX IS NOT NULL");
            t.HasCheckConstraint("CK_MatchEvent_EndX", "EndCoordinateX IS NULL OR EndCoordinateX BETWEEN 0 AND 100");
            t.HasCheckConstraint("CK_MatchEvent_EndY", "EndCoordinateY IS NULL OR EndCoordinateY BETWEEN 0 AND 100");
            t.HasCheckConstraint("CK_MatchEvent_Minute", "Minute >= 0");
        });
    }
}
