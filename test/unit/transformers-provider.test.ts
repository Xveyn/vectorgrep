import { describe, it, expect, vi } from "vitest";

// Each fake model embeds every text to its own fixed vector
const pipelineMock = vi.hoisted(() =>
  vi.fn(async (_task: string, model: string) => async (input: string | string[]) => {
    const count = Array.isArray(input) ? input.length : 1;
    const vector = model === "model-a" ? [1, 0] : [0, 1];
    return {
      dims: [count, 2],
      data: Float32Array.from(Array.from({ length: count }, () => vector).flat()),
    };
  })
);
vi.mock("@huggingface/transformers", () => ({ pipeline: pipelineMock }));

import { TransformersEmbeddingProvider } from "../../src/embedding/transformers.js";

describe("TransformersEmbeddingProvider", () => {
  it("keeps each instance on its own model", async () => {
    const a = new TransformersEmbeddingProvider("model-a");
    await a.initialize();
    const b = new TransformersEmbeddingProvider("model-b");
    await b.initialize();

    expect(await a.embed("x")).toEqual([1, 0]);
    expect(await b.embed("x")).toEqual([0, 1]);
    expect(await a.embedBatch(["x", "y"])).toEqual([
      [1, 0],
      [1, 0],
    ]);
  });

  it("refuses to embed before initialize", async () => {
    const provider = new TransformersEmbeddingProvider("model-a");

    await expect(provider.embed("x")).rejects.toThrow("not initialized");
    await expect(provider.embedBatch(["x", "y"])).rejects.toThrow("not initialized");
  });
});
