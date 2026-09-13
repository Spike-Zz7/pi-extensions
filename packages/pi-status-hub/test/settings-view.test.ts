import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { createStatusHubSettingsComponent } from "../src/settings-view.js";
import { renderFooterLayout } from "../src/layout.js";
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

const mockTui = {
  requestRender: () => {},
} as unknown as TUI;

describe("settings-view and layout width constraints", () => {
  const sampleItems: ResolvedStatusItem[] = [
    {
      id: "multi-account-quota",
      rawText: "Antigravity spike.zhang.ai · gemini 45%/200k",
      displayText: "Antigravity spike.zhang.ai · gemini 45%/200k",
      icon: "🌐",
      priority: 95,
      color: "accent",
      source: "native",
      hidden: false,
      updatedAt: 1,
    },
    {
      id: "model-aware-autocompact",
      rawText: "compact 50%*/524k",
      displayText: "compact 50%*/524k",
      icon: "🗜️",
      priority: 85,
      color: "success",
      source: "native",
      hidden: false,
      updatedAt: 2,
    },
    {
      id: "subagents",
      rawText: "subagents: 2 running",
      displayText: "2 running",
      icon: "🤖",
      priority: 75,
      color: "muted",
      source: "native",
      hidden: false,
      updatedAt: 3,
    },
  ];

  it("never renders any line exceeding terminal width in settings view", () => {
    const component = createStatusHubSettingsComponent({
      tui: mockTui,
      theme: mockTheme,
      config: { ...DEFAULT_CONFIG },
      statusItems: sampleItems,
      onConfigChange: () => {},
      onClose: () => {},
    });

    // Test a wide variety of widths, especially around the crash width (87)
    const testWidths = [1, 10, 20, 30, 45, 60, 70, 80, 85, 87, 88, 90, 100, 120, 200];

    for (const width of testWidths) {
      const lines = component.render(width);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const w = visibleWidth(line);
        assert.ok(
          w <= width,
          `Line ${i} at width ${width} exceeded terminal width: visibleWidth=${w} > ${width}. Line: ${line}`
        );
      }
    }
  });

  it("handles width <= 0 gracefully in settings view", () => {
    const component = createStatusHubSettingsComponent({
      tui: mockTui,
      theme: mockTheme,
      config: { ...DEFAULT_CONFIG },
      statusItems: sampleItems,
      onConfigChange: () => {},
      onClose: () => {},
    });

    assert.deepEqual(component.render(0), []);
    assert.deepEqual(component.render(-10), []);
  });

  it("never renders any line exceeding terminal width in renderFooterLayout", () => {
    const sysSegments: SystemSegmentData[] = [
      {
        name: "cwd",
        text: "~/funnythings/pi_extensions/pi-status-hub",
        styledText: "📁 ~/funnythings/pi_extensions/pi-status-hub",
      },
      { name: "branch", text: "main", styledText: "🌿 main" },
      {
        name: "model",
        text: "gemini-3.8-flash • high",
        styledText: "🤖 gemini-3.8-flash • high",
      },
      {
        name: "context",
        text: "15% / 200k",
        styledText: "⚡ 15% / 200k",
      },
    ];

    for (let width = 1; width <= 150; width++) {
      const layout = renderFooterLayout(
        width,
        sysSegments,
        sampleItems,
        DEFAULT_CONFIG,
        mockTheme
      );
      for (let i = 0; i < layout.lines.length; i++) {
        const line = layout.lines[i]!;
        const w = visibleWidth(line);
        assert.ok(
          w <= width,
          `Footer line ${i} at width ${width} exceeded terminal width: visibleWidth=${w} > ${width}. Line: ${line}`
        );
      }
    }
  });
});
