using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;

namespace MagicWall.Api.Modules.Sports.Media;

/// <summary>Bound from "Sports:Media".</summary>
public sealed class SportsMediaOptions
{
    public const string Section = "Sports:Media";

    /// <summary>Look up player photos and team badges (needs internet on the server, not on the wall).</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>Where downloaded images are kept. Docker: /data/media (on the data volume).</summary>
    public string Directory { get; set; } = "media";

    /// <summary>A player or team without a picture is asked about again after this many days.</summary>
    public int RetryMissAfterDays { get; set; } = 7;

    public int MaxImageBytes { get; set; } = 5_000_000;

    /// <summary>Hosts images may be downloaded from. Anything else in an API answer is ignored.</summary>
    public string AllowedImageHosts { get; set; } = "r2.thesportsdb.com,www.thesportsdb.com,thesportsdb.com";

    public TheSportsDbOptions TheSportsDb { get; set; } = new();
}

/// <summary>URLs of stored media, as the wall and dashboard load them.</summary>
public static class SportsMedia
{
    public const string RoutePrefix = "/media/";

    public static string? Url(string? file) => file is null ? null : RoutePrefix + file;
}

/// <summary>
/// Downloads pictures once and serves them from this server, so the wall never loads anything
/// from the internet during a broadcast (and keeps working if TheSportsDB is slow or down).
/// Downloads are restricted to https, to allow-listed hosts, to real images, and to a size cap:
/// URLs come from a third-party API and must not be able to point the server anywhere else.
/// </summary>
public sealed partial class MediaStore(HttpClient http, IOptions<SportsMediaOptions> options, IHostEnvironment env, ILogger<MediaStore> logger)
{
    private static readonly Dictionary<string, string> Extensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ["image/png"] = "png",
        ["image/jpeg"] = "jpg",
        ["image/webp"] = "webp"
    };

    private readonly string _root = Path.GetFullPath(Path.Combine(env.ContentRootPath, options.Value.Directory));
    private readonly HashSet<string> _allowedHosts = options.Value.AllowedImageHosts
        .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
        .ToHashSet(StringComparer.OrdinalIgnoreCase);

    /// <summary>Saves the image at <paramref name="url"/> as media/{kind}/{name}-{hash}.{ext}; returns "kind/file" or null.</summary>
    /// <param name="kind">"players" or "teams".</param>
    public async Task<string?> DownloadAsync(string url, string kind, string name, CancellationToken ct)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps || !_allowedHosts.Contains(uri.Host))
        {
            logger.LogWarning("Media: refused to download {Url} (not https or host not allowed).", url);
            return null;
        }

        // TheSportsDB serves resized copies at "<image>/medium" (~500 px): plenty for the wall, a
        // fraction of the original's size. Fall back to the original if a copy isn't there.
        var bytes = await TryGetImageAsync(new Uri(uri + "/medium"), ct) ?? await TryGetImageAsync(uri, ct);
        if (bytes is null) return null;

        var hash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(url)))[..10];
        var file = $"{Slug(name)}-{hash}.{bytes.Value.Extension}";
        var folder = Path.Combine(_root, kind);
        System.IO.Directory.CreateDirectory(folder);
        var path = Path.Combine(folder, file);
        await File.WriteAllBytesAsync(path, bytes.Value.Data, ct);
        logger.LogInformation("Media: saved {Kind}/{File} ({Kb} KB) from {Url}.", kind, file, bytes.Value.Data.Length / 1024, url);
        return $"{kind}/{file}";
    }

    /// <summary>Full path of a stored file, or null if the name is not one this store could have written.</summary>
    public string? Resolve(string kind, string file)
    {
        if (kind is not ("players" or "teams") || !FileName().IsMatch(file)) return null;
        var path = Path.GetFullPath(Path.Combine(_root, kind, file));
        return path.StartsWith(_root + Path.DirectorySeparatorChar, StringComparison.Ordinal) && File.Exists(path) ? path : null;
    }

    private async Task<(byte[] Data, string Extension)?> TryGetImageAsync(Uri uri, CancellationToken ct)
    {
        try
        {
            using var response = await http.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, ct);
            if (!response.IsSuccessStatusCode) return null;
            var type = response.Content.Headers.ContentType?.MediaType ?? string.Empty;
            if (!Extensions.TryGetValue(type, out var extension)) return null;
            if (response.Content.Headers.ContentLength > options.Value.MaxImageBytes) return null;

            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var buffer = new MemoryStream();
            var chunk = new byte[81920];
            int read;
            while ((read = await stream.ReadAsync(chunk, ct)) > 0)
            {
                buffer.Write(chunk, 0, read);
                if (buffer.Length > options.Value.MaxImageBytes) return null;   // no Content-Length, or it lied
            }
            return buffer.Length == 0 ? null : (buffer.ToArray(), extension);
        }
        catch (Exception ex) when (ex is (HttpRequestException or TaskCanceledException) && !ct.IsCancellationRequested)
        {
            logger.LogWarning("Media: download of {Url} failed: {Message}", uri, ex.Message);
            return null;
        }
    }

    private static string Slug(string name)
    {
        var ascii = new string(name.Normalize(NormalizationForm.FormD)
            .Where(c => c < 128 && (char.IsLetterOrDigit(c) || c is ' ' or '-'))
            .ToArray()).Trim().ToLowerInvariant().Replace(' ', '-');
        return ascii.Length == 0 ? "img" : ascii[..Math.Min(40, ascii.Length)];
    }

    [GeneratedRegex("^[a-z0-9-]{1,60}\\.(png|jpg|webp)$")]
    private static partial Regex FileName();
}
