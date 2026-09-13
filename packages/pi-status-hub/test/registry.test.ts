import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { StatusHubRegistry } from "../src/registry.js";
import { DEFAULT_CONFIG } from "../src/config.js";

describe("registry", () => {
  it("registers, updates and removes structured items", () => {
    let updateCount = 0;
    const registry = new StatusHubRegistry(() => {
      updateCount++;
    });

    registry.register("my-plugin", {
      label: "indexing 42%",
      icon: "⚡",
      priority: 88,
    });
    assert.equal(updateCount, 1);

    const item = registry.get("my-plugin");
    assert.ok(item);
    assert.equal(item.label, "indexing 42%");
    assert.equal(item.priority, 88);

    registry.update("my-plugin", { label: "indexed 100%" });
    assert.equal(updateCount, 2);
    assert.equal(registry.get("my-plugin")?.label, "indexed 100%");

    registry.remove("my-plugin");
    assert.equal(updateCount, 3);
    assert.equal(registry.get("my-plugin"), undefined);
  });

  it("merges native and structured items sorted by priority descending", () => {
    const registry = new StatusHubRegistry();

    // 1. Structured item
    registry.register("custom-worker", {
      label: "working",
      priority: 95,
      icon: "⚙️",
    });

    // 2. Native items from getExtensionStatuses()
    const nativeMap = new Map<string, string>([
      ["subagents", "subagents: 2 active"], // well-known priority: 90
      ["sync", "sync: synced"],              // well-known priority: 80
      ["unknown-tool", "tool: running"],     // default priority: 50
      ["statusline", "ignored-text"],         // should be ignored
    ]);

    const resolved = registry.resolveAll(nativeMap, DEFAULT_CONFIG);

    assert.equal(resolved.length, 4);
    assert.equal(resolved[0]?.id, "custom-worker");
    assert.equal(resolved[0]?.priority, 95);

    assert.equal(resolved[1]?.id, "subagents");
    assert.equal(resolved[1]?.priority, 90);
    assert.equal(resolved[1]?.icon, "🤖");

    assert.equal(resolved[2]?.id, "sync");
    assert.equal(resolved[2]?.priority, 80);

    assert.equal(resolved[3]?.id, "unknown-tool");
    assert.equal(resolved[3]?.priority, 50);
  });

  it("filters out items listed in config.hidden", () => {
    const registry = new StatusHubRegistry();
    const nativeMap = new Map<string, string>([
      ["noisy-ext", "noisy-ext: some noise"],
      ["subagents", "subagents: active"],
    ]);

    const config = {
      ...DEFAULT_CONFIG,
      hidden: ["noisy-ext"],
    };

    const resolved = registry.resolveAll(nativeMap, config);
    const noisy = resolved.find((r) => r.id === "noisy-ext");
    assert.ok(noisy);
    assert.equal(noisy.hidden, true);

    const subagents = resolved.find((r) => r.id === "subagents");
    assert.ok(subagents);
    assert.equal(subagents.hidden, false);
  });
});
