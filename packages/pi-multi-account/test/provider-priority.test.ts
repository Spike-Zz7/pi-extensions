/**
 * The failover ladder: where work goes once EVERY account of the current provider is spent.
 *
 * Rotation already gets the first step right — of 602 automatic failovers in this machine's black
 * box, 588 stayed inside the same provider family. The other 14 are what this is about. They had
 * no policy behind them and scattered:
 *
 *     kimi-coding → openai-codex   3      cursor       → openai-codex  1
 *     openai-codex → anthropic     3      anthropic    → cursor        1
 *     kimi-coding → anthropic      2      ollama       → kimi-coding   2
 *     kimi-coding → cursor         2
 *
 * And not one of those 602 ever reached a per-token account (openrouter, zai, minimax,
 * opencode-go-api, openai) — correct as a default, but it was an accident of `providerOrder`
 * being typed to the six managed families rather than a policy anyone chose.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PROVIDER_PRIORITY,
  MANAGED_GROUPS,
  comparePriority,
  describePriority,
  normalizeGroup,
  normalizePriority,
  priorityRank,
} from "../provider-priority.ts";

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

test("every rotation slot of one account collapses to a single group", () => {
  // Preferring one numbered slot over its sibling is rotation's job, not the ladder's.
  assert.equal(normalizeGroup("openai-codex-account-3"), "openai-codex");
  assert.equal(normalizeGroup("kimi-coding-account-2"), "kimi-coding");
  assert.equal(normalizeGroup("cursor-account-2"), "cursor");
  assert.equal(normalizeGroup("openai-codex"), "openai-codex");
});

test("a provider/model pair names its group", () => {
  assert.equal(normalizeGroup("openai-codex/gpt-5.6-sol"), "openai-codex");
  assert.equal(normalizeGroup("anthropic-account-2/claude-opus-5"), "anthropic");
});

test("the nicknames people actually type are understood", () => {
  assert.equal(normalizeGroup("claude"), "anthropic");
  assert.equal(normalizeGroup("Codex"), "openai-codex");
  assert.equal(normalizeGroup("kimi"), "kimi-coding");
  assert.equal(normalizeGroup("  GPT  "), "openai-codex");
});

test("a provider this build has never heard of is still rankable", () => {
  // The whole second half of the gap: `providerOrder` was typed to the six managed families, so
  // openrouter/zai/minimax could not be placed in the order at all and sat last by construction.
  for (const group of ["openrouter", "zai", "minimax", "opencode-go-api", "deepseek"]) {
    assert.equal(normalizeGroup(group), group, `${group} must survive normalisation`);
  }
  assert.equal(normalizeGroup("brand-new-provider-account-4"), "brand-new-provider");
});

test("normalizePriority cleans a list without silently reordering it", () => {
  assert.deepEqual(normalizePriority("codex, claude  kimi"), [
    "openai-codex",
    "anthropic",
    "kimi-coding",
  ]);
  // First mention wins: that is where the person meant to put it.
  assert.deepEqual(normalizePriority(["cursor", "claude", "cursor"]), ["cursor", "anthropic"]);
  assert.deepEqual(normalizePriority(["", "  ", null as unknown as string]), []);
  assert.deepEqual(normalizePriority(undefined), []);
});

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

test("the shipped default is the managed families, per-token providers left off the end", () => {
  assert.deepEqual(DEFAULT_PROVIDER_PRIORITY, [...MANAGED_GROUPS]);
  for (const paid of ["openrouter", "zai", "minimax", "opencode-go-api"]) {
    assert.equal(
      priorityRank(paid, DEFAULT_PROVIDER_PRIORITY),
      Number.MAX_SAFE_INTEGER,
      `${paid} bills per token; a flat-rate subscription must be preferred while one is free`,
    );
  }
});

test("an unranked group sorts after every ranked one", () => {
  const ladder = ["anthropic", "openai-codex"];
  assert.ok(comparePriority("anthropic", "openrouter", ladder) < 0);
  assert.ok(comparePriority("openrouter", "openai-codex", ladder) > 0);
});

test("silence is not a preference: two unranked groups are left exactly as they were", () => {
  const ladder = ["anthropic"];
  // Returning 0 hands the decision to the next tiebreak instead of inventing an order.
  assert.equal(comparePriority("openrouter", "zai", ladder), 0);
  assert.equal(comparePriority("zai", "openrouter", ladder), 0);
});

test("an empty ladder has no opinion about anything", () => {
  assert.equal(comparePriority("anthropic", "openrouter", []), 0);
  assert.equal(comparePriority("cursor", "anthropic", []), 0);
});

test("the ladder is a total order over the groups it names", () => {
  const ladder = ["cursor", "anthropic", "openai-codex"];
  assert.ok(comparePriority("cursor", "anthropic", ladder) < 0);
  assert.ok(comparePriority("anthropic", "openai-codex", ladder) < 0);
  assert.ok(comparePriority("cursor", "openai-codex", ladder) < 0, "must be transitive");
  assert.equal(comparePriority("cursor", "cursor", ladder), 0);
  // Antisymmetry — a comparator that fails this can make Array.sort produce garbage.
  // `+ 0` normalises the -0 that negating a zero sign produces, which is a distinct value here.
  for (const [a, b] of [["cursor", "anthropic"], ["anthropic", "openrouter"], ["zai", "zai"]]) {
    assert.equal(
      Math.sign(comparePriority(a, b, ladder)) + 0,
      -Math.sign(comparePriority(b, a, ladder)) + 0,
      `${a} vs ${b}`,
    );
  }
});

test("ranking reads slot names and nicknames, not just canonical ids", () => {
  const ladder = normalizePriority("claude codex");
  assert.equal(priorityRank("anthropic-account-2", ladder), 0);
  assert.equal(priorityRank("openai-codex-account-7/gpt-5.6-terra", ladder), 1);
});

// ---------------------------------------------------------------------------
// Telling the user what the ladder is
// ---------------------------------------------------------------------------

test("the description names the accounts that are not logged in", () => {
  // A typo in a provider name would otherwise look exactly like a ladder that worked.
  const lines = describePriority(["anthropic", "openrouter"], ["anthropic", "cursor"]);
  assert.match(lines[0], /1\. anthropic$/);
  assert.match(lines[1], /2\. openrouter {2}\(not logged in\)/);
  assert.match(lines[2], /everything else — cursor/);
});

test("the description always ends with the catch-all rung", () => {
  const lines = describePriority(["anthropic"]);
  assert.equal(lines.length, 2);
  assert.match(lines[1], /2\. everything else$/);
});
