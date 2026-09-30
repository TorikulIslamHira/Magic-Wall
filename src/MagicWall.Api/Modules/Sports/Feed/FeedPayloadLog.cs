using System.Collections.Concurrent;

namespace MagicWall.Api.Modules.Sports.Feed;

/// <summary>
/// The last raw answer the provider gave for each match, kept in memory so the sports desk can see
/// exactly what came in (Feed data → raw). Bounded; a restart simply starts empty again.
/// </summary>
public sealed class FeedPayloadLog
{
    private const int MaxEntries = 200;
    private readonly ConcurrentDictionary<string, Entry> _entries = new();

    public sealed record Entry(string Provider, DateTime FetchedAt, string Json);

    public void Record(string provider, string feedMatchId, string json)
    {
        _entries[feedMatchId] = new Entry(provider, DateTime.UtcNow, json);
        if (_entries.Count > MaxEntries)
        {
            foreach (var oldest in _entries.OrderBy(e => e.Value.FetchedAt).Take(_entries.Count - MaxEntries))
            {
                _entries.TryRemove(oldest.Key, out _);
            }
        }
    }

    public Entry? Get(string feedMatchId) => _entries.GetValueOrDefault(feedMatchId);
}
