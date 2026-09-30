using System.Net;

namespace MagicWall.Api.Modules.Sports.Feed;

/// <summary>
/// Keeps an external API within its per-minute quota: never more than <c>limit</c> requests in
/// any rolling minute (exact, by timestamp, not an approximation). Callers wait their turn instead
/// of failing. Background work (the polling worker) may use all but one slot, so a person in the
/// control room — loading fixtures, say — never queues behind it. A 429 from the provider pauses
/// the gate for as long as it asks. One instance per API, shared by everything that calls it.
/// </summary>
public sealed class RequestRateGate(string name, int requestsPerMinute, TimeProvider clock, ILogger logger)
{
    // A minute plus a margin: we time a request as it leaves, the provider as it arrives, and
    // network delay on one request must not squeeze an extra one into the provider's minute.
    private static readonly TimeSpan Window = TimeSpan.FromSeconds(61.5);

    private readonly Lock _lock = new();
    private readonly Queue<DateTimeOffset> _sent = new();
    private readonly int _limit = Math.Max(1, requestsPerMinute);
    private DateTimeOffset _pausedUntil = DateTimeOffset.MinValue;

    public string Name => name;
    public int Limit => _limit;

    /// <summary>Waits until one more request fits in the quota, then records it.</summary>
    /// <param name="background">True for polling: leaves one slot per minute for interactive requests.</param>
    public async Task WaitTurnAsync(bool background, CancellationToken ct)
    {
        var allowed = background && _limit > 1 ? _limit - 1 : _limit;
        while (true)
        {
            TimeSpan wait;
            lock (_lock)   // never held while waiting: a request that may go now isn't stuck behind one that can't
            {
                var now = clock.GetUtcNow();
                while (_sent.Count > 0 && now - _sent.Peek() >= Window) _sent.Dequeue();

                wait = _pausedUntil > now ? _pausedUntil - now : TimeSpan.Zero;
                if (wait == TimeSpan.Zero && _sent.Count >= allowed)
                {
                    // The slot frees when the (count - allowed + 1)th oldest request leaves the window.
                    wait = _sent.ElementAt(_sent.Count - allowed) + Window - now;
                }
                if (wait <= TimeSpan.Zero)
                {
                    _sent.Enqueue(now);
                    return;
                }
            }
            logger.LogDebug("{Api}: quota of {Limit}/min in use, {Kind} request waits {Seconds:0.0}s.",
                name, _limit, background ? "background" : "interactive", wait.TotalSeconds);
            await Task.Delay(wait, clock, ct);
        }
    }

    /// <summary>The provider said "too many requests": hold everything back for <paramref name="retryAfter"/>.</summary>
    public void Pause(TimeSpan retryAfter)
    {
        lock (_lock)
        {
            var until = clock.GetUtcNow() + retryAfter;
            if (until > _pausedUntil) _pausedUntil = until;
        }
        logger.LogWarning("{Api}: provider rate limit hit (429); pausing requests for {Seconds:0}s.", name, retryAfter.TotalSeconds);
    }
}

/// <summary>
/// Puts every request of one HttpClient through a <see cref="RequestRateGate"/>. The request
/// timeout starts only once the gate lets the request through: waiting up to a minute for a free
/// slot is normal, and must not count as the provider being slow. (So the HttpClient itself has
/// no timeout; see Program.cs.)
/// </summary>
public sealed class RateGateHandler(RequestRateGate gate, Func<HttpResponseMessage, TimeSpan?> retryAfter, TimeSpan requestTimeout) : DelegatingHandler
{
    /// <summary>Set on a request to mark it as background polling (see <see cref="RequestRateGate.WaitTurnAsync"/>).</summary>
    public static readonly HttpRequestOptionsKey<bool> Background = new("MagicWall.RateGate.Background");

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        await gate.WaitTurnAsync(request.Options.TryGetValue(Background, out var background) && background, ct);

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(requestTimeout);
        HttpResponseMessage response;
        try
        {
            response = await base.SendAsync(request, timeout.Token);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            throw new TimeoutException($"{gate.Name} did not answer within {requestTimeout.TotalSeconds:0} s.");
        }
        if (response.StatusCode == HttpStatusCode.TooManyRequests)
        {
            gate.Pause(retryAfter(response) ?? TimeSpan.FromSeconds(60));
        }
        return response;
    }

    /// <summary>Standard Retry-After (seconds or date), used when a provider has no header of its own.</summary>
    public static TimeSpan? StandardRetryAfter(HttpResponseMessage response) =>
        response.Headers.RetryAfter?.Delta
        ?? (response.Headers.RetryAfter?.Date is { } date ? date - DateTimeOffset.UtcNow : null);
}
