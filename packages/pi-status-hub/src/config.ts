import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { PartialStatusHubConfig, StatusHubConfig } from "./types.js";

export const DEFAULT_CONFIG: StatusHubConfig = {
  style: "minimal",
  adaptive: true,
  density: "compact",
  separator: "dot",
  showIcons: true,
  order: ["cwd", "branch", "model", "context", "cost"],
  systemSegments: ["cwd", "branch", "model", "context", "cost"],
  extensionOrder: [],
  hidden: [],
  iconOnly: [],
  textOnly: [],
  icons: {},
  priorities: {},
};

export const WELL_KNOWN_ICONS: Readonly<Record<string, string>> = {
  subagents: "🤖",
  "github-pr": "🐙",
  "git-pr": "🐙",
  sync: "🔄",
  pisync: "🔄",
  accounts: "👤",
  usage: "📊",
  "token-usage": "📊",
  lsp: "🔍",
  "plan-mode": "📋",
  caffeinate: "☕",
  "model-aware-autocompact": "🗜️",
  autocompact: "🗜️",
  retry: "🔁",
  "unknown-error-retry": "🔁",
  firecrawl: "🔥",
  "chrome-devtools": "🌐",
  terminal: "💻",
  "open-terminal": "💻",
  goal: "🎯",
  tools: "⚙️",
};

export const WELL_KNOWN_PRIORITIES: Readonly<Record<string, number>> = {
  subagents: 90,
  "github-pr": 85,
  "git-pr": 85,
  "plan-mode": 80,
  sync: 80,
  pisync: 80,
  accounts: 75,
  retry: 75,
  "unknown-error-retry": 75,
  usage: 70,
  "token-usage": 70,
  "model-aware-autocompact": 70,
  autocompact: 70,
  lsp: 65,
  caffeinate: 60,
  goal: 80,
};

export const DEFAULT_FALLBACK_ICON = "📦";
export const DEFAULT_FALLBACK_PRIORITY = 50;

export function loadConfig(cwd?: string): StatusHubConfig {
  let config: StatusHubConfig = { ...DEFAULT_CONFIG };

  // 1. Agent level config (~/.pi/agent/pi-status-hub.json)
  const agentDir = getAgentDir();
  const agentConfigFile = join(agentDir, "pi-status-hub.json");
  const agentConfig = tryReadConfigFile(agentConfigFile);
  if (agentConfig) {
    config = mergeConfig(config, agentConfig);
  }

  // 2. Project level config (.pi/pi-status-hub.json)
  if (cwd) {
    const projectConfigFile = join(cwd, ".pi", "pi-status-hub.json");
    const projectConfig = tryReadConfigFile(projectConfigFile);
    if (projectConfig) {
      config = mergeConfig(config, projectConfig);
    }
  }

  return config;
}

function tryReadConfigFile(filePath: string): PartialStatusHubConfig | null {
  try {
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as PartialStatusHubConfig;
  } catch {
    return null;
  }
}

export function saveConfig(config: StatusHubConfig): void {
  try {
    const agentDir = getAgentDir();
    const agentConfigFile = join(agentDir, "pi-status-hub.json");
    writeFileSync(agentConfigFile, JSON.stringify(config, null, 2), "utf-8");
  } catch {
    // Non-fatal if filesystem write fails
  }
}

export function mergeConfig(
  base: StatusHubConfig,
  overrides: PartialStatusHubConfig
): StatusHubConfig {
  return {
    style: overrides.style ?? base.style,
    adaptive: overrides.adaptive ?? base.adaptive,
    density: overrides.density ?? base.density,
    separator: overrides.separator ?? base.separator,
    showIcons: overrides.showIcons ?? base.showIcons,
    order: overrides.order ? [...overrides.order] : [...base.order],
    systemSegments: overrides.systemSegments ? [...overrides.systemSegments] : [...base.systemSegments],
    extensionOrder: overrides.extensionOrder ? [...overrides.extensionOrder] : [...base.extensionOrder],
    hidden: overrides.hidden ? [...overrides.hidden] : [...base.hidden],
    iconOnly: overrides.iconOnly ? [...overrides.iconOnly] : [...base.iconOnly],
    textOnly: overrides.textOnly ? [...overrides.textOnly] : [...base.textOnly],
    icons: { ...base.icons, ...(overrides.icons ?? {}) },
    priorities: { ...base.priorities, ...(overrides.priorities ?? {}) },
  };
}
