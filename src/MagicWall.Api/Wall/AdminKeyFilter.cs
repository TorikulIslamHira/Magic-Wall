using System.Security.Cryptography;
using System.Text;

namespace MagicWall.Api.Wall;

public static class AdminKeyFilter
{
    public const string HeaderName = "X-Admin-Key";

    /// <summary>
    /// Requires the <c>X-Admin-Key</c> header to match <c>Admin:ApiKey</c> from configuration.
    /// Fails closed: with no key configured, protected endpoints are disabled.
    /// </summary>
    public static TBuilder RequireAdminKey<TBuilder>(this TBuilder builder)
        where TBuilder : IEndpointConventionBuilder =>
        builder.AddEndpointFilter(async (context, next) =>
        {
            var http = context.HttpContext;
            var expected = http.RequestServices.GetRequiredService<IConfiguration>()["Admin:ApiKey"];

            if (string.IsNullOrEmpty(expected))
            {
                return TypedResults.Problem(
                    "অ্যাডমিন পরিবর্তন বন্ধ আছে। কনফিগারেশনে Admin:ApiKey সেট করুন।",
                    statusCode: StatusCodes.Status503ServiceUnavailable);
            }

            var provided = http.Request.Headers[HeaderName].ToString();
            var matches = CryptographicOperations.FixedTimeEquals(
                Encoding.UTF8.GetBytes(provided), Encoding.UTF8.GetBytes(expected));

            return matches ? await next(context) : TypedResults.Unauthorized();
        });
}
