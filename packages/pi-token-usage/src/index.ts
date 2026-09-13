import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { aggregateUsage } from "./aggregate.js";
import { appendLedgerRecord, scanSessions } from "./scanner.js";
import type { TimeWindow } from "./types.js";
import { renderPlainReport, showTokensUi } from "./ui.js";

const VALID_WINDOWS: Record<string, TimeWindow> = {
  today: "today",
  "7": "7",
  "7d": "7",
  "30": "30",
  "30d": "30",
  all: "all",
};

function parseWindow(args: string): TimeWindow | undefined {
  const value = args.trim().toLowerCase();
  if (value === "") return "7";
  return VALID_WINDOWS[value];
}

export default function tokenUsageExtension(pi: ExtensionAPI): void {
  const usageCommand = {
    description: "Show local token usage from Pi session history",
    getArgumentCompletions(prefix: string) {
      const values: TimeWindow[] = ["today", "7", "30", "all"];
      const items = values
        .filter((value) => value.startsWith(prefix.toLowerCase()))
        .map((value) => ({ value, label: value }));
      return items.length > 0 ? items : null;
    },
    handler: async (args: string, ctx: Parameters<Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]>[1]) => {
      const window = parseWindow(args);
      if (!window) {
        const message = "Usage: /usage [today|7|30|all]";
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.log(message);
        return;
      }

      try {
        const result = await scanSessions();
        if (ctx.mode === "tui") {
          await showTokensUi(ctx, result, window, () => scanSessions());
          return;
        }

        const report = renderPlainReport(
          aggregateUsage(result.records, window),
          window,
          result.diagnostics,
        );
        if (ctx.mode === "rpc") ctx.ui.notify(report, "info");
        else console.log(report);
      } catch (error) {
        const message = `Token usage scan failed: ${error instanceof Error ? error.message : String(error)}`;
        if (ctx.hasUI) ctx.ui.notify(message, "error");
        else console.error(message);
      }
    },
  };

  pi.registerCommand("usage", usageCommand);

  if (typeof pi.on === "function") {
    pi.on("turn_end", async (event) => {
      try {
        const raw = event as unknown as { message?: Record<string, unknown>; id?: string };
        const message = raw.message;
        if (!message || message.role !== "assistant" || !message.usage) return;
        const usage = message.usage as Record<string, unknown>;
        const cost = usage.cost as Record<string, unknown> | undefined;
        const id =
          typeof raw.id === "string"
            ? raw.id
            : typeof message.id === "string"
              ? message.id
              : undefined;
        if (!id) return;
        await appendLedgerRecord({
          id,
          timestamp: Date.now(),
          provider: typeof message.provider === "string" ? message.provider : "unknown",
          model: typeof message.model === "string" ? message.model : "unknown",
          inputTokens: typeof usage.input === "number" ? usage.input : 0,
          outputTokens: typeof usage.output === "number" ? usage.output : 0,
          cacheReadTokens: typeof usage.cacheRead === "number" ? usage.cacheRead : 0,
          cacheWriteTokens: typeof usage.cacheWrite === "number" ? usage.cacheWrite : 0,
          totalTokens: typeof usage.totalTokens === "number" ? usage.totalTokens : 0,
          costUSD: typeof cost?.total === "number" ? cost.total : 0,
        });
      } catch {
        // Non-fatal
      }
    });
  }
}
