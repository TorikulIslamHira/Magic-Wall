using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace MagicWall.Api.Modules.Election;

internal class ConstituencyConfiguration : IEntityTypeConfiguration<Constituency>
{
    public void Configure(EntityTypeBuilder<Constituency> builder)
    {
        builder.Property(c => c.Name).HasMaxLength(150).IsRequired();
        builder.Property(c => c.SvgPathId).HasMaxLength(100).IsRequired();

        builder.Property(c => c.DistrictCode).HasMaxLength(60);

        // The map looks constituencies up by path id on every tap.
        builder.HasIndex(c => c.SvgPathId).IsUnique();
        builder.HasIndex(c => c.DistrictCode);

        builder.ToTable(t => t.HasCheckConstraint("CK_Constituency_TotalVoters", "TotalVoters >= 0"));
    }
}

internal class CandidateConfiguration : IEntityTypeConfiguration<Candidate>
{
    public void Configure(EntityTypeBuilder<Candidate> builder)
    {
        builder.Property(c => c.Name).HasMaxLength(150).IsRequired();
        builder.Property(c => c.PartyName).HasMaxLength(150).IsRequired();
        builder.Property(c => c.Symbol).HasMaxLength(200);

        builder.HasIndex(c => c.PartyName);
    }
}

internal class ElectionResultConfiguration : IEntityTypeConfiguration<ElectionResult>
{
    public void Configure(EntityTypeBuilder<ElectionResult> builder)
    {
        builder.HasOne(r => r.Constituency)
            .WithMany(c => c.Results)
            .HasForeignKey(r => r.ConstituencyId)
            .OnDelete(DeleteBehavior.Cascade);

        // Deleting a candidate must not silently wipe recorded votes.
        builder.HasOne(r => r.Candidate)
            .WithMany(c => c.Results)
            .HasForeignKey(r => r.CandidateId)
            .OnDelete(DeleteBehavior.Restrict);

        // One tally row per candidate per seat; live updates overwrite it.
        builder.HasIndex(r => new { r.ConstituencyId, r.CandidateId }).IsUnique();

        builder.ToTable(t => t.HasCheckConstraint("CK_ElectionResult_Votes", "VotesReceived >= 0"));
    }
}
