using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace MagicWall.Api.Auth;

/// <summary>Newsroom roles. One role per user keeps the model easy to audit.</summary>
public enum UserRole
{
    /// <summary>Submits raw vote counts from the ground; cannot approve anything.</summary>
    FieldReporter,

    /// <summary>Reviews election submissions; edits election setup, war and budget data.</summary>
    DeskReporter,

    /// <summary>Reviews the sports feed queue; manages matches, players and manual events.</summary>
    SportsDesk,

    /// <summary>Everything, including user management.</summary>
    Admin
}

public class AppUser
{
    public int Id { get; set; }

    /// <summary>Login name, stored lower-case.</summary>
    public string UserName { get; set; } = string.Empty;

    /// <summary>Shown in the approval queue ("submitted by …").</summary>
    public string DisplayName { get; set; } = string.Empty;

    /// <summary>ASP.NET Core Identity's PasswordHasher format (PBKDF2, salted).</summary>
    public string PasswordHash { get; set; } = string.Empty;

    public UserRole Role { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

internal class AppUserConfiguration : IEntityTypeConfiguration<AppUser>
{
    public void Configure(EntityTypeBuilder<AppUser> builder)
    {
        builder.ToTable("Users");
        builder.Property(u => u.UserName).HasMaxLength(60).IsRequired();
        builder.Property(u => u.DisplayName).HasMaxLength(120).IsRequired();
        builder.Property(u => u.PasswordHash).HasMaxLength(200).IsRequired();
        builder.Property(u => u.Role).HasConversion<string>().HasMaxLength(20);
        builder.HasIndex(u => u.UserName).IsUnique();
    }
}

/// <summary>
/// Authorization policies, one per capability. Endpoints ask for a capability, never a role,
/// so changing who may do what is a one-line edit here.
/// </summary>
public static class Policies
{
    public const string SubmitElection = nameof(SubmitElection);
    public const string ReviewElection = nameof(ReviewElection);
    public const string ManageSports = nameof(ManageSports);
    public const string EditDesk = nameof(EditDesk);
    public const string ControlWall = nameof(ControlWall);
    public const string ManageUsers = nameof(ManageUsers);

    public static readonly IReadOnlyDictionary<string, UserRole[]> Roles = new Dictionary<string, UserRole[]>
    {
        [SubmitElection] = [UserRole.FieldReporter, UserRole.DeskReporter, UserRole.Admin],
        [ReviewElection] = [UserRole.DeskReporter, UserRole.Admin],
        [ManageSports] = [UserRole.SportsDesk, UserRole.Admin],
        [EditDesk] = [UserRole.DeskReporter, UserRole.Admin],
        [ControlWall] = [UserRole.DeskReporter, UserRole.SportsDesk, UserRole.Admin],
        [ManageUsers] = [UserRole.Admin]
    };
}
