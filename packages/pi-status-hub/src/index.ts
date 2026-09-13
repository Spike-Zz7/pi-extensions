import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { loadConfig } from "./config.js";
import { renderFooterLayout } from "./layout.js";
import { createStatusHubSettingsComponent } from "./settings-view.js";
import { StatusHubRegistry } from "./registry.js";
import { buildSystemSegments } from "./system-info.js";
import type { ResolvedStatusItem, StatusHubConfig, StatusHubGlobal } from "./types.js";

export default function statusHubExtension(pi: ExtensionAPI): void {
  const registry = new StatusHubRegistry();
  let latestResolvedItems: ResolvedStatusItem[] = [];
  let currentThinkingLevel: string | undefined = "off";
  let activeConfig: StatusHubConfig | undefined;
  let activeRequestRender: (() => void) | undefined;
  let conflictWarned = false;

  // Mount global contract for cooperating extensions
  const globalHub: StatusHubGlobal = {
    register(id, item) {
      registry.register(id, item);
      activeRequestRender?.();
    },
    update(id, patch) {
      registry.update(id, patch);
      activeRequestRender?.();
    },
    remove(id) {
      registry.remove(id);
      activeRequestRender?.();
    },
    get(id) {
      return registry.get(id);
    },
    getAll() {
      return registry.getAll();
    },
    triggerRender() {
      activeRequestRender?.();
    },
  };
  globalThis.__PI_STATUS_HUB__ = globalHub;

  // Detect conflicting footer extensions (e.g. @narumitw/pi-statusline)
  function checkFooterConflicts(ctx: ExtensionContext): void {
    if (conflictWarned) return;
    try {
      const agentDir = getAgentDir();
      const settingsPath = join(agentDir, "settings.json");
      if (existsSync(settingsPath)) {
        const raw = readFileSync(settingsPath, "utf-8");
        if (raw.includes("pi-statusline")) {
          conflictWarned = true;
          ctx.ui.notify(
            "pi-status-hub has taken over footer management. Please consider removing pi-statusline from settings.json to avoid conflicts.",
            "warning"
          );
        }
      }
    } catch {
      // Passive check
    }
  }

  function installFooter(ctx: ExtensionContext): void {
    const config = loadConfig(ctx.cwd);
    activeConfig = config;

    ctx.ui.setFooter((tui, theme, footerData) => {
      activeRequestRender = () => tui.requestRender();
      registry.setUpdateCallback(() => tui.requestRender());

      const branchUnsub = footerData.onBranchChange(() => {
        tui.requestRender();
      });

      return {
        dispose() {
          branchUnsub();
          registry.setUpdateCallback(undefined);
          if (activeRequestRender === tui.requestRender) {
            activeRequestRender = undefined;
          }
        },
        invalidate() {},
        render(width: number): string[] {
          if (width <= 0) return [];
          const sysSegments = buildSystemSegments(
            ctx,
            footerData,
            theme,
            config,
            currentThinkingLevel
          );

          const resolved = registry.resolveAll(footerData.getExtensionStatuses(), config);
          latestResolvedItems = resolved;

          const layout = renderFooterLayout(width, sysSegments, resolved, config, theme);
          return layout.lines.map((line) => truncateToWidth(line, width));
        },
      };
    });
  }

  // Register /shub command (SettingsList interactive toggle)
  pi.registerCommand("shub", {
    description: "Choose which statuses appear in the footer and customize Status Hub",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/shub is only available in interactive mode", "warning");
        return;
      }

      const config = activeConfig ?? loadConfig(ctx.cwd);
      await ctx.ui.custom((tui, theme, _kb, done) => {
        return createStatusHubSettingsComponent({
          tui,
          theme,
          config,
          statusItems: latestResolvedItems,
          onConfigChange: (updatedConfig) => {
            activeConfig = updatedConfig;
            activeRequestRender?.();
          },
          onClose: () => {
            done(undefined);
            ctx.ui.notify("Status Hub configuration saved", "info");
          },
        });
      });
    },
  });

  // Session lifecycle events
  pi.on("session_start", (_event, ctx) => {
    checkFooterConflicts(ctx);
    currentThinkingLevel = pi.getThinkingLevel?.() ?? "off";
    installFooter(ctx);
  });

  pi.on("session_tree", (_event, ctx) => {
    installFooter(ctx);
    activeRequestRender?.();
  });

  pi.on("session_shutdown", () => {
    registry.clear();
    activeRequestRender = undefined;
    if (globalThis.__PI_STATUS_HUB__ === globalHub) {
      globalThis.__PI_STATUS_HUB__ = undefined;
    }
  });

  pi.on("model_select", () => {
    activeRequestRender?.();
  });

  pi.on("thinking_level_select", (event) => {
    currentThinkingLevel = event.level;
    activeRequestRender?.();
  });

  pi.on("agent_start", () => {
    activeRequestRender?.();
  });

  pi.on("agent_settled", () => {
    activeRequestRender?.();
  });

  pi.on("turn_start", () => {
    activeRequestRender?.();
  });

  pi.on("turn_end", () => {
    activeRequestRender?.();
  });
}

export * from "./types.js";
export * from "./config.js";
export * from "./registry.js";
export * from "./sanitize.js";
export * from "./layout.js";
export * from "./styles.js";
export * from "./settings-view.js";
