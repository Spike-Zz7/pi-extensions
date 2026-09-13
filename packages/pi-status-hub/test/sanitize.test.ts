import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeRawStatusText,
  extractLeadingEmoji,
  simplifyStatusText,
  inferStatusColor,
  sanitizeStatus,
} from "../src/sanitize.js";

describe("sanitize", () => {
  it("strips matching key prefixes", () => {
    assert.equal(sanitizeRawStatusText("subagents", "subagents: 2 running"), "2 running");
    assert.equal(sanitizeRawStatusText("sync", "sync - synced"), "synced");
    assert.equal(sanitizeRawStatusText("accounts", "accounts 3 active"), "3 active");
    assert.equal(sanitizeRawStatusText("other", "unrelated text"), "unrelated text");
  });

  it("extracts leading emoji and avoids duplicating it", () => {
    const res1 = extractLeadingEmoji("🤖 2 children running");
    assert.equal(res1.icon, "🤖");
    assert.equal(res1.remainingText, "2 children running");

    const res2 = extractLeadingEmoji("plain text");
    assert.equal(res2.icon, undefined);
    assert.equal(res2.remainingText, "plain text");
  });

  it("simplifies verbose status keywords", () => {
    assert.equal(simplifyStatusText("is ready"), "✓");
    assert.equal(simplifyStatusText("idle"), "·");
    assert.equal(simplifyStatusText("is running"), "▶");
    assert.equal(simplifyStatusText("error"), "✖");
  });

  it("infers semantic theme colors", () => {
    assert.equal(inferStatusColor("crash on worker 1"), "error");
    assert.equal(inferStatusColor("fatal network timeout"), "error");
    assert.equal(inferStatusColor("warning: retry scheduled"), "warning");
    assert.equal(inferStatusColor("conflict detected"), "warning");
    assert.equal(inferStatusColor("synced to remote"), "success");
    assert.equal(inferStatusColor("all tests pass"), "success");
    assert.equal(inferStatusColor("idle"), "dim");
    assert.equal(inferStatusColor("some ordinary status"), "muted");
  });

  it("runs full sanitize pipeline", () => {
    const result = sanitizeStatus("subagents", "subagents: 🤖 2 running");
    assert.equal(result.extractedIcon, "🤖");
    assert.equal(result.cleanText, "2 ▶");
    assert.equal(result.inferredColor, "success");
  });
});
