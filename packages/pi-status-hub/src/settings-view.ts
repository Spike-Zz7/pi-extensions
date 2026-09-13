import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  type TUI,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { saveConfig } from "./config.js";
import { SYSTEM_ICONS } from "./system-info.js";
import type {
  ItemDisplayMode,
  ResolvedStatusItem,
  StatusHubConfig,
  SystemSegmentName,
} from "./types.js";

const ALL_SYSTEM_SEGMENTS: readonly SystemSegmentName[] = [
  "cwd",
  "branch",
  "model",
  "thinking",
  "context",
  "tokens",
  "cost",
  "time",
];

const DISPLAY_MODE_CYCLE: readonly ItemDisplayMode[] = [
  "full",
  "icon-only",
  "text-only",
  "hidden",
];

export interface UnifiedOrderItem {
  id: string;
  name: string;
  kind: "system" | "extension";
  icon: string;
  displayText: string;
  mode: ItemDisplayMode;
}

export interface StatusHubSettingsViewOptions {
  tui: TUI;
  theme: Theme;
  config: StatusHubConfig;
  statusItems: ResolvedStatusItem[];
  onConfigChange: (updatedConfig: StatusHubConfig) => void;
  onClose: () => void;
}

export function createStatusHubSettingsComponent(
  options: StatusHubSettingsViewOptions
): Component {
  const { tui, theme, config, statusItems, onConfigChange, onClose } = options;

  // Build unified item list combining system segments and active extension items
  function buildUnifiedItems(): UnifiedOrderItem[] {
    const map = new Map<string, UnifiedOrderItem>();

    // 1. System segments
    for (const seg of ALL_SYSTEM_SEGMENTS) {
      let mode: ItemDisplayMode = "full";
      if (!config.systemSegments.includes(seg)) {
        mode = "hidden";
      } else if (config.iconOnly.includes(seg)) {
        mode = "icon-only";
      } else if (config.textOnly.includes(seg)) {
        mode = "text-only";
      }

      const icon = config.icons[seg] ?? SYSTEM_ICONS[seg] ?? "⚙️";
      map.set(seg, {
        id: seg,
        name: `[Sys] ${seg}`,
        kind: "system",
        icon,
        displayText: getSystemSegmentSample(seg),
        mode,
      });
    }

    // 2. Extension items
    for (const ext of statusItems) {
      let mode: ItemDisplayMode = "full";
      if (config.hidden.includes(ext.id)) {
        mode = "hidden";
      } else if (config.iconOnly.includes(ext.id)) {
        mode = "icon-only";
      } else if (config.textOnly.includes(ext.id)) {
        mode = "text-only";
      }

      map.set(ext.id, {
        id: ext.id,
        name: `[Ext] ${ext.id}`,
        kind: "extension",
        icon: ext.icon,
        displayText: ext.displayText,
        mode,
      });
    }

    // Determine ordering
    const order = config.order && config.order.length > 0
      ? config.order
      : [...config.systemSegments, ...statusItems.map((i) => i.id)];

    const orderedList: UnifiedOrderItem[] = [];
    const seen = new Set<string>();

    for (const id of order) {
      const item = map.get(id);
      if (item) {
        orderedList.push(item);
        seen.add(id);
      }
    }

    // Append any unlisted items
    for (const [id, item] of map.entries()) {
      if (!seen.has(id)) {
        orderedList.push(item);
      }
    }

    return orderedList;
  }

  let items = buildUnifiedItems();
  let selectedIndex = 0;

  function syncConfigFromItems(): void {
    // Top-to-bottom in items = Left-to-right on status line
    config.order = items.map((i) => i.id);

    // Sync systemSegments
    config.systemSegments = items
      .filter((i) => i.kind === "system" && i.mode !== "hidden")
      .map((i) => i.id as SystemSegmentName);

    // Sync extensionOrder
    config.extensionOrder = items
      .filter((i) => i.kind === "extension" && i.mode !== "hidden")
      .map((i) => i.id);

    // Sync hidden
    config.hidden = items.filter((i) => i.mode === "hidden").map((i) => i.id);

    // Sync iconOnly
    config.iconOnly = items.filter((i) => i.mode === "icon-only").map((i) => i.id);

    // Sync textOnly
    config.textOnly = items.filter((i) => i.mode === "text-only").map((i) => i.id);

    saveConfig(config);
    onConfigChange(config);
    tui.requestRender();
  }

  function moveItem(fromIdx: number, toIdx: number): void {
    if (fromIdx < 0 || fromIdx >= items.length || toIdx < 0 || toIdx >= items.length) {
      return;
    }
    const item = items[fromIdx];
    if (!item) return;

    items.splice(fromIdx, 1);
    items.splice(toIdx, 0, item);
    selectedIndex = toIdx;
    syncConfigFromItems();
  }

  function cycleItemMode(idx: number): void {
    const item = items[idx];
    if (!item) return;

    const currentModeIdx = DISPLAY_MODE_CYCLE.indexOf(item.mode);
    const nextMode = DISPLAY_MODE_CYCLE[(currentModeIdx + 1) % DISPLAY_MODE_CYCLE.length] ?? "full";
    item.mode = nextMode;
    syncConfigFromItems();
  }

  function getSystemSegmentSample(name: SystemSegmentName): string {
    switch (name) {
      case "cwd":
        return "~/project";
      case "branch":
        return "main";
      case "model":
        return "claude-3-7-sonnet";
      case "context":
        return "15% / 200k";
      case "thinking":
        return "high";
      case "tokens":
        return "↑2.4k ↓1.1k";
      case "cost":
        return "$0.045";
      case "time":
        return "12:00";
    }
  }

  return {
    render(width: number): string[] {
      if (width <= 0) return [];

      const lines: string[] = [];

      // Header
      const headerTitle =
        width < 55
          ? "⚡ Status Hub · Reorder Statusline"
          : "⚡ Status Hub · Reorder Statusline (从上到下 ➔ 从左到右)";
      const title = theme.bold(theme.fg("accent", headerTitle));
      lines.push(title);

      const subtitle =
        width < 65
          ? "Top items = LEFT, bottom items = RIGHT"
          : "Top items appear on the LEFT, bottom items appear on the RIGHT:";
      lines.push(theme.fg("dim", subtitle));
      lines.push(theme.fg("dim", "─".repeat(Math.max(0, Math.min(width, 76)))));

      // Viewport calculation for scrolling
      const maxVisible = Math.max(6, Math.min(items.length, 12));
      const scrollTop = Math.max(
        0,
        Math.min(selectedIndex - Math.floor(maxVisible / 2), items.length - maxVisible)
      );
      const visibleItems = items.slice(scrollTop, scrollTop + maxVisible);

      if (scrollTop > 0) {
        lines.push(theme.fg("dim", `  ▲ (${scrollTop} more items above)`));
      }

      for (let i = 0; i < visibleItems.length; i++) {
        const item = visibleItems[i];
        if (!item) continue;

        const actualIdx = scrollTop + i;
        const isSelected = actualIdx === selectedIndex;

        // Cursor & Position
        const cursor = isSelected ? theme.bold(theme.fg("accent", "▸")) : " ";
        const num = theme.fg("dim", `${String(actualIdx + 1).padStart(2, " ")}.`);

        // Icon + Label
        const iconPart = config.showIcons ? item.icon : " ";
        const labelText = `${iconPart} ${item.id}`.padEnd(18, " ");
        const styledLabel = isSelected
          ? theme.bold(theme.fg("accent", labelText))
          : theme.fg("text", labelText);

        // Mode badge
        let modeColor: "success" | "accent" | "warning" | "dim" = "dim";
        if (item.mode === "full") modeColor = "success";
        else if (item.mode === "icon-only") modeColor = "accent";
        else if (item.mode === "text-only") modeColor = "warning";
        else if (item.mode === "hidden") modeColor = "dim";

        const modeBadge = theme.fg(modeColor, `[${item.mode.padEnd(9, " ")}]`);

        // Sample text
        const sample = theme.fg("dim", item.displayText);

        const line = `${cursor} ${num} ${styledLabel}  ${modeBadge}  ${sample}`;
        lines.push(truncateToWidth(line, width, "..."));
      }

      if (scrollTop + maxVisible < items.length) {
        const remaining = items.length - (scrollTop + maxVisible);
        lines.push(theme.fg("dim", `  ▼ (${remaining} more items below)`));
      }

      // Footer controls & keybinding instructions
      lines.push(theme.fg("dim", "─".repeat(Math.max(0, Math.min(width, 76)))));
      if (width < 60) {
        lines.push(
          `${theme.bold("↑/↓")} Sel • ${theme.bold(
            theme.fg("accent", "K/J")
          )} Move • ${theme.bold(theme.fg("accent", "Space"))} Mode • ${theme.bold(
            "Esc"
          )} Close`
        );
      } else if (width < 75) {
        lines.push(
          `${theme.bold("↑/↓")} Select  •  ${theme.bold(
            theme.fg("accent", "K/J")
          )} Move  •  ${theme.bold(
            theme.fg("accent", "Space")
          )} Mode  •  ${theme.bold("Esc")} Close`
        );
        lines.push(
          `${theme.bold(theme.fg("accent", "i"))} Icons  •  ${theme.bold(
            theme.fg("accent", "s")
          )} Style  •  ${theme.bold("Esc/q")} Save`
        );
      } else {
        lines.push(
          `${theme.bold("↑/↓")} Select  •  ${theme.bold(
            theme.fg("accent", "Shift+↑/↓")
          )} Move  •  ${theme.bold(
            theme.fg("accent", "Space")
          )} Mode  •  ${theme.bold("Esc/q")} Save & Close`
        );
        lines.push(
          `${theme.bold(theme.fg("accent", "K/J"))} Move  •  ${theme.bold(
            theme.fg("accent", "i")
          )} Icons  •  ${theme.bold(
            theme.fg("accent", "s")
          )} Style  •  ${theme.fg("dim", "Modes: full → icon → text → hidden")}`
        );
      }

      return lines.map((line) => truncateToWidth(line, width));
    },

    invalidate(): void {},

    handleInput(data: string): void {
      // 1. Move Item Up: Shift+Up, Alt+Up, K, u, [, -
      if (
        data === "\x1b[1;2A" ||
        data === "\x1b[1;3A" ||
        data === "\x1b\x1b[A" ||
        data === "K" ||
        data === "u" ||
        data === "[" ||
        data === "-"
      ) {
        if (selectedIndex > 0) {
          moveItem(selectedIndex, selectedIndex - 1);
        }
      }
      // 2. Move Item Down: Shift+Down, Alt+Down, J, d, ], +
      else if (
        data === "\x1b[1;2B" ||
        data === "\x1b[1;3B" ||
        data === "\x1b\x1b[B" ||
        data === "J" ||
        data === "d" ||
        data === "]" ||
        data === "+"
      ) {
        if (selectedIndex < items.length - 1) {
          moveItem(selectedIndex, selectedIndex + 1);
        }
      }
      // 3. Selection Cursor Up: Up arrow, k
      else if (data === "\x1b[A" || data === "\x1bOA" || data === "k") {
        selectedIndex = selectedIndex > 0 ? selectedIndex - 1 : items.length - 1;
        tui.requestRender();
      }
      // 4. Selection Cursor Down: Down arrow, j
      else if (data === "\x1b[B" || data === "\x1bOB" || data === "j") {
        selectedIndex = selectedIndex < items.length - 1 ? selectedIndex + 1 : 0;
        tui.requestRender();
      }
      // 5. Toggle Mode: Space, Enter, t
      else if (data === " " || data === "\r" || data === "\n" || data === "t") {
        cycleItemMode(selectedIndex);
      }
      // 6. Toggle Global Icons: i
      else if (data === "i") {
        config.showIcons = !config.showIcons;
        syncConfigFromItems();
      }
      // 7. Toggle Style: s
      else if (data === "s") {
        config.style = config.style === "minimal" ? "powerline" : "minimal";
        syncConfigFromItems();
      }
      // 8. Exit: Esc, q, Ctrl+C
      else if (data === "\x1b" || data === "q" || data === "\x03") {
        onClose();
      }
    },
  };
}
