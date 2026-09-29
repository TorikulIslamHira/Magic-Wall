using MagicWall.Api.Auth;
using MagicWall.Api.Modules.Budget;
using MagicWall.Api.Modules.Election;
using MagicWall.Api.Modules.Geopolitics;
using MagicWall.Api.Modules.Sports;
using Microsoft.EntityFrameworkCore;

namespace MagicWall.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    // Module A: Election
    public DbSet<Constituency> Constituencies => Set<Constituency>();
    public DbSet<Candidate> Candidates => Set<Candidate>();
    public DbSet<ElectionResult> ElectionResults => Set<ElectionResult>();
    public DbSet<ElectionResultSubmission> ElectionResultSubmissions => Set<ElectionResultSubmission>();

    // Module B: Sports
    public DbSet<Match> Matches => Set<Match>();
    public DbSet<Player> Players => Set<Player>();
    public DbSet<MatchEvent> MatchEvents => Set<MatchEvent>();

    // Module C: War & Geopolitics
    public DbSet<ConflictZone> ConflictZones => Set<ConflictZone>();
    public DbSet<TimelineEvent> TimelineEvents => Set<TimelineEvent>();

    // Module D: Budget & Economy
    public DbSet<BudgetSector> BudgetSectors => Set<BudgetSector>();
    public DbSet<MegaProject> MegaProjects => Set<MegaProject>();

    // Newsroom accounts (roles: FieldReporter, DeskReporter, SportsDesk, Admin)
    public DbSet<AppUser> Users => Set<AppUser>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // Each module ships its own IEntityTypeConfiguration<T> classes;
        // a new module is picked up here without touching this file.
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);
    }

    protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder)
    {
        // SQLite has no native decimal type, so EF stores it as TEXT and cannot
        // SUM or ORDER BY it in SQL. Store as REAL on SQLite only; SQL Server/Postgres
        // keep exact decimal(18,2) precision for money.
        if (Database.IsSqlite())
        {
            configurationBuilder.Properties<decimal>().HaveConversion<double>();
        }
        else
        {
            configurationBuilder.Properties<decimal>().HavePrecision(18, 2);
        }
    }
}
