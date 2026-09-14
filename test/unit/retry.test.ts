import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withRetry } from "../../src/utils/retry.js";

describe("withRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Retries log a warning to stderr; keep the test output clean
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns the result without retrying when the call succeeds", async () => {
    const fn = vi.fn(async () => "ok");

    await expect(withRetry(fn, "test")).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it.each([
    "fetch failed",
    "connect ECONNREFUSED 127.0.0.1:11434",
    "read ECONNRESET",
    "socket hang up",
    "Ollama embed failed: 429 Too Many Requests",
    "OpenAI embed failed: 503 Service Unavailable",
  ])("retries the transient error %j and returns the later result", async (message) => {
    const fn = vi.fn().mockRejectedValueOnce(new Error(message)).mockResolvedValueOnce("recovered");

    const result = withRetry(fn, "test", { baseDelayMs: 10 });
    await vi.runAllTimersAsync();

    await expect(result).resolves.toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries a request that was aborted by its timeout", async () => {
    // What fetch rejects with when AbortSignal.timeout() fires
    const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    const fn = vi.fn().mockRejectedValueOnce(timeout).mockResolvedValueOnce("recovered");

    const result = withRetry(fn, "test", { baseDelayMs: 10 });
    await vi.runAllTimersAsync();

    await expect(result).resolves.toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it.each(["Ollama embed failed: 400 Bad Request", "OpenAI embed failed: 401 Unauthorized", "invalid input"])(
    "does not retry the client error %j",
    async (message) => {
      const fn = vi.fn(async () => {
        throw new Error(message);
      });

      await expect(withRetry(fn, "test")).rejects.toThrow(message);
      expect(fn).toHaveBeenCalledTimes(1);
    }
  );

  it("backs off exponentially up to maxDelayMs", async () => {
    const fn = vi.fn(async () => {
      throw new Error("fetch failed");
    });

    const result = withRetry(fn, "test", { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 250 });
    const settled = result.catch((error: Error) => error);
    expect(fn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(99);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); // 100 ms
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(200); // 200 ms
    expect(fn).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(249);
    expect(fn).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1); // capped at 250 ms instead of 400
    expect(fn).toHaveBeenCalledTimes(4);

    expect(await settled).toBeInstanceOf(Error);
  });

  it("gives up after maxRetries and rethrows the last error", async () => {
    let attempt = 0;
    const fn = vi.fn(async () => {
      attempt++;
      throw new Error(`fetch failed (attempt ${attempt})`);
    });

    const result = withRetry(fn, "test", { maxRetries: 2, baseDelayMs: 10 });
    const settled = result.catch((error: Error) => error);
    await vi.runAllTimersAsync();

    expect((await settled as Error).message).toBe("fetch failed (attempt 3)");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("wraps non-Error rejections in an Error", async () => {
    const fn = vi.fn(async () => {
      throw "plain string";
    });

    await expect(withRetry(fn, "test")).rejects.toThrow("plain string");
  });
});
