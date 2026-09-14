import { describe, it, expect } from "vitest";
import { withProjectWriteLock, waitForProjectWrites } from "../../src/utils/project-lock.js";

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

describe("withProjectWriteLock", () => {
  it("runs writes for the same project one after another", async () => {
    const events: string[] = [];
    const task = (name: string) => async () => {
      events.push(`${name}:start`);
      await tick();
      events.push(`${name}:end`);
    };

    await Promise.all([
      withProjectWriteLock("/tmp/project-a", task("first")),
      withProjectWriteLock("/tmp/project-a", task("second")),
    ]);

    expect(events).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });

  it("does not block writes for other projects", async () => {
    const events: string[] = [];
    const task = (name: string) => async () => {
      events.push(`${name}:start`);
      await tick();
      events.push(`${name}:end`);
    };

    await Promise.all([
      withProjectWriteLock("/tmp/project-b", task("b")),
      withProjectWriteLock("/tmp/project-c", task("c")),
    ]);

    expect(events.slice(0, 2).sort()).toEqual(["b:start", "c:start"]);
  });

  it("releases the lock when a write throws", async () => {
    await expect(
      withProjectWriteLock("/tmp/project-d", async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    await expect(withProjectWriteLock("/tmp/project-d", async () => "next")).resolves.toBe("next");
  });

  it("lets readers wait until pending writes are done", async () => {
    let written = false;
    const write = withProjectWriteLock("/tmp/project-e", async () => {
      await tick(20);
      written = true;
    });

    await waitForProjectWrites("/tmp/project-e");

    expect(written).toBe(true);
    await write;
  });

  it("does not make readers wait for a failed write to rethrow", async () => {
    const write = withProjectWriteLock("/tmp/project-f", async () => {
      await tick();
      throw new Error("write failed");
    });

    await expect(waitForProjectWrites("/tmp/project-f")).resolves.toBeUndefined();
    await expect(write).rejects.toThrow("write failed");
  });
});
