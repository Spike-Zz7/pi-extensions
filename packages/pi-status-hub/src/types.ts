import type { ThemeColor } from "@earendil-works/pi-coding-agent";

export type SystemSegmentName =
  | "cwd"
  | "branch"
  | "model"
  | "thinking"
  | "context"
  | "tokens"
  | "cost"
  | "time";

export type VisualStyle = "minimal" | "powerline";
export type SegmentSeparator = "dot" | "bar" | "none";
export type DisplayDensity = "compact" | "cozy";

export type ItemDisplayMode = "full" | "icon-only" | "text-only" | "hidden";

export interface StatusHubConfig {
  style: VisualStyle;
  adaptive: boolean;
  density: DisplayDensity;
  separator: SegmentSeparator;
  showIcons: boolean;
  order: string[];
  systemSegments: SystemSegmentName[];
  extensionOrder: string[];
  hidden: string[];
  iconOnly: string[];
  textOnly: string[];
  icons: Record<string, string>;
  priorities: Record<string, number>;
}

export type PartialStatusHubConfig = {
  style?: VisualStyle | undefined;
  adaptive?: boolean | undefined;
  density?: DisplayDensity | undefined;
  separator?: SegmentSeparator | undefined;
  showIcons?: boolean | undefined;
  order?: string[] | undefined;
  systemSegments?: SystemSegmentName[] | undefined;
  extensionOrder?: string[] | undefined;
  hidden?: string[] | undefined;
  iconOnly?: string[] | undefined;
  textOnly?: string[] | undefined;
  icons?: Record<string, string> | undefined;
  priorities?: Record<string, number> | undefined;
};

export interface StatusHubItem {
  id: string;
  label: string;
  icon?: string | undefined;
  priority?: number | undefined; // 0 - 100, default 50
  color?: ThemeColor | undefined;
  hidden?: boolean | undefined;
  updatedAt?: number | undefined;
}

export type StatusSource = "native" | "hub-api";

export type ItemDisplayState = "full" | "icon-only" | "overflow" | "hidden";

export interface ResolvedStatusItem {
  id: string;
  rawText: string;
  displayText: string;
  icon: string;
  priority: number;
  color: ThemeColor;
  source: StatusSource;
  hidden: boolean;
  updatedAt: number;
  displayState?: ItemDisplayState | undefined;
}

export interface StatusHubGlobal {
  register(id: string, item: Omit<StatusHubItem, "id">): void;
  update(id: string, patch: Partial<Omit<StatusHubItem, "id">>): void;
  remove(id: string): void;
  get(id: string): StatusHubItem | undefined;
  getAll(): StatusHubItem[];
  triggerRender(): void;
}

declare global {
  // eslint-disable-next-line no-var
  var __PI_STATUS_HUB__: StatusHubGlobal | undefined;
}
