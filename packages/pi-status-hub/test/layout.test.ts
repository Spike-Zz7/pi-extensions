import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { renderExtensionBadges, renderFooterLayout } from "../src/layout.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import type { ResolvedStatusItem } from "../src/types.js";
import type { SystemSegmentData } from "../src/system-info.js";

const mockTheme = {
  fg: (_color: any, text: string) => text,
  bg: (_color: any, text: string) => text,
  bold: (text: string) => text,
  dim: (text: string) => text,
  italic: (text: string) => text,
  underline: (text: string) => text,
} as unknown as Theme;

describe("layout", () => {
  const sampleItems: ResolvedStatusItem[] = [
    {
      id: "subagents",
      rawText: "subagents: 2 running",
      displayText: "2 running",
      icon: "🤖",
      priority: 90,
      color: "accent",
      source: "native",
      hidden: false,
      updatedAt: 1,
    },
    {
      id: "sync",
      rawText: "sync: synced",
      displayText: "synced",
      icon: "🔄",
      priority: 80,
      color: "success",
      source: "native",
      hidden: false,
      updatedAt: 2,
    },
    {
      id: "accounts",
      rawText: "accounts: 3 active",
      displayText: "3 active",
      icon: "👤",
      priority: 70,
      color: "muted",
      source: "native",
      hidden: false,
      updatedAt: 3,
    },
  ];

  it("Stage 1 (Full): renders all badges when width is generous", () => {
    // Width 80 is plenty for all 3 items
    const result = renderExtensionBadges(sampleItems, 80, DEFAULT_CONFIG, mockTheme);
    assert.ok(result.line.includes("2 running"));
    assert.ok(result.line.includes("synced"));
    assert.ok(result.line.includes("3 active"));
    assert.ok(sampleItems.every((it) => it.displayState === "full"));
  });

  it("Stage 2 (Drop text): folds lower priority items to icon-only when width is constrained", () => {
    // Let's constrain width so lowest priority ('accounts', prio 70) must fold text
    // "🤖 2 running  🔄 synced  👤 3 active" is ~35 chars.
    // If width = 28, accounts text dropped: "🤖 2 running  🔄 synced  👤" is ~27 chars.
    const result = renderExtensionBadges(sampleItems, 28, DEFAULT_CONFIG, mockTheme);
    assert.ok(result.line.includes("🤖 2 running"));
    assert.ok(result.line.includes("🔄 synced"));
    // 'accounts' should have dropped text
    assert.ok(!result.line.includes("3 active"));
    assert.ok(result.line.includes("👤"));

    const accounts = sampleItems.find((i) => i.id === "accounts");
    assert.equal(accounts?.displayState, "icon-only");
  });

  it("Stage 3 (Overflow to +N): folds overflowed icons into +N badge when width is very small", () => {
    // Width 8 is too small even for 3 icons ("🤖  🔄  👤" is ~10 chars)
    const result = renderExtensionBadges(sampleItems, 8, DEFAULT_CONFIG, mockTheme);
    assert.ok(result.line.includes("+"));
    const overflowed = sampleItems.filter((i) => i.displayState === "overflow");
    assert.ok(overflowed.length > 0);
  });

  it("Adaptive layout: merges into single line when width is sufficient", () => {
    const sysSegments: SystemSegmentData[] = [
      { name: "cwd", text: "~/repo", styledText: "📁 ~/repo" },
      { name: "model", text: "gpt-4o", styledText: "gpt-4o" },
    ];

    const layout = renderFooterLayout(120, sysSegments, sampleItems, DEFAULT_CONFIG, mockTheme);
    // Width 120 can comfortably fit both system info and extension badges on 1 line
    assert.equal(layout.lines.length, 1);
    assert.ok(layout.lines[0]?.includes("~/repo"));
    assert.ok(layout.lines[0]?.includes("🤖"));
  });

  it("Adaptive layout: splits into 2 lines when width is narrow", () => {
    const sysSegments: SystemSegmentData[] = [
      { name: "cwd", text: "~/very/long/project/path/to/something", styledText: "📁 ~/very/long/project/path/to/something" },
      { name: "model", text: "claude-3-7-sonnet • thinking high", styledText: "claude-3-7-sonnet • thinking high" },
    ];

    const layout = renderFooterLayout(50, sysSegments, sampleItems, DEFAULT_CONFIG, mockTheme);
    // Width 50 cannot fit both system info and 3 badges on 1 line
    assert.equal(layout.lines.length, 2);
    assert.ok(layout.lines[0]?.includes("~/very/long"));
    assert.ok(layout.lines[1]?.includes("🤖"));
  });
});
