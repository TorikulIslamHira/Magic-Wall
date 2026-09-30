using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Serialization;

namespace MagicWall.Api.Modules.Sports.Media;

/// <summary>Bound from "Sports:Media:TheSportsDb".</summary>
public sealed class TheSportsDbOptions
{
    /// <summary>"123" is TheSportsDB's public test key; a premium key raises the quota.</summary>
    public string ApiKey { get; set; } = "123";

    public string BaseUrl { get; set; } = "https://www.thesportsdb.com/api/v1/json/";

    /// <summary>Free: 30 per minute; premium: 100.</summary>
    public int RequestsPerMinute { get; set; } = 30;
}

/// <summary>Finds pictures for players and teams. Returns remote URLs; <see cref="MediaStore"/> downloads them.</summary>
public interface ISportsMediaProvider
{
    string Name { get; }

    Task<string?> FindPlayerPhotoAsync(string playerName, string team, SportType sport, CancellationToken ct);

    Task<string?> FindTeamBadgeAsync(string team, SportType sport, CancellationToken ct);
}

/// <summary>
/// TheSportsDB v1 search. Player: the transparent cut-out if there is one (it sits well on a
/// broadcast graphic), else the square thumbnail. Team: the badge. A name can match several
/// people, so results are narrowed to the sport and, when possible, the team.
/// </summary>
public sealed class TheSportsDbProvider(HttpClient http, ILogger<TheSportsDbProvider> logger) : ISportsMediaProvider
{
    public string Name => "thesportsdb";

    public async Task<string?> FindPlayerPhotoAsync(string playerName, string team, SportType sport, CancellationToken ct)
    {
        var result = await GetAsync<PlayerSearch>($"searchplayers.php?p={Uri.EscapeDataString(playerName)}", ct);
        var candidates = (result?.Player ?? [])
            .Where(p => SportMatches(p.StrSport, sport) && string.Equals(Normalize(p.StrPlayer), Normalize(playerName), StringComparison.Ordinal))
            .ToList();
        if (candidates.Count == 0) return null;

        // Same name, several people: prefer the one at this team.
        var chosen = candidates.FirstOrDefault(p => TeamMatches(p.StrTeam, team)) ?? (candidates.Count == 1 ? candidates[0] : null);
        if (chosen is null)
        {
            logger.LogInformation("TheSportsDB: '{Player}' matches {Count} players, none at '{Team}'; no photo used.", playerName, candidates.Count, team);
            return null;
        }
        return FirstUrl(chosen.StrCutout, chosen.StrRender, chosen.StrThumb);
    }

    public async Task<string?> FindTeamBadgeAsync(string team, SportType sport, CancellationToken ct)
    {
        foreach (var name in TeamNameVariants(team))
        {
            var result = await GetAsync<TeamSearch>($"searchteams.php?t={Uri.EscapeDataString(name)}", ct);
            var found = (result?.Teams ?? []).FirstOrDefault(t => SportMatches(t.StrSport, sport) && TeamMatches(t.StrTeam, team));
            if (found is not null) return FirstUrl(found.StrBadge, found.StrLogo);
        }
        return null;
    }

    private async Task<T?> GetAsync<T>(string path, CancellationToken ct) where T : class
    {
        using var response = await http.GetAsync(path, ct);
        if (response.StatusCode == HttpStatusCode.NotFound) return null;
        response.EnsureSuccessStatusCode();
        // An empty search answers {"player": null}; some errors answer HTML.
        return response.Content.Headers.ContentType?.MediaType?.Contains("json") == true
            ? await response.Content.ReadFromJsonAsync<T>(ct)
            : null;
    }

    private static string? FirstUrl(params string?[] urls) =>
        urls.FirstOrDefault(u => Uri.TryCreate(u, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps);

    /// <summary>TheSportsDB calls football "Soccer".</summary>
    private static bool SportMatches(string? theirs, SportType ours) => theirs is null || ours switch
    {
        SportType.Football => theirs.Equals("Soccer", StringComparison.OrdinalIgnoreCase),
        SportType.Hockey => theirs.Contains("Hockey", StringComparison.OrdinalIgnoreCase),
        _ => theirs.Equals(ours.ToString(), StringComparison.OrdinalIgnoreCase)
    };

    /// <summary>"Arsenal FC" ≈ "Arsenal", "Man City" ≈ "Manchester City" is too loose to guess: containment only.</summary>
    private static bool TeamMatches(string? theirs, string ours)
    {
        if (string.IsNullOrWhiteSpace(theirs)) return false;
        var a = Normalize(StripSuffix(theirs));
        var b = Normalize(StripSuffix(ours));
        return a.Length > 0 && b.Length > 0 && (a.Contains(b, StringComparison.Ordinal) || b.Contains(a, StringComparison.Ordinal));
    }

    private static IEnumerable<string> TeamNameVariants(string team)
    {
        yield return team;
        var stripped = StripSuffix(team);
        if (!string.Equals(stripped, team, StringComparison.OrdinalIgnoreCase)) yield return stripped;
    }

    private static readonly string[] Suffixes = [" FC", " AFC", " CF", " SC", " SV", " AC", "FC ", "AFC ", "CF ", "SC "];

    private static string StripSuffix(string name)
    {
        var s = name.Trim();
        foreach (var suffix in Suffixes)
        {
            if (suffix.StartsWith(' ') && s.EndsWith(suffix, StringComparison.OrdinalIgnoreCase)) s = s[..^suffix.Length];
            else if (suffix.EndsWith(' ') && s.StartsWith(suffix, StringComparison.OrdinalIgnoreCase)) s = s[suffix.Length..];
        }
        return s.Trim();
    }

    /// <summary>Case- and accent-insensitive: "Vinícius" = "Vinicius".</summary>
    private static string Normalize(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;
        var decomposed = value.Trim().Normalize(System.Text.NormalizationForm.FormD);
        var chars = decomposed.Where(c => System.Globalization.CharUnicodeInfo.GetUnicodeCategory(c) != System.Globalization.UnicodeCategory.NonSpacingMark);
        return new string(chars.ToArray()).ToLowerInvariant();
    }

    private sealed record PlayerSearch([property: JsonPropertyName("player")] List<TsdbPlayer>? Player);

    private sealed record TsdbPlayer(
        [property: JsonPropertyName("strPlayer")] string? StrPlayer,
        [property: JsonPropertyName("strTeam")] string? StrTeam,
        [property: JsonPropertyName("strSport")] string? StrSport,
        [property: JsonPropertyName("strCutout")] string? StrCutout,
        [property: JsonPropertyName("strRender")] string? StrRender,
        [property: JsonPropertyName("strThumb")] string? StrThumb);

    private sealed record TeamSearch([property: JsonPropertyName("teams")] List<TsdbTeam>? Teams);

    private sealed record TsdbTeam(
        [property: JsonPropertyName("strTeam")] string? StrTeam,
        [property: JsonPropertyName("strSport")] string? StrSport,
        [property: JsonPropertyName("strBadge")] string? StrBadge,
        [property: JsonPropertyName("strLogo")] string? StrLogo);
}
