import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface Config {
	percent: number;
	models: Record<string, number>;
}

const DEFAULT_PERCENT = 80;
const CONFIG_PATH = join(getAgentDir(), "model-aware-autocompact.json");
const STATUS_KEY = "model-aware-autocompact";

function isValidPercent(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isFinite(value) &&
		value > 0 &&
		value < 100
	);
}

function loadConfig(): Config {
	const fallback: Config = { percent: DEFAULT_PERCENT, models: {} };
	try {
		const value = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as {
			percent?: unknown;
			models?: unknown;
		};
		const models: Record<string, number> = {};
		if (
			value.models &&
			typeof value.models === "object" &&
			!Array.isArray(value.models)
		) {
			for (const [key, percent] of Object.entries(value.models)) {
				if (isValidPercent(percent)) models[key] = percent;
			}
		}
		return {
			percent: isValidPercent(value.percent) ? value.percent : DEFAULT_PERCENT,
			models,
		};
	} catch {
		return fallback;
	}
}

function saveConfig(): void {
	writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function modelKey(model: { provider: string; id: string }): string {
	return `${model.provider}/${model.id}`;
}

function percentFor(
	model: { provider: string; id: string } | undefined,
): number {
	if (!model) return config.percent;
	return config.models[modelKey(model)] ?? config.percent;
}

function thresholdFor(contextWindow: number, percent: number): number {
	return Math.floor(contextWindow * (percent / 100));
}

const config = loadConfig();
let compacting = false;

function updateStatus(ctx: ExtensionContext): void {
	if (!ctx.model?.contextWindow) {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		return;
	}

	const percent = percentFor(ctx.model);
	const threshold = thresholdFor(ctx.model.contextWindow, percent);
	const overridden = config.models[modelKey(ctx.model)] === undefined ? "" : "*";
	const compactThreshold =
		threshold >= 1_000_000
			? `${Number((threshold / 1_000_000).toFixed(1))}m`
			: `${Math.round(threshold / 1_000)}k`;
	ctx.ui.setStatus(
		STATUS_KEY,
		`compact ${percent}%${overridden}/${compactThreshold}`,
	);
}

function compactIfNeeded(ctx: ExtensionContext): void {
	if (compacting) return;

	const usage = ctx.getContextUsage();
	if (!usage || usage.tokens === null) return;

	const percent = percentFor(ctx.model);
	const threshold = thresholdFor(usage.contextWindow, percent);
	if (usage.tokens < threshold) return;

	compacting = true;
	if (ctx.hasUI) {
		ctx.ui.notify(
			`上下文已达 ${((usage.tokens / usage.contextWindow) * 100).toFixed(1)}%，开始自动 compact（阈值 ${percent}% / ${threshold.toLocaleString()} tokens）`,
			"info",
		);
	}

	ctx.compact({
		customInstructions: `Triggered automatically at ${percent}% context usage.`,
		onComplete: () => {
			compacting = false;
			if (ctx.hasUI) ctx.ui.notify("自动 compact 完成", "info");
		},
		onError: (error) => {
			compacting = false;
			if (ctx.hasUI) ctx.ui.notify(`自动 compact 失败：${error.message}`, "error");
		},
	});
}

function parsePercent(value: string): number | undefined {
	const percent = Number(value.replace(/%$/, ""));
	return isValidPercent(percent) ? percent : undefined;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		compacting = false;
		updateStatus(ctx);
	});

	pi.on("model_select", (event, ctx) => {
		updateStatus(ctx);
		const percent = percentFor(event.model);
		const threshold = thresholdFor(event.model.contextWindow, percent);
		if (event.source !== "restore" && ctx.hasUI) {
			const scope =
				config.models[modelKey(event.model)] === undefined ? "默认" : "模型专用";
			ctx.ui.notify(
				`已应用${scope}阈值 ${percent}%：${threshold.toLocaleString()} / ${event.model.contextWindow.toLocaleString()} tokens`,
				"info",
			);
		}

		// 切到更小的上下文窗口后，当前会话可能已经超过新阈值。
		if (event.source !== "restore") compactIfNeeded(ctx);
	});

	// 等待 Agent 完全结束（包括工具调用、重试和后续消息）后再 compact，
	// 避免在连续工具调用过程中打断任务。
	pi.on("agent_settled", (_event, ctx) => compactIfNeeded(ctx));
	pi.on("session_compact", () => {
		compacting = false;
	});
	pi.on("session_compact_failed", () => {
		compacting = false;
	});

	pi.registerCommand("autocompact-percent", {
		description: "查看或永久设置默认/指定模型的自动 compact 百分比",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/).filter(Boolean);
			const currentKey = ctx.model ? modelKey(ctx.model) : undefined;

			if (parts.length === 0 || parts[0] === "status") {
				const percent = percentFor(ctx.model);
				const contextWindow = ctx.model?.contextWindow;
				const threshold = contextWindow
					? thresholdFor(contextWindow, percent)
					: undefined;
				const override =
					currentKey && config.models[currentKey] !== undefined
						? `，模型专用：${config.models[currentKey]}%`
						: "，当前模型使用默认值";
				ctx.ui.notify(
					`默认阈值：${config.percent}%${override}${threshold ? `（当前 ${threshold.toLocaleString()} tokens）` : ""}`,
					"info",
				);
				return;
			}

			if (parts[0] === "list") {
				const entries = Object.entries(config.models);
				ctx.ui.notify(
					entries.length
						? `默认 ${config.percent}%\n${entries.map(([key, percent]) => `${key}: ${percent}%`).join("\n")}`
						: `默认 ${config.percent}%；暂无模型专用设置`,
					"info",
				);
				return;
			}

			if (parts[0] === "reset") {
				const key =
					parts[1] === "current" || parts[1] === "-c" ? currentKey : parts[1];
				if (!key) {
					ctx.ui.notify(
						"用法：/autocompact-percent reset <provider/model|-c>",
						"error",
					);
					return;
				}
				delete config.models[key];
				try {
					saveConfig();
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					ctx.ui.notify(`保存失败：${message}`, "error");
					return;
				}
				updateStatus(ctx);
				ctx.ui.notify(`${key} 已恢复使用默认阈值 ${config.percent}%`, "info");
				return;
			}

			// 单个数字：修改全局默认值。
			if (parts.length === 1) {
				const percent = parsePercent(parts[0]);
				if (percent === undefined) {
					ctx.ui.notify("用法：/autocompact-percent 50", "error");
					return;
				}
				config.percent = percent;
				try {
					saveConfig();
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					ctx.ui.notify(`保存失败：${message}`, "error");
					return;
				}
				updateStatus(ctx);
				ctx.ui.notify(`自动 compact 默认阈值已永久设为 ${percent}%`, "info");
				compactIfNeeded(ctx);
				return;
			}

			// 模型加数字：修改指定模型；-c（或 current）表示当前模型。
			const key =
				parts[0] === "current" || parts[0] === "-c" ? currentKey : parts[0];
			const percent = parsePercent(parts[1]);
			if (!key || percent === undefined || !key.includes("/")) {
				ctx.ui.notify(
					"用法：/autocompact-percent <provider/model|-c> <百分比>",
					"error",
				);
				return;
			}

			const slash = key.indexOf("/");
			const provider = key.slice(0, slash);
			const modelId = key.slice(slash + 1);
			if (!ctx.modelRegistry.find(provider, modelId)) {
				ctx.ui.notify(`找不到模型：${key}`, "error");
				return;
			}

			config.models[key] = percent;
			try {
				saveConfig();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`保存失败：${message}`, "error");
				return;
			}
			updateStatus(ctx);
			ctx.ui.notify(`${key} 的自动 compact 阈值已永久设为 ${percent}%`, "info");
			if (key === currentKey) compactIfNeeded(ctx);
		},
	});
}
