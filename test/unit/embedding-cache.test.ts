import { describe, it, expect, vi, afterEach } from "vitest";
import { CachedEmbeddingProvider } from "../../src/embedding/cache.js";
import type { EmbeddingProvider } from "../../src/embedding/provider.js";

const vectorFor = (text: string) => [text.length, text.charCodeAt(0)];

function fakeProvider() {
  return {
    name: "fake",
    model: "fake-model",
    dimensions: 2,
    initialize: vi.fn(async () => {}),
    isAvailable: vi.fn(async () => true),
    embed: vi.fn(async (text: string) => vectorFor(text)),
    embedBatch: vi.fn(async (texts: string[]) => texts.map(vectorFor)),
  } satisfies EmbeddingProvider;
}

describe("CachedEmbeddingProvider", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("exposes the wrapped provider's identity and delegates setup", async () => {
    const inner = fakeProvider();
    const cached = new CachedEmbeddingProvider(inner);

    expect([cached.name, cached.model, cached.dimensions]).toEqual(["fake", "fake-model", 2]);
    await cached.initialize();
    await expect(cached.isAvailable()).resolves.toBe(true);
    expect(inner.initialize).toHaveBeenCalledOnce();
  });

  it("embeds a repeated query only once", async () => {
    const inner = fakeProvider();
    const cached = new CachedEmbeddingProvider(inner);

    const first = await cached.embed("find login");
    const second = await cached.embed("find login");

    expect(second).toEqual(first);
    expect(inner.embed).toHaveBeenCalledOnce();
    expect(cached.getStats()).toEqual({ hits: 1, misses: 1, size: 1, hitRate: "50.0%" });
  });

  it("reports N/A before any lookup", () => {
    expect(new CachedEmbeddingProvider(fakeProvider()).getStats().hitRate).toBe("N/A");
  });

  it("sends only uncached texts to the provider and keeps the batch order", async () => {
    const inner = fakeProvider();
    const cached = new CachedEmbeddingProvider(inner);
    await cached.embed("b");

    const result = await cached.embedBatch(["a", "b", "cc"]);

    expect(inner.embedBatch).toHaveBeenCalledWith(["a", "cc"]);
    expect(result).toEqual([vectorFor("a"), vectorFor("b"), vectorFor("cc")]);
  });

  it("caches texts embedded in a batch for later single lookups", async () => {
    const inner = fakeProvider();
    const cached = new CachedEmbeddingProvider(inner);

    await cached.embedBatch(["x", "y"]);
    await cached.embed("y");

    expect(inner.embed).not.toHaveBeenCalled();
  });

  it("evicts the least recently used entry when full", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const inner = fakeProvider();
    const cached = new CachedEmbeddingProvider(inner, 2);

    vi.setSystemTime(1_000);
    await cached.embed("a");
    vi.setSystemTime(2_000);
    await cached.embed("b");
    vi.setSystemTime(3_000);
    await cached.embed("a"); // touch "a", so "b" is now the oldest
    vi.setSystemTime(4_000);
    await cached.embed("c"); // evicts "b"

    expect(cached.getStats().size).toBe(2);
    inner.embed.mockClear();
    await cached.embed("a");
    expect(inner.embed).not.toHaveBeenCalled();
    await cached.embed("b");
    expect(inner.embed).toHaveBeenCalledWith("b");
  });
});
