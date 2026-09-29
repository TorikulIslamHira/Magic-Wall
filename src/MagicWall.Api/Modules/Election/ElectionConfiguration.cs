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

        builder.HasOne(c => c.Constituency).WithMany().HasForeignKey(c => c.ConstituencyId).OnDelete(DeleteBehavior.SetNull);

        builder.HasIndex(c => c.PartyName);
    }
}

internal class ElectionResultSubmissionConfiguration : IEntityTypeConfiguration<ElectionResultSubmission>
{
    public void Configure(EntityTypeBuilder<ElectionResultSubmission> builder)
    {
        builder.Property(s => s.Status).HasConversion<string>().HasMaxLength(20);
        builder.Property(s => s.Note).HasMaxLength(500);
        builder.Property(s => s.SubmittedBy).HasMaxLength(60).IsRequired();
        builder.Property(s => s.SubmittedByName).HasMaxLength(120).IsRequired();
        builder.Property(s => s.ReviewedBy).HasMaxLength(60);
        builder.Property(s => s.ReviewedByName).HasMaxLength(120);
        builder.Property(s => s.ReviewNote).HasMaxLength(500);

        builder.HasOne(s => s.Constituency).WithMany().HasForeignKey(s => s.ConstituencyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne(s => s.Candidate).WithMany().HasForeignKey(s => s.CandidateId).OnDelete(DeleteBehavior.Restrict);

        // The desk's queue: pending first, oldest first.
        builder.HasIndex(s => new { s.Status, s.SubmittedAt });
        // Superseding older pending proposals for the same figure on approval.
        builder.HasIndex(s => new { s.ConstituencyId, s.CandidateId, s.Status });

        builder.ToTable(t => t.HasCheckConstraint("CK_ElectionResultSubmission_Votes", "VotesReceived >= 0"));
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
