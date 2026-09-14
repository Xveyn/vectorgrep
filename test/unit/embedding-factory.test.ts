import { describe, it, expect, vi, afterEach } from "vitest";

const pipelineMock = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => async () => ({
    dims: [1, 4],
    data: new Float32Array([0.5, 0.5, 0.5, 0.5]),
  }))
);
vi.mock("@huggingface/transformers", () => ({ pipeline: pipelineMock }));

import { createEmbeddingProvider } from "../../src/embedding/factory.js";
import { ProjectConfigSchema } from "../../src/config/schema.js";

const TRANSFORMERS_DEFAULT = "Xenova/all-MiniLM-L6-v2";
const defaults = () => ProjectConfigSchema.parse({}).embedding;

afterEach(() => {
  vi.unstubAllGlobals();
  pipelineMock.mockClear();
});

describe("createEmbeddingProvider", () => {
  it("uses the transformers default model when none is configured", async () => {
    const provider = await createEmbeddingProvider({ ...defaults(), provider: "transformers" });

    expect(provider.name).toBe("transformers");
    expect(provider.model).toBe(TRANSFORMERS_DEFAULT);
    expect(pipelineMock).toHaveBeenCalledWith("feature-extraction", TRANSFORMERS_DEFAULT, expect.anything());
  });

  it("reports the transformers model when auto-detection falls back from Ollama", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("fetch failed");
    }));

    const provider = await createEmbeddingProvider(defaults());

    expect(provider.name).toBe("transformers");
    expect(provider.model).toBe(TRANSFORMERS_DEFAULT);
  });

  it("uses the Ollama default model when none is configured", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) =>
      String(url).endsWith("/api/tags")
        ? Response.json({ models: [{ name: "nomic-embed-text:latest" }] })
        : Response.json({ embeddings: [[0.1, 0.2, 0.3]] })
    ));

    const provider = await createEmbeddingProvider({ ...defaults(), provider: "ollama" });

    expect(provider.name).toBe("ollama");
    expect(provider.model).toBe("nomic-embed-text");
    expect(provider.dimensions).toBe(3);
  });
});
