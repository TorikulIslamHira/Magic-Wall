using System.Security.Claims;
using MagicWall.Api.Data;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace MagicWall.Api.Auth;

public record LoginRequest(string UserName, string Password);

public record MeDto(string UserName, string DisplayName, UserRole Role, IReadOnlyList<string> Capabilities);

/// <summary>One row of the role-permission matrix, straight from <see cref="Policies.Roles"/>.</summary>
public record RoleDto(UserRole Role, IReadOnlyList<string> Capabilities);

public record UserDto(int Id, string UserName, string DisplayName, UserRole Role, bool IsActive, DateTime CreatedAt);

public record CreateUserRequest(string UserName, string DisplayName, string Password, UserRole Role);

/// <param name="Password">Optional: set to reset the password.</param>
public record UpdateUserRequest(string DisplayName, UserRole Role, bool IsActive, string? Password);

public static class AuthEndpoints
{
    public const string LoginRateLimit = "login";
    private const int MinPasswordLength = 8;
    private static readonly PasswordHasher<AppUser> Hasher = new();

    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/auth").WithTags("Auth");

        group.MapPost("/login", Login).RequireRateLimiting(LoginRateLimit);
        group.MapPost("/logout", Logout);
        group.MapGet("/me", Me).RequireAuthorization();

        var users = group.MapGroup("/users").RequireAuthorization(Policies.ManageUsers);
        users.MapGet("/", ListUsers);
        users.MapPost("/", CreateUser);
        users.MapPut("/{id:int}", UpdateUser);
        group.MapGet("/roles", ListRoles).RequireAuthorization(Policies.ManageUsers);

        return app;
    }

    private static async Task<Results<Ok<MeDto>, UnauthorizedHttpResult>> Login(
        LoginRequest request, AppDbContext db, HttpContext http, IAuthorizationService authz, CancellationToken ct)
    {
        var userName = request.UserName?.Trim().ToLowerInvariant() ?? string.Empty;
        var user = await db.Users.SingleOrDefaultAsync(u => u.UserName == userName && u.IsActive, ct);

        // Same response for "no such user" and "wrong password", so names can't be probed.
        var verdict = user is null ? PasswordVerificationResult.Failed : Hasher.VerifyHashedPassword(user, user.PasswordHash, request.Password ?? string.Empty);
        if (user is null || verdict == PasswordVerificationResult.Failed)
        {
            return TypedResults.Unauthorized();
        }

        if (verdict == PasswordVerificationResult.SuccessRehashNeeded)
        {
            user.PasswordHash = Hasher.HashPassword(user, request.Password!);
            await db.SaveChangesAsync(ct);
        }

        var principal = CreatePrincipal(user.UserName, user.DisplayName, user.Role);
        await http.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, principal);
        return TypedResults.Ok(await BuildMe(principal, authz));
    }

    private static ClaimsPrincipal CreatePrincipal(string userName, string displayName, UserRole role) =>
        new(new ClaimsIdentity(
        [
            new Claim(ClaimTypes.Name, userName),
            new Claim(AuthClaims.DisplayName, displayName),
            new Claim(ClaimTypes.Role, role.ToString())
        ], CookieAuthenticationDefaults.AuthenticationScheme));

    /// <summary>
    /// Cookie check on every request: a deactivated user is signed out at once, and a changed
    /// role or name takes effect on their next request instead of when the 12-hour cookie expires.
    /// </summary>
    public static async Task ValidateSessionAsync(CookieValidatePrincipalContext context)
    {
        var userName = context.Principal?.Identity?.Name;
        var db = context.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
        var user = userName is null ? null : await db.Users.AsNoTracking()
            .Where(u => u.UserName == userName)
            .Select(u => new { u.DisplayName, u.Role, u.IsActive })
            .SingleOrDefaultAsync(context.HttpContext.RequestAborted);

        if (user is not { IsActive: true })
        {
            context.RejectPrincipal();
            await context.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return;
        }

        if (context.Principal!.FindFirstValue(ClaimTypes.Role) != user.Role.ToString()
            || context.Principal.DisplayNameOf() != user.DisplayName)
        {
            context.ReplacePrincipal(CreatePrincipal(userName!, user.DisplayName, user.Role));
            context.ShouldRenew = true;
        }
    }

    // The CancellationToken parameter matters: a lone HttpContext parameter would make this a raw
    // RequestDelegate, and the NoContent result would be discarded (200 instead of 204).
    private static async Task<NoContent> Logout(HttpContext http, CancellationToken ct)
    {
        await http.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        return TypedResults.NoContent();
    }

    private static async Task<Ok<MeDto>> Me(ClaimsPrincipal user, IAuthorizationService authz) =>
        TypedResults.Ok(await BuildMe(user, authz));

    /// <summary>The UI shows or hides whole sections by capability, never by role name.</summary>
    private static async Task<MeDto> BuildMe(ClaimsPrincipal user, IAuthorizationService authz)
    {
        var capabilities = new List<string>();
        foreach (var policy in Policies.Roles.Keys)
        {
            if ((await authz.AuthorizeAsync(user, policy)).Succeeded) capabilities.Add(policy);
        }
        var role = Enum.TryParse<UserRole>(user.FindFirstValue(ClaimTypes.Role), out var parsed) ? parsed : UserRole.FieldReporter;
        return new MeDto(user.UserName(), user.DisplayNameOf(), role, capabilities);
    }

    private static Task<List<UserDto>> ListUsers(AppDbContext db, CancellationToken ct) =>
        db.Users.AsNoTracking()
            .OrderBy(u => u.Role).ThenBy(u => u.UserName)
            .Select(u => new UserDto(u.Id, u.UserName, u.DisplayName, u.Role, u.IsActive, u.CreatedAt))
            .ToListAsync(ct);

    private static Ok<List<RoleDto>> ListRoles() =>
        TypedResults.Ok(Enum.GetValues<UserRole>()
            .Select(role => new RoleDto(role, Policies.Roles.Where(p => p.Value.Contains(role)).Select(p => p.Key).ToList()))
            .ToList());

    private static async Task<Results<Created<UserDto>, Conflict<string>, ValidationProblem>> CreateUser(
        CreateUserRequest request, AppDbContext db, CancellationToken ct)
    {
        var userName = request.UserName?.Trim().ToLowerInvariant() ?? string.Empty;
        var displayName = request.DisplayName?.Trim() ?? string.Empty;

        var errors = new Dictionary<string, string[]>();
        if (userName.Length is < 3 or > 60 || !userName.All(c => char.IsAsciiLetterOrDigit(c) || c is '.' or '_' or '-'))
            errors["userName"] = ["ব্যবহারকারীর নাম ৩–৬০ অক্ষরের হবে; শুধু ইংরেজি অক্ষর, সংখ্যা, . _ -"];
        if (displayName.Length is 0 or > 120) errors["displayName"] = ["প্রদর্শিত নাম দিন (সর্বোচ্চ ১২০ অক্ষর)।"];
        if ((request.Password?.Length ?? 0) < MinPasswordLength) errors["password"] = ["পাসওয়ার্ড অন্তত ৮ অক্ষরের হতে হবে।"];
        if (!Enum.IsDefined(request.Role)) errors["role"] = ["অজানা ভূমিকা।"];
        if (errors.Count > 0) return TypedResults.ValidationProblem(errors);

        if (await db.Users.AnyAsync(u => u.UserName == userName, ct))
        {
            return TypedResults.Conflict($"\"{userName}\" নামে ব্যবহারকারী আগেই আছে।");
        }

        var user = new AppUser { UserName = userName, DisplayName = displayName, Role = request.Role };
        user.PasswordHash = Hasher.HashPassword(user, request.Password!);
        db.Users.Add(user);
        await db.SaveChangesAsync(ct);

        return TypedResults.Created($"/api/auth/users/{user.Id}", new UserDto(user.Id, user.UserName, user.DisplayName, user.Role, user.IsActive, user.CreatedAt));
    }

    private static async Task<Results<NoContent, NotFound, ValidationProblem>> UpdateUser(
        int id, UpdateUserRequest request, ClaimsPrincipal me, AppDbContext db, CancellationToken ct)
    {
        var user = await db.Users.FindAsync([id], ct);
        if (user is null) return TypedResults.NotFound();

        var errors = new Dictionary<string, string[]>();
        var displayName = request.DisplayName?.Trim() ?? string.Empty;
        if (displayName.Length is 0 or > 120) errors["displayName"] = ["প্রদর্শিত নাম দিন (সর্বোচ্চ ১২০ অক্ষর)।"];
        if (request.Password is { Length: > 0 and < MinPasswordLength }) errors["password"] = ["পাসওয়ার্ড অন্তত ৮ অক্ষরের হতে হবে।"];
        if (!Enum.IsDefined(request.Role)) errors["role"] = ["অজানা ভূমিকা।"];

        // Never lock the newsroom out: no admin can remove their own access, and the last
        // active admin stays an active admin.
        var losesAdmin = user is { Role: UserRole.Admin, IsActive: true } && (request.Role != UserRole.Admin || !request.IsActive);
        if (losesAdmin && user.UserName == me.UserName())
            errors["role"] = ["নিজের অ্যাডমিন অধিকার বা অ্যাকাউন্ট বন্ধ করা যায় না — অন্য একজন অ্যাডমিনকে দিয়ে করান।"];
        else if (losesAdmin && !await db.Users.AnyAsync(u => u.Id != id && u.Role == UserRole.Admin && u.IsActive, ct))
            errors["role"] = ["এটিই শেষ সক্রিয় অ্যাডমিন অ্যাকাউন্ট। আগে আরেকজন অ্যাডমিন তৈরি করুন।"];
        if (errors.Count > 0) return TypedResults.ValidationProblem(errors);

        user.DisplayName = displayName;
        user.Role = request.Role;
        user.IsActive = request.IsActive;
        if (!string.IsNullOrEmpty(request.Password)) user.PasswordHash = Hasher.HashPassword(user, request.Password);
        await db.SaveChangesAsync(ct);

        // Takes effect on the user's next request (see ValidateSessionAsync).
        return TypedResults.NoContent();
    }

    /// <summary>
    /// Makes sure someone can log in: creates the bootstrap admin from configuration when the
    /// user table is empty, and demo accounts when explicitly enabled (Development, or
    /// Auth:SeedDemoUsers for local Docker testing).
    /// </summary>
    public static async Task EnsureUsersAsync(AppDbContext db, IConfiguration config, IHostEnvironment env, ILogger logger)
    {
        if (!await db.Users.AnyAsync())
        {
            var password = config["Auth:BootstrapAdmin:Password"];
            if (!string.IsNullOrEmpty(password))
            {
                var admin = new AppUser { UserName = config["Auth:BootstrapAdmin:UserName"] ?? "admin", DisplayName = "অ্যাডমিন", Role = UserRole.Admin };
                admin.PasswordHash = Hasher.HashPassword(admin, password);
                db.Users.Add(admin);
                logger.LogWarning("Created bootstrap admin '{User}'. Change its password after first login.", admin.UserName);
            }
            else
            {
                logger.LogWarning("No users exist and Auth:BootstrapAdmin:Password is not set: only the admin key can make changes.");
            }
        }

        if (env.IsDevelopment() || config.GetValue<bool>("Auth:SeedDemoUsers"))
        {
            var demoPassword = config["Auth:DemoPassword"] ?? "Demo@1234";
            (string Name, string Display, UserRole Role)[] demo =
            [
                ("field1", "মাঠ প্রতিবেদক ১", UserRole.FieldReporter),
                ("field2", "মাঠ প্রতিবেদক ২", UserRole.FieldReporter),
                ("desk1", "ডেস্ক প্রতিবেদক ১", UserRole.DeskReporter),
                ("desk2", "ডেস্ক প্রতিবেদক ২", UserRole.DeskReporter),
                ("sports1", "স্পোর্টস ডেস্ক ১", UserRole.SportsDesk),
                ("admin", "অ্যাডমিন", UserRole.Admin)
            ];
            foreach (var (name, display, role) in demo)
            {
                if (await db.Users.AnyAsync(u => u.UserName == name)) continue;
                var user = new AppUser { UserName = name, DisplayName = display, Role = role };
                user.PasswordHash = Hasher.HashPassword(user, demoPassword);
                db.Users.Add(user);
            }
            logger.LogWarning("Demo users are enabled (field1, desk1, sports1, admin …). Never enable this on a live system.");
        }

        await db.SaveChangesAsync();
    }
}
