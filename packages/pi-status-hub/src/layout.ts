import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";
import { getSeparatorText, renderBadge } from "./styles.js";
import type {
  ResolvedStatusItem,
  StatusHubConfig,
  ItemDisplayState,
} from "./types.js";
import type { SystemSegmentData } from "./system-info.js";

export interface RenderedBadgesResult {
  line: string;
  items: ResolvedStatusItem[];
}

/**
 * Renders extension items using the 3-stage degradation algorithm.
 */
export function renderExtensionBadges(
  items: ResolvedStatusItem[],
  availableWidth: number,
  config: StatusHubConfig,
  theme: Theme
): RenderedBadgesResult {
  // Filter out hidden items first
  const activeItems = items.filter((it) => !it.hidden);
  if (activeItems.length === 0 || availableWidth <= 0) {
    return { line: "", items };
  }

  // Clone items to track displayState
  const workingItems = activeItems.map((it) => ({
    ...it,
    displayState: (config.iconOnly.includes(it.id) ? "icon-only" : "full") as ItemDisplayState,
  }));

  const separator = "  ";
  const sepWidth = visibleWidth(separator);

  // Helper to calculate total line width and render line given current states
  const formatBadges = (
    list: typeof workingItems,
    overflowCount: number
  ): { rendered: string; width: number } => {
    const parts: string[] = [];
    for (const item of list) {
      const showIcon = config.showIcons && !config.textOnly.includes(item.id);
      const isIconOnly = item.displayState === "icon-only" || config.iconOnly.includes(item.id);

      if (isIconOnly) {
        if (showIcon) {
          parts.push(renderBadge(item.icon, undefined, item.color, config.style, theme));
        }
      } else {
        if (showIcon) {
          parts.push(renderBadge(item.icon, item.displayText, item.color, config.style, theme));
        } else {
          parts.push(theme.fg(item.color, item.displayText));
        }
      }
    }

    if (overflowCount > 0) {
      const overflowBadge = theme.fg("dim", `+${overflowCount}`);
      parts.push(overflowBadge);
    }

    const rendered = parts.join(separator);
    return { rendered, width: visibleWidth(rendered) };
  };

  // --- STAGE 1: Full Display ---
  const stage1 = formatBadges(workingItems, 0);
  if (stage1.width <= availableWidth) {
    // Fits completely!
    syncDisplayStates(items, workingItems, new Set());
    return { line: stage1.rendered, items };
  }

  // --- STAGE 2: Drop Text of Lower-Priority Items (Ascending Priority) ---
  // Sort working indices by priority ascending (lowest first)
  const indicesByPriorityAsc = workingItems
    .map((_, idx) => idx)
    .sort((a, b) => (workingItems[a]?.priority ?? 0) - (workingItems[b]?.priority ?? 0));

  for (const idx of indicesByPriorityAsc) {
    const item = workingItems[idx];
    if (item) {
      item.displayState = "icon-only";
      const check = formatBadges(workingItems, 0);
      if (check.width <= availableWidth) {
        syncDisplayStates(items, workingItems, new Set());
        return { line: check.rendered, items };
      }
    }
  }

  // --- STAGE 3: Overflow to +N Badge ---
  // At this point, all items are already 'icon-only' and still exceed availableWidth.
  // We hide lowest-priority items one by one and add +N badge.
  const overflowedIds = new Set<string>();

  for (let i = 0; i < indicesByPriorityAsc.length; i++) {
    const idxToHide = indicesByPriorityAsc[i];
    if (idxToHide !== undefined) {
      const itemToHide = workingItems[idxToHide];
      if (itemToHide) {
        itemToHide.displayState = "overflow";
        overflowedIds.add(itemToHide.id);

        const remainingVisible = workingItems.filter((it) => it.displayState === "icon-only");
        const check = formatBadges(remainingVisible, overflowedIds.size);

        if (check.width <= availableWidth) {
          syncDisplayStates(items, workingItems, overflowedIds);
          return { line: check.rendered, items };
        }
        if (remainingVisible.length === 0) {
          syncDisplayStates(items, workingItems, overflowedIds);
          return {
            line: truncateToWidth(check.rendered, availableWidth, "..."),
            items,
          };
        }
      }
    }
  }

  // Extreme narrow terminal fallback: show "+N" or truncate
  const finalCheck = formatBadges([], workingItems.length);
  syncDisplayStates(items, workingItems, new Set(workingItems.map((i) => i.id)));
  return {
    line: truncateToWidth(finalCheck.rendered, availableWidth, "..."),
    items,
  };
}

function syncDisplayStates(
  originalItems: ResolvedStatusItem[],
  workingItems: Array<ResolvedStatusItem & { displayState: ItemDisplayState }>,
  overflowedIds: Set<string>
): void {
  const stateMap = new Map(workingItems.map((w) => [w.id, w.displayState]));

  for (const item of originalItems) {
    if (item.hidden) {
      item.displayState = "hidden";
    } else if (overflowedIds.has(item.id)) {
      item.displayState = "overflow";
    } else {
      item.displayState = stateMap.get(item.id) ?? "full";
    }
  }
}

/**
 * Formats the system segments into a styled line.
 */
export function formatSystemLine(
  segments: SystemSegmentData[],
  config: StatusHubConfig,
  theme: Theme
): string {
  if (segments.length === 0) return "";
  const sep = getSeparatorText(config.separator, config.style, theme);
  return segments.map((s) => s.styledText).join(sep);
}

/**
 * Full layout engine producing the rendered footer lines.
 */
export function renderFooterLayout(
  width: number,
  systemSegments: SystemSegmentData[],
  statusItems: ResolvedStatusItem[],
  config: StatusHubConfig,
  theme: Theme
): { lines: string[]; resolvedItems: ResolvedStatusItem[] } {
  if (width <= 0) return { lines: [], resolvedItems: statusItems };

  const safeLines = (lines: string[]): string[] =>
    lines.map((l) => truncateToWidth(l, width, theme.fg("dim", "...")));

  const systemLine = formatSystemLine(systemSegments, config, theme);
  const sysWidth = visibleWidth(systemLine);

  // Measure extension badges line
  const badgesResult = renderExtensionBadges(statusItems, width, config, theme);
  const extLine = badgesResult.line;
  const extWidth = visibleWidth(extLine);

  // If there are no extension badges, only system line is shown
  if (!extLine) {
    return {
      lines: safeLines([systemLine]),
      resolvedItems: badgesResult.items,
    };
  }

  // If unified order is specified and adaptive is true, try to render unified 1-line
  if (config.adaptive && config.order && config.order.length > 0) {
    const sysMap = new Map(systemSegments.map((s) => [s.name as string, s.styledText]));
    const extMap = new Map<string, string>();

    for (const item of badgesResult.items) {
      if (item.hidden) continue;
      const showIcon = config.showIcons && !config.textOnly.includes(item.id);
      const isIconOnly = item.displayState === "icon-only" || config.iconOnly.includes(item.id);

      if (isIconOnly) {
        if (showIcon) {
          extMap.set(item.id, renderBadge(item.icon, undefined, item.color, config.style, theme));
        }
      } else {
        if (showIcon) {
          extMap.set(item.id, renderBadge(item.icon, item.displayText, item.color, config.style, theme));
        } else {
          extMap.set(item.id, theme.fg(item.color, item.displayText));
        }
      }
    }

    const unifiedParts: string[] = [];
    const addedIds = new Set<string>();

    for (const id of config.order) {
      const rendered = sysMap.get(id) ?? extMap.get(id);
      if (rendered) {
        unifiedParts.push(rendered);
        addedIds.add(id);
      }
    }

    // Append unlisted active items
    for (const [name, rendered] of sysMap) {
      if (!addedIds.has(name)) {
        unifiedParts.push(rendered);
        addedIds.add(name);
      }
    }
    for (const [id, rendered] of extMap) {
      if (!addedIds.has(id)) {
        unifiedParts.push(rendered);
        addedIds.add(id);
      }
    }

    const sep = getSeparatorText(config.separator, config.style, theme);
    const unifiedLine = unifiedParts.join(sep);
    if (visibleWidth(unifiedLine) <= width) {
      return {
        lines: safeLines([unifiedLine]),
        resolvedItems: badgesResult.items,
      };
    }
  }

  // Check adaptive merge: can system segments and extension badges sit on ONE line?
  if (config.adaptive) {
    const gap = 2;
    if (sysWidth + gap + extWidth <= width) {
      // Merge into 1 line: Left sysLine, Right extLine
      const padding = " ".repeat(Math.max(gap, width - sysWidth - extWidth));
      return {
        lines: safeLines([systemLine + padding + extLine]),
        resolvedItems: badgesResult.items,
      };
    }
  }

  // 2 Lines Mode (Split state)
  // Line 1: System info (truncated if terminal is narrower than sysWidth)
  // Line 2: Extension badges (rendered to full `width`)
  return {
    lines: safeLines([systemLine, extLine]),
    resolvedItems: badgesResult.items,
  };
}
