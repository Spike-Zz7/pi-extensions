/**
 * Pi restores the session model by getModel(provider, id) before catalogs load.
 * If the baked-in Cursor fallback list does not contain the user's default
 * (cursor-grok-4.6), every restart prints "Could not restore model" and dumps
 * the session onto kimi/anthropic.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const rawPath = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"cursor",
	"cursor-models-raw.json",
);

test("baked-in Cursor fallback lists cursor-grok-4.6 so Pi can restore it at session start", () => {
	const raw = JSON.parse(readFileSync(rawPath, "utf8")) as Array<{ id: string }>;
	const ids = raw.map((model) => model.id);
	assert.ok(
		ids.includes("cursor-grok-4.6") ||
			ids.some((id) => id.startsWith("cursor-grok-4.6-")),
		`cursor-models-raw.json must contain cursor-grok-4.6 (or effort variants); grok ids: ${ids.filter((id) => id.includes("grok")).join(",")}`,
	);
});
