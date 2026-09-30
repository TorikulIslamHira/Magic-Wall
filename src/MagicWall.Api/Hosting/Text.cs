using System.Globalization;

namespace MagicWall.Api.Hosting;

/// <summary>
/// Messages the API returns to people (validation errors, conflicts): Bangla by default, English
/// when the browser asks for it with Accept-Language: en (the dashboard sends its chosen language).
/// Only the UI culture follows the request; number and date formatting stay invariant.
/// </summary>
public static class Text
{
    public static bool English => CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "en";

    public static string L(string bangla, string english) => English ? english : bangla;
}
