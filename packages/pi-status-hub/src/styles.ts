import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import type { SegmentSeparator, VisualStyle } from "./types.js";

export function getSeparatorText(separator: SegmentSeparator, style: VisualStyle, theme: Theme): string {
  if (style === "powerline") {
    return " ";
  }

  switch (separator) {
    case "dot":
      return theme.fg("dim", " • ");
    case "bar":
      return theme.fg("dim", " │ ");
    case "none":
    default:
      return "  ";
  }
}

export function renderBadge(
  icon: string,
  text: string | undefined,
  color: ThemeColor,
  style: VisualStyle,
  theme: Theme
): string {
  if (style === "powerline") {
    const content = text ? `${icon} ${text}` : icon;
    // Powerline capsule style: CONTENT
    const leftCap = theme.fg(color, "");
    const rightCap = theme.fg(color, "");
    return `${leftCap}${theme.fg(color, content)}${rightCap}`;
  }

  // Modern Minimalist style
  const iconPart = theme.fg(color, icon);
  if (!text) {
    return iconPart;
  }
  return `${iconPart} ${theme.fg(color, text)}`;
}
