import assert from "node:assert/strict";
import test from "node:test";
import { cursorModelDisplayName } from "../cursor-model-name.ts";

test("folded Cursor names drop the effort adjective so /thinking owns the level", () => {
	assert.equal(cursorModelDisplayName("Grok 4.6 Medium"), "Grok 4.6");
	assert.equal(cursorModelDisplayName("Grok 4.6 High"), "Grok 4.6");
	assert.equal(cursorModelDisplayName("Grok 4.6 Low"), "Grok 4.6");
	assert.equal(cursorModelDisplayName("Grok 4.6 Extra High"), "Grok 4.6");
	assert.equal(cursorModelDisplayName("Grok 4.6"), "Grok 4.6");
	assert.equal(cursorModelDisplayName("Composer 2 Fast"), "Composer 2 Fast");
});
