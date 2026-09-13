import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../src/config.js";
import { renderExtensionBadges } from "../src/layout.js";
import { buildSystemSegments } from "../src/system-info.js";
import type { ResolvedStatusItem, StatusHubConfig } from "../src/types.js";
import type { ExtensionContext, ReadonlyFooterDataProvider, Theme } from "@earendil-works/pi-coding-agent";

const mockTheme: Theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

const mockFooterData: ReadonlyFooterDataProvider = {
  getGitBranch: () => "main",
  getExtensionStatuses: () => new Map(),
  onBranchChange: () => () => {},
  getAvailableProviderCount: () => 0,
};

const mockContext: ExtensionContext = {
  cwd: "/home/spike/project",
  getContextUsage: () => ({ contextWindow: 200000, percent: 15 }),
  sessionManager: { getBranch: () => [] },
  model: { id: "claude-3-7-sonnet" },
} as unknown as ExtensionContext;

describe("icon-controls", () => {
  it("supports icon-only mode for extension items (单独显示某个图标)", () => {
    const items: ResolvedStatusItem[] = [
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
    ];

    const config: StatusHubConfig = {
      ...DEFAULT_CONFIG,
      iconOnly: ["subagents"],
    };

    const res = renderExtensionBadges(items, 100, config, mockTheme);
    assert.equal(res.line.trim(), "🤖");
    assert(!res.line.includes("2 running"));
  });

  it("supports text-only mode for extension items (不显示图标)", () => {
    const items: ResolvedStatusItem[] = [
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
    ];

    const config: StatusHubConfig = {
      ...DEFAULT_CONFIG,
      textOnly: ["subagents"],
    };

    const res = renderExtensionBadges(items, 100, config, mockTheme);
    assert.equal(res.line.trim(), "2 running");
    assert(!res.line.includes("🤖"));
  });

  it("supports global showIcons: false switch", () => {
    const items: ResolvedStatusItem[] = [
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
    ];

    const config: StatusHubConfig = {
      ...DEFAULT_CONFIG,
      showIcons: false,
    };

    const res = renderExtensionBadges(items, 100, config, mockTheme);
    assert.equal(res.line.trim(), "2 running");
    assert(!res.line.includes("🤖"));
  });

  it("supports icon-only and custom icons in system segments", () => {
    const config: StatusHubConfig = {
      ...DEFAULT_CONFIG,
      systemSegments: ["cwd", "branch"],
      iconOnly: ["cwd"], // Only show icon for cwd
      icons: { cwd: "🏠" }, // Custom icon
    };

    const segs = buildSystemSegments(mockContext, mockFooterData, mockTheme, config);
    const cwdSeg = segs.find((s) => s.name === "cwd");
    const branchSeg = segs.find((s) => s.name === "branch");

    assert(cwdSeg);
    assert.equal(cwdSeg.text, "🏠"); // CWD is icon-only with custom icon 🏠

    assert(branchSeg);
    assert(branchSeg.text.includes("🌱 main")); // Branch has icon + text
  });
});
