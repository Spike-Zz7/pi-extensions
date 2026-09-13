import type { StatusHubConfig, ResolvedStatusItem, StatusHubItem } from "./types.js";
import {
  DEFAULT_FALLBACK_ICON,
  DEFAULT_FALLBACK_PRIORITY,
  WELL_KNOWN_ICONS,
  WELL_KNOWN_PRIORITIES,
} from "./config.js";
import { sanitizeStatus } from "./sanitize.js";

export class StatusHubRegistry {
  private structuredItems = new Map<string, StatusHubItem>();
  private onUpdateCallback?: (() => void) | undefined;

  constructor(onUpdate?: (() => void) | undefined) {
    this.onUpdateCallback = onUpdate;
  }

  setUpdateCallback(callback: (() => void) | undefined): void {
    this.onUpdateCallback = callback;
  }

  register(id: string, item: Omit<StatusHubItem, "id">): void {
    this.structuredItems.set(id, {
      id,
      label: item.label,
      icon: item.icon,
      priority: item.priority,
      color: item.color,
      hidden: item.hidden,
      updatedAt: Date.now(),
    });
    this.notifyUpdate();
  }

  update(id: string, patch: Partial<Omit<StatusHubItem, "id">>): void {
    const existing = this.structuredItems.get(id);
    if (!existing) {
      this.register(id, {
        label: patch.label ?? "",
        icon: patch.icon,
        priority: patch.priority,
        color: patch.color,
        hidden: patch.hidden,
      });
      return;
    }

    this.structuredItems.set(id, {
      ...existing,
      ...(patch.label !== undefined ? { label: patch.label } : {}),
      ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(patch.color !== undefined ? { color: patch.color } : {}),
      ...(patch.hidden !== undefined ? { hidden: patch.hidden } : {}),
      updatedAt: Date.now(),
    });
    this.notifyUpdate();
  }

  remove(id: string): void {
    if (this.structuredItems.delete(id)) {
      this.notifyUpdate();
    }
  }

  get(id: string): StatusHubItem | undefined {
    return this.structuredItems.get(id);
  }

  getAll(): StatusHubItem[] {
    return Array.from(this.structuredItems.values());
  }

  clear(): void {
    this.structuredItems.clear();
  }

  private notifyUpdate(): void {
    if (this.onUpdateCallback) {
      try {
        this.onUpdateCallback();
      } catch {
        // Ignore render request errors if session is tearing down
      }
    }
  }

  /**
   * Resolves and merges both native Pi statuses and structured Hub items.
   */
  resolveAll(
    nativeStatuses: ReadonlyMap<string, string>,
    config: StatusHubConfig
  ): ResolvedStatusItem[] {
    const result: ResolvedStatusItem[] = [];
    const handledIds = new Set<string>();

    // 1. Process structured Hub items (Track 2)
    for (const [id, item] of this.structuredItems.entries()) {
      handledIds.add(id);

      const isHidden = Boolean(item.hidden || config.hidden.includes(id));
      const icon =
        config.icons[id] ??
        item.icon ??
        WELL_KNOWN_ICONS[id] ??
        DEFAULT_FALLBACK_ICON;
      const priority =
        config.priorities[id] ??
        item.priority ??
        WELL_KNOWN_PRIORITIES[id] ??
        DEFAULT_FALLBACK_PRIORITY;

      const sanitized = sanitizeStatus(id, item.label);
      const displayText = sanitized.cleanText || item.label;
      const color = item.color ?? sanitized.inferredColor;

      result.push({
        id,
        rawText: item.label,
        displayText,
        icon,
        priority,
        color,
        source: "hub-api",
        hidden: isHidden,
        updatedAt: item.updatedAt ?? Date.now(),
      });
    }

    // 2. Process native statuses from getExtensionStatuses() (Track 1)
    for (const [key, rawText] of nativeStatuses.entries()) {
      // Avoid duplicate handling if already registered via structured API
      if (handledIds.has(key)) continue;
      // Skip statusline or hub self-keys
      if (key === "statusline" || key === "pi-status-hub") continue;
      if (!rawText || rawText.trim().length === 0) continue;

      const isHidden = config.hidden.includes(key);
      const sanitized = sanitizeStatus(key, rawText);

      // If text became completely empty after strip, skip unless it has an icon
      if (!sanitized.cleanText && !sanitized.extractedIcon) continue;

      const icon =
        config.icons[key] ??
        sanitized.extractedIcon ??
        WELL_KNOWN_ICONS[key] ??
        DEFAULT_FALLBACK_ICON;

      const priority =
        config.priorities[key] ??
        WELL_KNOWN_PRIORITIES[key] ??
        DEFAULT_FALLBACK_PRIORITY;

      result.push({
        id: key,
        rawText,
        displayText: sanitized.cleanText || "✓",
        icon,
        priority,
        color: sanitized.inferredColor,
        source: "native",
        hidden: isHidden,
        updatedAt: Date.now(),
      });
    }

    // Sort items:
    // 1. If explicitly listed in config.extensionOrder, follow that exact sequence
    // 2. Otherwise sort by priority descending (highest first); tiebreak by id
    const explicitOrder = config.extensionOrder ?? [];
    result.sort((a, b) => {
      const idxA = explicitOrder.indexOf(a.id);
      const idxB = explicitOrder.indexOf(b.id);

      if (idxA !== -1 && idxB !== -1) {
        return idxA - idxB;
      }
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;

      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      return a.id.localeCompare(b.id);
    });

    return result;
  }
}
