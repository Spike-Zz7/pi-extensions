import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";

const EMOJI_LEADING_REGEX =
  /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\uFE0F?\u20E3)+/u;

export interface SanitizedStatus {
  extractedIcon?: string | undefined;
  cleanText: string;
  inferredColor: ThemeColor;
}

/**
 * Strips whitespace, control characters, and leading key prefix.
 */
export function sanitizeRawStatusText(key: string, rawText: string): string {
  if (!rawText) return "";

  // Replace newlines/tabs with space
  let text = rawText.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();

  // Strip prefix matching key (e.g., "sync: active" -> "active", "subagents - 2 running" -> "2 running")
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefixRegex = new RegExp(`^${escapedKey}[:\\-\\s]+`, "i");
  text = text.replace(prefixRegex, "").trim();

  return text;
}

/**
 * Detects if the first token in text is an emoji. If so, extracts it.
 */
export function extractLeadingEmoji(text: string): { icon?: string | undefined; remainingText: string } {
  const plain = stripTerminalSequences(text).trim();
  const tokens = plain.split(/\s+/);
  const firstToken = tokens[0];

  if (firstToken && EMOJI_LEADING_REGEX.test(firstToken)) {
    // Check if the original text starts with this emoji (possibly wrapped or raw)
    const icon = firstToken;
    // Remove the icon from the start of the text
    const idx = text.indexOf(icon);
    if (idx !== -1) {
      const remaining = (text.slice(0, idx) + text.slice(idx + icon.length)).trim();
      return { icon, remainingText: remaining };
    }
  }

  return { remainingText: text };
}

/**
 * Simplifies noisy and redundant status terms.
 */
export function simplifyStatusText(text: string): string {
  let cleaned = text.trim();

  // Replace common verbose states
  cleaned = cleaned.replace(/\b(is\s+)?ready\b/gi, "✓");
  cleaned = cleaned.replace(/\b(is\s+)?idle\b/gi, "·");
  cleaned = cleaned.replace(/\b(is\s+)?running\b/gi, "▶");
  cleaned = cleaned.replace(/\b(is\s+)?error\b/gi, "✖");

  // Clean trailing punctuation or spaces
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  return cleaned;
}

/**
 * Infers semantic theme color from status content.
 */
export function inferStatusColor(text: string): ThemeColor {
  const plain = stripTerminalSequences(text).toLowerCase();

  if (/error|fail|crash|fatal|invalid|panic|✖/.test(plain)) {
    return "error";
  }
  if (/warn|conflict|block|alert|timeout|retry|pending|waiting|\?/.test(plain)) {
    return "warning";
  }
  if (/ok|success|synced|done|ready|active|running|pass|✓|▶/.test(plain)) {
    return "success";
  }
  if (/dim|idle|off|sleeping|disabled|·/.test(plain)) {
    return "dim";
  }

  return "muted";
}

/**
 * Full sanitization pipeline for a status text.
 */
export function sanitizeStatus(key: string, rawText: string): SanitizedStatus {
  const preCleaned = sanitizeRawStatusText(key, rawText);
  const { icon, remainingText } = extractLeadingEmoji(preCleaned);
  const cleanText = simplifyStatusText(remainingText);
  const inferredColor = inferStatusColor(rawText);

  return {
    extractedIcon: icon,
    cleanText,
    inferredColor,
  };
}
