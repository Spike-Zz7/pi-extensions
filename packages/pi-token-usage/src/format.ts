import type { TimeWindow } from "./types.js";

const WINDOW_LABELS: Record<TimeWindow, string> = {
  today: "Today",
  "7": "Last 7 Days",
  "30": "Last 30 Days",
  all: "All Time",
};

export function formatTokens(value: number): string {
  const absolute = Math.abs(value);
  const units = [
    { threshold: 1_000_000_000, suffix: "B" },
    { threshold: 1_000_000, suffix: "M" },
    { threshold: 1_000, suffix: "K" },
  ] as const;
  for (const unit of units) {
    if (absolute >= unit.threshold) {
      return `${(value / unit.threshold).toFixed(1).replace(/\.0$/, "")}${unit.suffix}`;
    }
  }
  return Math.round(value).toString();
}

export function formatCost(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function formatWindow(window: TimeWindow): string {
  return WINDOW_LABELS[window];
}
