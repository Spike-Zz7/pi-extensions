import assert from "node:assert/strict";
import test from "node:test";
import {
	estimatePromptTokens,
	resolveCursorUsage,
} from "../cursor/prompt-usage.ts";

test("Cursor prompt tokens are estimated from the request when the stream reports none", () => {
	const messages = [
		{ role: "system", content: "x".repeat(400) },
		{ role: "user", content: "y".repeat(400) },
	];
	const estimated = estimatePromptTokens(messages);
	assert.ok(estimated >= 200, `expected a real prompt estimate, got ${estimated}`);

	const usage = resolveCursorUsage({
		outputTokens: 12,
		totalTokens: 0,
		promptTokenEstimate: estimated,
	});
	assert.equal(usage.prompt_tokens, estimated);
	assert.equal(usage.completion_tokens, 12);
	assert.equal(usage.total_tokens, estimated + 12);
});

test("Cursor's own conversation counter must never be reported as the prompt we sent", () => {
	// Real numbers from a real session, one reply after a successful
	// compaction: Cursor answered usedTokens = 208 632 for a payload of ~53 000 tokens,
	// because usedTokens counts Cursor's server-side conversation, not our request. Pi read
	// that as its own context size, blew past its 200k window and compacted again — every
	// turn, forever.
	const usage = resolveCursorUsage({
		outputTokens: 552,
		totalTokens: 208_632,
		promptTokenEstimate: 53_000,
	});
	assert.equal(usage.prompt_tokens, 53_000);
	assert.equal(usage.completion_tokens, 552);
	assert.equal(usage.total_tokens, 53_552);
	assert.ok(
		usage.total_tokens < 184_000,
		"anything above contextWindow - reserveTokens re-triggers auto-compaction",
	);
});

test("Cursor tokenDetails are still used when we could not measure the request", () => {
	const usage = resolveCursorUsage({ outputTokens: 20, totalTokens: 500 });
	assert.equal(usage.prompt_tokens, 480);
	assert.equal(usage.completion_tokens, 20);
	assert.equal(usage.total_tokens, 500);
});

test("a tool-call turn with no tokenDetails is not reported as empty usage", () => {
	const usage = resolveCursorUsage({
		outputTokens: 0,
		totalTokens: 0,
		promptTokenEstimate: 230_000,
	});
	assert.equal(usage.prompt_tokens, 230_000);
	assert.equal(usage.total_tokens, 230_000);
	assert.ok(usage.total_tokens > 0, "auto-compact must see a non-zero prompt");
});
