using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace MagicWall.Api.Auth;

/// <summary>
/// Authenticates the <c>X-Admin-Key</c> header as an Admin. Kept alongside user logins for
/// automation (tools/, scripts) and for the dashboard until everyone has an account.
/// With no <c>Admin:ApiKey</c> configured, the header is never accepted.
/// </summary>
public class AdminKeyAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder, IConfiguration config)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "AdminKey";
    public const string HeaderName = "X-Admin-Key";

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var provided = Request.Headers[HeaderName].ToString();
        if (provided.Length == 0) return Task.FromResult(AuthenticateResult.NoResult());

        var expected = config["Admin:ApiKey"];
        if (string.IsNullOrEmpty(expected)
            || !CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(provided), Encoding.UTF8.GetBytes(expected)))
        {
            return Task.FromResult(AuthenticateResult.Fail("Invalid admin key."));
        }

        var identity = new ClaimsIdentity(
        [
            new Claim(ClaimTypes.Name, "admin-key"),
            new Claim(AuthClaims.DisplayName, "অ্যাডমিন কী"),
            new Claim(ClaimTypes.Role, nameof(UserRole.Admin))
        ], SchemeName);

        return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName)));
    }
}

public static class AuthClaims
{
    public const string DisplayName = "display_name";

    /// <summary>Who did it, for SubmittedBy / ReviewedBy: the login name.</summary>
    public static string UserName(this ClaimsPrincipal user) => user.Identity?.Name ?? "unknown";

    public static string DisplayNameOf(this ClaimsPrincipal user) => user.FindFirstValue(DisplayName) ?? user.UserName();
}
