import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../src/config.js";
import { renderFooterLayout } from "../src/layout.js";
import { StatusHubRegistry } from "../src/registry.js";
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
  getExtensionStatuses: () => new Map([
    ["subagents", "subagents: 2 running"],
    ["sync", "sync: synced"],
    ["accounts", "accounts: spike"],
  ]),
  onBranchChange: () => () => {},
  getAvailableProviderCount: () => 0,
};

const mockContext: ExtensionContext = {
  cwd: "/home/spike/project",
  getContextUsage: () => ({ contextWindow: 200000, percent: 15 }),
  sessionManager: { getBranch: () => [] },
  model: { id: "claude-3-7-sonnet" },
} as unknown as ExtensionContext;

describe("ordering", () => {
  it("system segments strictly follow config.systemSegments array sequence", () => {
    const config1: StatusHubConfig = {
      ...DEFAULT_CONFIG,
      systemSegments: ["cwd", "branch", "model"],
    };
    const segs1 = buildSystemSegments(mockContext, mockFooterData, mockTheme, config1);
    assert.deepEqual(segs1.map((s) => s.name), ["cwd", "branch", "model"]);

    const config2: StatusHubConfig = {
      ...DEFAULT_CONFIG,
      systemSegments: ["model", "branch", "cwd"],
    };
    const segs2 = buildSystemSegments(mockContext, mockFooterData, mockTheme, config2);
    assert.deepEqual(segs2.map((s) => s.name), ["model", "branch", "cwd"]);
  });

  it("extension items strictly follow config.extensionOrder if specified", () => {
    const registry = new StatusHubRegistry();
    const config: StatusHubConfig = {
      ...DEFAULT_CONFIG,
      extensionOrder: ["accounts", "sync", "subagents"], // Override default priority ordering
    };

    const resolved = registry.resolveAll(mockFooterData.getExtensionStatuses(), config);
    assert.deepEqual(resolved.map((r) => r.id), ["accounts", "sync", "subagents"]);
  });

  it("priorities sort extension items descending when extensionOrder is not set", () => {
    const registry = new StatusHubRegistry();
    const config: StatusHubConfig = {
      ...DEFAULT_CONFIG,
      priorities: {
        accounts: 100, // Make accounts highest
        sync: 95,
        subagents: 90,
      },
    };

    const resolved = registry.resolveAll(mockFooterData.getExtensionStatuses(), config);
    assert.deepEqual(resolved.map((r) => r.id), ["accounts", "sync", "subagents"]);
  });

  it("renders unified single line strictly following config.order from left to right", () => {
    const registry = new StatusHubRegistry();
    const config: StatusHubConfig = {
      ...DEFAULT_CONFIG,
      order: ["model", "subagents", "branch", "cwd"],
      systemSegments: ["model", "branch", "cwd"],
      extensionOrder: ["subagents"],
    };

    const resolved = registry.resolveAll(mockFooterData.getExtensionStatuses(), config);
    const sys = buildSystemSegments(mockContext, mockFooterData, mockTheme, config);
    const layout = renderFooterLayout(200, sys, resolved, config, mockTheme);

    assert.equal(layout.lines.length, 1);
    const line = layout.lines[0];
    assert(line);

    const modelIdx = line.indexOf("claude-3-7-sonnet");
    const subagentsIdx = line.indexOf("2 ▶");
    const branchIdx = line.indexOf("main");
    const cwdIdx = line.indexOf("~/project");

    assert(modelIdx !== -1, "model should be present");
    assert(subagentsIdx !== -1, "subagents should be present");
    assert(branchIdx !== -1, "branch should be present");
    assert(cwdIdx !== -1, "cwd should be present");

    // Top-to-bottom in order = Left-to-right on status line!
    assert(modelIdx < subagentsIdx, "model before subagents");
    assert(subagentsIdx < branchIdx, "subagents before branch");
    assert(branchIdx < cwdIdx, "branch before cwd");
  });
});
