import type { ExtensionContext, ReadonlyFooterDataProvider, Theme } from "@earendil-works/pi-coding-agent";
import type { StatusHubConfig, SystemSegmentName } from "./types.js";

export interface SystemSegmentData {
  name: SystemSegmentName;
  text: string;
  styledText: string;
}

export const SYSTEM_ICONS: Readonly<Record<SystemSegmentName, string>> = {
  cwd: "📁",
  branch: "🌱",
  model: "🧠",
  thinking: "💭",
  context: "⚡",
  tokens: "📊",
  cost: "💰",
  time: "🕒",
};

export function formatTokens(count: number): string {
  if (count < 1000) return `${count}`;
  if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

export function formatPath(cwd: string, home?: string): string {
  if (!home) return cwd;
  if (cwd === home) return "~";
  if (cwd.startsWith(home + "/")) {
    return "~" + cwd.slice(home.length);
  }
  return cwd;
}

export function formatTime(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatSegmentDisplay(
  name: SystemSegmentName,
  rawText: string,
  config: StatusHubConfig,
  theme: Theme,
  color: "accent" | "success" | "warning" | "error" | "dim"
): { text: string; styledText: string } {
  const icon = config.icons[name] ?? SYSTEM_ICONS[name] ?? "";
  const showIcon = config.showIcons && !config.textOnly.includes(name) && Boolean(icon);
  const isIconOnly = config.iconOnly.includes(name);

  if (isIconOnly && showIcon) {
    return {
      text: icon,
      styledText: theme.fg(color, icon),
    };
  }

  if (showIcon) {
    return {
      text: `${icon} ${rawText}`,
      styledText: theme.fg(color, `${icon} ${rawText}`),
    };
  }

  return {
    text: rawText,
    styledText: theme.fg(color, rawText),
  };
}

export function buildSystemSegments(
  ctx: ExtensionContext,
  footerData: ReadonlyFooterDataProvider,
  theme: Theme,
  config: StatusHubConfig,
  thinkingLevel?: string
): SystemSegmentData[] {
  const segments: SystemSegmentData[] = [];

  // Compute token stats & cost from session entries
  let input = 0;
  let output = 0;
  let cost = 0;

  try {
    for (const e of ctx.sessionManager.getBranch()) {
      if (e.type === "message" && e.message.role === "assistant") {
        const usage = (e.message as { usage?: { input?: number; output?: number; cost?: { total?: number } } }).usage;
        if (usage) {
          input += usage.input ?? 0;
          output += usage.output ?? 0;
          cost += usage.cost?.total ?? 0;
        }
      }
    }
  } catch {
    // Branch entries might not be ready during early init
  }

  const contextUsage = ctx.getContextUsage();
  const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
  const percentValue = contextUsage?.percent ?? null;

  for (const name of config.systemSegments) {
    switch (name) {
      case "cwd": {
        const path = formatPath(ctx.cwd, process.env.HOME || process.env.USERPROFILE);
        const { text, styledText } = formatSegmentDisplay(name, path, config, theme, "accent");
        segments.push({ name, text, styledText });
        break;
      }
      case "branch": {
        const branch = footerData.getGitBranch();
        if (branch) {
          const { text, styledText } = formatSegmentDisplay(name, branch, config, theme, "success");
          segments.push({ name, text, styledText });
        }
        break;
      }
      case "model": {
        const modelId = ctx.model?.id || "no-model";
        const think = thinkingLevel && thinkingLevel !== "off" ? ` • ${thinkingLevel}` : "";
        const raw = `${modelId}${think}`;
        const { text, styledText } = formatSegmentDisplay(name, raw, config, theme, "accent");
        segments.push({ name, text, styledText });
        break;
      }
      case "thinking": {
        if (thinkingLevel && thinkingLevel !== "off") {
          const raw = thinkingLevel;
          const { text, styledText } = formatSegmentDisplay(name, raw, config, theme, "dim");
          segments.push({ name, text, styledText });
        }
        break;
      }
      case "context": {
        if (contextWindow > 0) {
          const percentDisplay = percentValue !== null ? `${percentValue.toFixed(1)}%` : "?";
          const raw = `${percentDisplay}/${formatTokens(contextWindow)}`;
          let color: "error" | "warning" | "dim" = "dim";
          if (percentValue !== null) {
            if (percentValue >= 90) color = "error";
            else if (percentValue >= 70) color = "warning";
          }
          const { text, styledText } = formatSegmentDisplay(name, raw, config, theme, color);
          segments.push({ name, text, styledText });
        }
        break;
      }
      case "tokens": {
        if (input > 0 || output > 0) {
          const raw = `↑${formatTokens(input)} ↓${formatTokens(output)}`;
          const { text, styledText } = formatSegmentDisplay(name, raw, config, theme, "dim");
          segments.push({ name, text, styledText });
        }
        break;
      }
      case "cost": {
        if (cost > 0) {
          const raw = `$${cost.toFixed(3)}`;
          const { text, styledText } = formatSegmentDisplay(name, raw, config, theme, "dim");
          segments.push({ name, text, styledText });
        }
        break;
      }
      case "time": {
        const t = formatTime();
        const { text, styledText } = formatSegmentDisplay(name, t, config, theme, "dim");
        segments.push({ name, text, styledText });
        break;
      }
    }
  }

  return segments;
}
