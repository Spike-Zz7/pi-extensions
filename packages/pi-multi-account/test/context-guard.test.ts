/**
 * Regression tests for the mid-run context guard.
 *
 * The defect being locked down is Pi's, not ours: Pi checks whether to compact only after a whole
 * agent run has ended and just before a new user prompt. Inside a run — which is where an
 * autonomous "продовжуй" session spends essentially all of its time — nothing measures the
 * context at all.
 *
 * Measured across 18 real coding sessions (~96 MB of transcripts):
 *
 *   ONE agent run between two user messages, 78 minutes long.
 *   586 records, 222 assistant messages, 360 tool results, 2 user messages.
 *   Reported context 85 663 → 542 529 against a 272 000 window. Zero compaction checks.
 *
 * Composition of that run, by our own chars/4 estimate (total 379 416 tokens):
 *
 *   tool results          328 111   86.5 %
 *   tool-call arguments    45 798   12.1 %
 *   assistant thinking      3 814    1.0 %
 *   assistant text          1 687    0.4 %
 *
 * That is why the guard elides tool results and leaves everything else alone: 86.5 % of the bloat
 * is in one place. `replays the 78-minute autonomous run` below reproduces that shape and fails
 * without the guard, which is the point — a test that cannot fail proves nothing.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_CONTEXT_GUARD_SETTINGS,
  ELISION_MARKER,
  createOverheadTracker,
  decideGuard,
  effectiveWindow,
  elisionKey,
  estimateMessageTokens,
  estimateRawTokens,
  planElision,
  type ContextGuardSettings,
  type GuardMessage,
} from "../context-guard.ts";

function toolResult(id: string, chars: number, toolName = "read"): GuardMessage {
  return {
    role: "toolResult",
    toolCallId: id,
    toolName,
    isError: false,
    timestamp: 1,
    content: [{ type: "text", text: "x".repeat(chars) }],
  };
}

function assistantCall(id: string, argChars: number, timestamp = 1): GuardMessage {
  return {
    role: "assistant",
    timestamp,
    content: [
      { type: "thinking", thinking: "t".repeat(40) },
      { type: "toolCall", id, name: "read", arguments: { path: "p".repeat(argChars) } },
    ],
  };
}

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

test("estimateMessageTokens mirrors Pi's own chars/4 accounting per role", () => {
  assert.equal(estimateMessageTokens({ role: "user", content: [{ type: "text", text: "abcd" }] }), 1);
  // Pi charges a flat 4800 chars for an image.
  assert.equal(estimateMessageTokens({ role: "user", content: [{ type: "image", data: "…" }] }), 1200);
  assert.equal(
    estimateMessageTokens({ role: "bashExecution", command: "ab", output: "cd", timestamp: 1 }),
    1,
  );
  assert.equal(estimateMessageTokens({ role: "compactionSummary", summary: "abcdefgh" }), 2);
  // Unknown roles contribute nothing, exactly as Pi's switch does.
  assert.equal(estimateMessageTokens({ role: "somethingNew", content: "ignored" }), 0);
});

test("estimateRawTokens counts the system prompt that Pi's own fallback estimate forgets", () => {
  const messages: GuardMessage[] = [{ role: "user", content: [{ type: "text", text: "abcd" }] }];
  const withoutPrompt = estimateRawTokens(messages);
  const withPrompt = estimateRawTokens(messages, "s".repeat(40_000));
  assert.equal(withoutPrompt, 1);
  assert.equal(withPrompt, 1 + 10_000);
});

// ---------------------------------------------------------------------------
// Overhead learning, and the defence against a provider reporting its own bookkeeping
// ---------------------------------------------------------------------------

test("overhead tracker learns the gap between our estimate and the real prompt", () => {
  const tracker = createOverheadTracker(0);
  assert.equal(tracker.overhead(), 0);
  for (let i = 0; i < 20; i++) assert.equal(tracker.observe(100_000, 130_000), true);
  // 130 000 - 100 000 * 1.1 = 20 000 of system prompt + tool schemas + tokenizer drift.
  // An EWMA approaches its target rather than landing on it, so this is a band, not an equality.
  assert.ok(Math.abs(tracker.overhead() - 20_000) < 500, `overhead was ${tracker.overhead()}`);
  assert.ok(Math.abs(tracker.adjust(100_000) - 130_000) < 500, `adjusted to ${tracker.adjust(100_000)}`);
});

test("overhead tracker refuses a provider's server-side counter instead of learning from it", () => {
  // Cursor reports the size of ITS copy of the conversation, and openai-codex reports the size of
  // the conversation it is holding behind `previous_response_id`. Both blow the ratio out; a
  // single one of those observations, learned, would wedge the guard's accounting for the session.
  const tracker = createOverheadTracker(10_000);
  assert.equal(tracker.observe(50_000, 445_439), false, "8.9x must be rejected");
  assert.equal(tracker.observe(50_000, 10_000), false, "0.2x must be rejected");
  assert.equal(tracker.overhead(), 10_000, "a rejected observation must not move the estimate");
  assert.equal(tracker.observe(50_000, 62_000), true, "a plausible observation is still learned");
});

test("the adjusted estimate is never smaller than the raw estimate", () => {
  const tracker = createOverheadTracker(0);
  // chars/4 under-counts code, so believing it verbatim is the one direction the guard must not err.
  for (let i = 0; i < 50; i++) tracker.observe(200_000, 100_000 /* rejected: 0.5x boundary */);
  assert.ok(tracker.adjust(200_000) >= 200_000);
});

// ---------------------------------------------------------------------------
// Window policy
// ---------------------------------------------------------------------------

test("effectiveWindow caps an aspirational advertisement", () => {
  const settings = { ...DEFAULT_CONTEXT_GUARD_SETTINGS };
  // claude-opus-5 and kimi k3 advertise these; Pi's threshold then sits at ~1 032 192 and auto
  // compaction can never fire, which is how a coding session reached 717 813 tokens untouched.
  assert.equal(effectiveWindow(1_048_576, settings), 400_000);
  assert.equal(effectiveWindow(272_000, settings), 272_000);
  assert.equal(effectiveWindow(1_048_576, { ...settings, maxWindowTokens: 0 }), 1_048_576);
  assert.equal(effectiveWindow(0, settings), 0);
});

test("decideGuard trims late and compacts early, and stands down on an unknown window", () => {
  const settings = { ...DEFAULT_CONTEXT_GUARD_SETTINGS };
  const window = 272_000;

  const calm = decideGuard(100_000, window, settings);
  assert.equal(calm.trim, false);
  assert.equal(calm.wantCompaction, false);

  // 0.7 < x < 0.75 — ask for a real summary at the next boundary, but do not touch this request.
  const warming = decideGuard(Math.floor(window * 0.72), window, settings);
  assert.equal(warming.wantCompaction, true);
  assert.equal(warming.trim, false);

  const hot = decideGuard(Math.floor(window * 0.9), window, settings);
  assert.equal(hot.trim, true);
  assert.equal(hot.wantCompaction, true);
  assert.equal(hot.targetTokens, Math.floor(window * 0.6));

  // No window means no basis for any decision — never guess.
  assert.equal(decideGuard(900_000, 0, settings).trim, false);
  assert.equal(decideGuard(900_000, 0, settings).wantCompaction, false);
  assert.equal(decideGuard(900_000, window, { ...settings, enabled: false }).trim, false);
});

// ---------------------------------------------------------------------------
// Elision
// ---------------------------------------------------------------------------

test("elisionKey is stable identity, never the array index", () => {
  assert.equal(elisionKey(toolResult("call-7", 10)), "tr:call-7");
  assert.equal(elisionKey({ role: "bashExecution", command: "ls", output: "x", timestamp: 42 }), "bash:42");
  assert.equal(elisionKey({ role: "user", content: [] }), undefined);
  assert.equal(elisionKey(assistantCall("c", 4)), undefined);
});

test("planElision keeps the recent slice verbatim and gives up the oldest first", () => {
  const messages: GuardMessage[] = [];
  for (let i = 0; i < 10; i++) messages.push(toolResult(`c${i}`, 40_000)); // 10 000 tokens each
  const result = planElision(messages, new Set(), {
    targetTokens: 60_000,
    keepVerbatimTokens: 30_000,
    minElideTokens: 500,
  });

  assert.equal(result.changed, true);
  assert.equal(result.messages.length, messages.length, "messages are never removed");
  // Tail of 30 000 tokens = the last three results, untouched.
  for (let i = 7; i < 10; i++) {
    const text = (result.messages[i].content as { text: string }[])[0].text;
    assert.equal(text.startsWith(ELISION_MARKER), false, `message ${i} must stay verbatim`);
  }
  // Oldest first: index 0 goes before index 6.
  const first = (result.messages[0].content as { text: string }[])[0].text;
  assert.equal(first.startsWith(ELISION_MARKER), true);
  assert.ok(result.tokensAfter <= 60_000, `tokensAfter was ${result.tokensAfter}`);
});

test("planElision gives up no more than the target demands", () => {
  const messages: GuardMessage[] = [];
  for (let i = 0; i < 10; i++) messages.push(toolResult(`c${i}`, 40_000));
  const elided = new Set<string>();
  const result = planElision(messages, elided, {
    targetTokens: 80_000,
    keepVerbatimTokens: 30_000,
    minElideTokens: 500,
  });
  // 100 000 total, tail 30 000 protected (the last three), each elision frees ~9 950.
  // 90 050 → 80 100 → 70 150: the third is the first that actually gets under 80 000.
  assert.equal(elided.size, 3, `elided ${[...elided].join(", ")}`);
  assert.ok(result.tokensAfter <= 80_000, `tokensAfter was ${result.tokensAfter}`);
  // Minimality: putting any one of them back would breach the target again.
  const perElision = result.freedTokens / elided.size;
  assert.ok(
    result.tokensAfter + perElision > 80_000,
    `gave up more history than the target needed (${result.tokensAfter} + ${perElision})`,
  );
});

test("planElision preserves the fields the tool protocol needs", () => {
  const messages = [toolResult("call-1", 40_000, "bash"), toolResult("call-2", 40_000)];
  const result = planElision(messages, new Set(), {
    targetTokens: 1,
    keepVerbatimTokens: 0,
    minElideTokens: 1,
  });
  const stub = result.messages[0];
  assert.equal(stub.role, "toolResult");
  assert.equal(stub.toolCallId, "call-1", "a result orphaned from its call is rejected by providers");
  assert.equal(stub.toolName, "bash");
  assert.equal(stub.isError, false);
  assert.match((stub.content as { text: string }[])[0].text, /`bash` result/);
});

test("planElision keeps the request prefix stable so the prompt cache is not thrown away", () => {
  // Once a message is given up it stays given up, even on a later request that would now fit.
  // Otherwise the prefix churns every turn and every request re-pays full input price.
  const messages: GuardMessage[] = [];
  for (let i = 0; i < 10; i++) messages.push(toolResult(`c${i}`, 40_000));
  const elided = new Set<string>();

  planElision(messages, elided, { targetTokens: 60_000, keepVerbatimTokens: 30_000, minElideTokens: 500 });
  const given = [...elided];
  assert.ok(given.length >= 4);

  const second = planElision(messages, elided, {
    targetTokens: 10_000_000, // the request would now fit with nothing elided at all
    keepVerbatimTokens: 30_000,
    minElideTokens: 500,
  });
  assert.equal(second.changed, true, "previously elided messages must stay elided");
  assert.equal(second.elidedNow, 0, "and no new ones may be given up");
  assert.deepEqual([...elided], given, "the elided set must not grow");
  for (const key of given) {
    const index = Number(key.slice("tr:c".length));
    const text = (second.messages[index].content as { text: string }[])[0].text;
    assert.equal(text.startsWith(ELISION_MARKER), true);
  }
});

test("planElision is idempotent on input that is already stubbed", () => {
  const messages: GuardMessage[] = [];
  for (let i = 0; i < 6; i++) messages.push(toolResult(`c${i}`, 40_000));
  const elided = new Set<string>();
  const once = planElision(messages, elided, {
    targetTokens: 30_000,
    keepVerbatimTokens: 10_000,
    minElideTokens: 500,
  });
  const twice = planElision(once.messages, elided, {
    targetTokens: 30_000,
    keepVerbatimTokens: 10_000,
    minElideTokens: 500,
  });
  assert.equal(twice.elidedNow, 0);
  assert.equal(twice.tokensAfter, once.tokensAfter);
});

test("planElision leaves a request that already fits completely alone", () => {
  const messages = [toolResult("c0", 400), toolResult("c1", 400)];
  const result = planElision(messages, new Set(), {
    targetTokens: 100_000,
    keepVerbatimTokens: 40_000,
    minElideTokens: 500,
  });
  assert.equal(result.changed, false);
  assert.equal(result.messages, messages, "an untouched list must be the same reference");
});

// ---------------------------------------------------------------------------
// The actual defect: an autonomous run that nobody measures
// ---------------------------------------------------------------------------

/**
 * Rebuilds the shape of the 78-minute run: 222 assistant turns, 360 tool results, ~86 % of the
 * weight in tool results and ~12 % in tool-call arguments, ending far past the window.
 */
function autonomousRun(): GuardMessage[] {
  const messages: GuardMessage[] = [
    { role: "user", content: [{ type: "text", text: "продовжуй" }] },
  ];
  for (let turn = 0; turn < 222; turn++) {
    // ~206 tokens of tool-call arguments per assistant message (45 798 / 222 in the real run).
    messages.push(assistantCall(`call-${turn}`, 820, 1000 + turn));
    // ~911 tokens per tool result (328 111 / 360), with the occasional 50 KB read that Pi caps at.
    const chars = turn % 40 === 39 ? 50_000 : 3_600;
    messages.push(toolResult(`call-${turn}`, chars));
    if (turn % 3 === 2) messages.push(toolResult(`extra-${turn}`, 3_600, "bash"));
  }
  return messages;
}

test("the unguarded run really does blow through the window (the test must be able to fail)", () => {
  const messages = autonomousRun();
  const raw = estimateRawTokens(messages, "s".repeat(24_000));
  assert.ok(raw > 272_000, `run only reached ${raw} tokens; it must exceed the window to be a test`);
});

test("replays the 78-minute autonomous run and never sends a request over the window", () => {
  const settings: ContextGuardSettings = { ...DEFAULT_CONTEXT_GUARD_SETTINGS };
  const declaredWindow = 272_000; // gpt-5.6-sol
  const systemPrompt = "s".repeat(24_000); // ~6 000 tokens
  const tracker = createOverheadTracker();
  const elided = new Set<string>();
  const full = autonomousRun();

  let compactionRequested = -1;
  let worstPercent = 0;

  // Replay the run one LLM call at a time, exactly as the `context` hook sees it.
  for (let end = 1; end <= full.length; end++) {
    const messages = full.slice(0, end);
    const raw = estimateRawTokens(messages, systemPrompt);
    const adjusted = tracker.adjust(raw);
    const decision = decideGuard(adjusted, declaredWindow, settings);

    if (decision.wantCompaction && compactionRequested < 0) compactionRequested = end;

    let sent = messages;
    if (decision.trim) {
      sent = planElision(messages, elided, {
        targetTokens: decision.targetTokens,
        keepVerbatimTokens: settings.keepVerbatimTokens,
        minElideTokens: settings.minElideTokens,
      }).messages;
    } else if (elided.size > 0) {
      // Below the soft line we still re-apply what was already given up — prefix stability.
      sent = planElision(messages, elided, {
        targetTokens: Number.POSITIVE_INFINITY,
        keepVerbatimTokens: settings.keepVerbatimTokens,
        minElideTokens: settings.minElideTokens,
      }).messages;
    }

    const sentTokens = tracker.adjust(estimateRawTokens(sent, systemPrompt));
    const percent = sentTokens / decision.window;
    if (percent > worstPercent) worstPercent = percent;

    assert.ok(
      sentTokens <= declaredWindow,
      `request ${end} would have gone out at ${sentTokens} tokens (${(percent * 100).toFixed(0)} % of window)`,
    );
  }

  assert.ok(compactionRequested > 0, "a real compaction must have been requested at some point");
  assert.ok(worstPercent <= 1, `peak was ${(worstPercent * 100).toFixed(0)} % of the window`);
  assert.ok(elided.size > 0, "the guard must actually have given something up");
});

test("the guard holds the line on a model that advertises a million-token window", () => {
  // kimi k3 advertises 1 048 576. Pi's threshold lands at ~1 032 192, so it never fires and the
  // session grows until the provider — or the model's own comprehension — gives out.
  const settings: ContextGuardSettings = { ...DEFAULT_CONTEXT_GUARD_SETTINGS };
  const elided = new Set<string>();
  const tracker = createOverheadTracker();
  const full = autonomousRun();
  const usable = effectiveWindow(1_048_576, settings);

  const raw = estimateRawTokens(full);
  const decision = decideGuard(tracker.adjust(raw), 1_048_576, settings);
  assert.equal(decision.window, 400_000);
  assert.equal(decision.wantCompaction, true, "the cap is what makes the trigger reachable at all");

  const sent = planElision(full, elided, {
    targetTokens: decision.targetTokens,
    keepVerbatimTokens: settings.keepVerbatimTokens,
    minElideTokens: settings.minElideTokens,
  }).messages;
  assert.ok(tracker.adjust(estimateRawTokens(sent)) <= usable);
});
