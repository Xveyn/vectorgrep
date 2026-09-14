import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OllamaEmbeddingProvider } from "../../src/embedding/ollama.js";
import { OpenAIEmbeddingProvider } from "../../src/embedding/openai.js";

/** A fetch that never answers — it only settles when its request is aborted. */
function hangingFetch() {
  return vi.fn(
    (_url: string | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })
  );
}

const fastRetry = { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 1 };

describe("embedding request timeouts", () => {
  beforeEach(() => {
    // Retries log a warning to stderr
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("aborts a hanging Ollama embed request and retries it", async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OllamaEmbeddingProvider("http://localhost:11434", "nomic-embed-text", {
      timeoutMs: 20,
      retry: fastRetry,
    });

    await expect(provider.embed("hello")).rejects.toThrow(/timeout|aborted/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 2000);

  it("aborts a hanging Ollama batch request", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const provider = new OllamaEmbeddingProvider("http://localhost:11434", "nomic-embed-text", {
      timeoutMs: 20,
      retry: fastRetry,
    });

    await expect(provider.embedBatch(["a", "b"])).rejects.toThrow(/timeout|aborted/i);
  }, 2000);

  it("reports Ollama as unavailable when the server doesn't answer", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const provider = new OllamaEmbeddingProvider("http://localhost:11434", "nomic-embed-text", { timeoutMs: 20 });

    await expect(provider.isAvailable()).resolves.toBe(false);
  }, 2000);

  it("aborts a hanging OpenAI request and retries it", async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAIEmbeddingProvider("sk-test", "text-embedding-3-small", {
      timeoutMs: 20,
      retry: fastRetry,
    });

    await expect(provider.embed("hello")).rejects.toThrow(/timeout|aborted/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 2000);
});
