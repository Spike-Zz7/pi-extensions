import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, mergeConfig, WELL_KNOWN_ICONS, WELL_KNOWN_PRIORITIES, saveConfig } from "../src/config.js";

describe("config", () => {
  it("provides reasonable defaults", () => {
    assert.equal(DEFAULT_CONFIG.style, "minimal");
    assert.equal(DEFAULT_CONFIG.adaptive, true);
    assert.deepEqual(DEFAULT_CONFIG.systemSegments, ["cwd", "branch", "model", "context", "cost"]);
    assert.deepEqual(DEFAULT_CONFIG.hidden, []);
  });

  it("merges partial overrides correctly", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, {
      style: "powerline",
      hidden: ["noisy-ext"],
      icons: { "custom-ext": "🚀" },
      priorities: { "custom-ext": 99 },
    });

    assert.equal(merged.style, "powerline");
    assert.equal(merged.adaptive, true); // Retained default
    assert.deepEqual(merged.hidden, ["noisy-ext"]);
    assert.equal(merged.icons["custom-ext"], "🚀");
    assert.equal(merged.priorities["custom-ext"], 99);
  });

  it("contains well-known plugin heuristics", () => {
    assert.equal(WELL_KNOWN_ICONS["subagents"], "🤖");
    assert.equal(WELL_KNOWN_ICONS["sync"], "🔄");
    assert.equal(WELL_KNOWN_ICONS["accounts"], "👤");
    assert.equal(WELL_KNOWN_PRIORITIES["subagents"], 90);
    assert.equal(WELL_KNOWN_PRIORITIES["sync"], 80);
  });

  it("handles saveConfig safely", () => {
    assert.doesNotThrow(() => {
      saveConfig({ ...DEFAULT_CONFIG, hidden: ["test-ext"] });
    });
  });
});
