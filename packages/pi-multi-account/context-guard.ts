/**
 * Mid-run context guard: keep a request inside the model's window WHILE the agent is working.
 *
 * ## The hole this fills
 *
 * Pi checks whether it should compact in exactly two places: after a whole agent run has ended,
 * and just before a new user prompt is submitted. Nothing checks in between. A single autonomous
 * run ("продовжуй") is one agent run no matter how many tool calls it makes, so for the entire
 * length of that run the context is unmeasured and unbounded.
 *
 * Measured across 18 real coding sessions (~96 MB of transcripts):
 *
 * - ONE agent run between two user messages ran for 78 minutes (586 records, 220 assistant turns,
 *   360 tool results). Reported context went 85 663 → 542 529 against a 272 000 window. No
 *   compaction check fired during it; compaction only ran once the run died.
 * - On the main working model (gpt-5.6-sol, window 272 000): 48 % of all requests were sent above
 *   80 % of the window, 30 % above 100 %, 149 above 150 %. Same figures whether you count
 *   `totalTokens` or prompt-only (`input + cacheRead + cacheWrite`).
 * - Auto-compaction, when it did fire, fired at 94 %–199 % of the window. Measured trigger points:
 *   107, 121, 122, 125, 132, 134, 136, 137, 141, 145, 153, 199 %.
 * - Pi's own headroom is `contextWindow - reserveTokens`, reserve 16 384 by default. Excluding
 *   Cursor (whose counter is its own server's), the growth between two consecutive assistant
 *   replies is p99 = 18 950 and p99.9 = 46 731 tokens. The safety margin is smaller than a normal
 *   step, never mind a big one.
 * - A retryable provider error consumes the one checkpoint there is: `_handlePostAgentRun()`
 *   takes the retry branch and returns BEFORE `_checkCompaction()`. In the run above a Codex 500
 *   partway through was retried and the run carried on to 542 k unchecked.
 * - Advertised windows are not usable windows. claude-opus-5 and kimi k3 declare 1 000 000+, so
 *   Pi's threshold lands at ~1 032 192 and auto-compaction can never fire on them; those sessions
 *   reached 717 813 and 547 203 tokens.
 *
 * ## What this module does about it
 *
 * It is the emergency valve, not a replacement for compaction:
 *
 * 1. Estimate the size of the request Pi is about to send, from Pi's own message list plus the
 *    system prompt — never from the provider's reported number. Cursor and openai-codex both keep
 *    the conversation on their side (Cursor via a checkpoint, Codex via WebSocket deltas and
 *    `previous_response_id`), so what they report back is their bookkeeping, not ours.
 * 2. Above `softPercent` of the usable window, elide the OLDEST large tool results out of the
 *    outgoing request — down to `targetPercent` — leaving the most recent `keepVerbatimTokens`
 *    untouched. The session transcript is never modified; only what goes over the wire shrinks.
 * 3. Above `compactPercent`, ask for a real compaction at the next safe boundary. Real compaction
 *    must not be triggered mid-run: `ctx.compact()` starts with `await this.abort()` and would
 *    kill the agent's work.
 *
 * Two properties this design has to have, and does:
 *
 * - **Prefix stability.** Once a message is elided it stays elided (`elidedKeys`), so the request
 *   prefix does not churn from turn to turn and the provider's prompt cache re-warms once instead
 *   of on every request.
 * - **Self-honesty.** Trimming the outgoing request lowers what the provider reports, which would
 *   hide the growth from Pi's own threshold and stop real compaction from ever happening. So the
 *   guard keeps its own untrimmed accounting and drives compaction itself.
 *
 * Nothing here imports Pi at runtime: the module is pure so `node --test` can load it (the
 * protobuf-backed modules cannot be imported under Node's type stripping — see
 * cursor/conversation-registry.ts for the same reasoning).
 */

/** Pi's own image allowance in `estimateTokens`, mirrored so our numbers are comparable to its. */
const ESTIMATED_IMAGE_CHARS = 4800;

/** Prefix every stub carries, so an already-elided result is never counted as elidable again. */
export const ELISION_MARKER = "[pi-multi-account context-guard]";

/**
 * Fixed multiplicative safety margin on the chars/4 estimate. chars/4 under-counts code (which
 * tokenizes closer to 3 chars/token), so the guard is deliberately never allowed to believe the
 * context is smaller than the raw estimate.
 */
export const SAFETY_SLOPE = 1.1;

/** Ceiling on the learned additive overhead, so one bad observation cannot wedge the guard. */
const MAX_LEARNED_OVERHEAD = 80_000;

/** Starting guess for system prompt + tool schemas before any response has been observed. */
const INITIAL_OVERHEAD = 12_000;

export interface GuardMessage {
  role: string;
  [key: string]: unknown;
}

interface ContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
  name?: string;
  arguments?: unknown;
}

function contentChars(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;
  let chars = 0;
  for (const block of content as ContentBlock[]) {
    if (block?.type === "text" && typeof block.text === "string") chars += block.text.length;
    else if (block?.type === "image") chars += ESTIMATED_IMAGE_CHARS;
  }
  return chars;
}

/**
 * Token estimate for one message, mirroring Pi's `estimateTokens` so the two agree on what a
 * conversation "costs". Unknown roles contribute 0, exactly as Pi does.
 */
export function estimateMessageTokens(message: GuardMessage): number {
  if (!message || typeof message.role !== "string") return 0;
  let chars = 0;
  switch (message.role) {
    case "user":
    case "custom":
    case "toolResult":
      chars = contentChars(message.content);
      break;
    case "assistant": {
      const blocks = Array.isArray(message.content) ? (message.content as ContentBlock[]) : [];
      for (const block of blocks) {
        if (block?.type === "text" && typeof block.text === "string") chars += block.text.length;
        else if (block?.type === "thinking" && typeof block.thinking === "string")
          chars += block.thinking.length;
        else if (block?.type === "toolCall")
          chars += (block.name?.length ?? 0) + JSON.stringify(block.arguments ?? null).length;
      }
      break;
    }
    case "bashExecution":
      chars =
        (typeof message.command === "string" ? message.command.length : 0) +
        (typeof message.output === "string" ? message.output.length : 0);
      break;
    case "branchSummary":
    case "compactionSummary":
      chars = typeof message.summary === "string" ? message.summary.length : 0;
      break;
    default:
      return 0;
  }
  return Math.ceil(chars / 4);
}

/**
 * Raw estimate of everything that goes into the request: the message list plus the system prompt.
 *
 * The system prompt matters. Pi's own fallback estimate (`estimateContextTokens`) sums messages
 * only, so the system prompt and the tool schemas — tens of thousands of tokens — are invisible to
 * it whenever provider usage is missing. Here the system prompt is counted; the tool schemas,
 * which extensions cannot see, are what the learned overhead below is for.
 */
export function estimateRawTokens(messages: GuardMessage[], systemPrompt?: string): number {
  let total = 0;
  for (const message of messages) total += estimateMessageTokens(message);
  if (systemPrompt) total += Math.ceil(systemPrompt.length / 4);
  return total;
}

export interface OverheadTracker {
  /**
   * Learn from a request we did NOT trim: how far the provider's prompt count sat above our raw
   * estimate. Returns false when the observation is rejected as untrustworthy.
   */
  observe(rawTokens: number, reportedPromptTokens: number): boolean;
  /** Current learned additive overhead (system prompt residue, tool schemas, tokenizer drift). */
  overhead(): number;
  /** Raw estimate corrected into a conservative "what the provider will actually count". */
  adjust(rawTokens: number): number;
}

/**
 * Learns one number: how much bigger the real prompt is than our raw estimate.
 *
 * Observations outside [0.5x, 4x] of the raw estimate are thrown away rather than learned from.
 * That is the defence against Cursor's and Codex's server-side counters: when a provider reports
 * the size of ITS copy of the conversation instead of the request we sent, the ratio blows out and
 * the observation is discarded instead of poisoning the model.
 */
export function createOverheadTracker(initialOverhead = INITIAL_OVERHEAD): OverheadTracker {
  let overhead = Math.max(0, Math.min(initialOverhead, MAX_LEARNED_OVERHEAD));
  return {
    observe(rawTokens, reportedPromptTokens) {
      if (!(rawTokens > 0) || !(reportedPromptTokens > 0)) return false;
      const ratio = reportedPromptTokens / rawTokens;
      if (ratio < 0.5 || ratio > 4) return false;
      const gap = reportedPromptTokens - rawTokens * SAFETY_SLOPE;
      const clamped = Math.max(0, Math.min(gap, MAX_LEARNED_OVERHEAD));
      overhead = overhead * 0.7 + clamped * 0.3;
      return true;
    },
    overhead() {
      return Math.round(overhead);
    },
    adjust(rawTokens) {
      return Math.ceil(Math.max(0, rawTokens) * SAFETY_SLOPE + overhead);
    },
  };
}

export interface ContextGuardSettings {
  enabled: boolean;
  /** Start eliding old tool results once the estimate crosses this share of the usable window. */
  softPercent: number;
  /** Elide down to this share of the usable window. */
  targetPercent: number;
  /** Ask for a real compaction at the next safe boundary above this share. */
  compactPercent: number;
  /** Most recent slice of the conversation that is never elided. */
  keepVerbatimTokens: number;
  /** Do not bother eliding a result smaller than this. */
  minElideTokens: number;
  /**
   * Hard ceiling on a model's advertised window; 0 trusts the advertisement.
   *
   * Needed because the advertisement is often aspirational: claude-opus-5 and kimi k3 declare
   * 1 000 000+, which puts Pi's own threshold at ~1 032 192 — unreachable — and lets a coding
   * session run to 700 k tokens with no compaction and no complaint.
   */
  maxWindowTokens: number;
}

export const DEFAULT_CONTEXT_GUARD_SETTINGS: ContextGuardSettings = {
  enabled: true,
  softPercent: 0.75,
  targetPercent: 0.6,
  compactPercent: 0.7,
  keepVerbatimTokens: 40_000,
  minElideTokens: 500,
  maxWindowTokens: 400_000,
};

/** The window the guard actually works against: what the model claims, capped by policy. */
export function effectiveWindow(declaredWindow: number, settings: ContextGuardSettings): number {
  if (!(declaredWindow > 0)) return 0;
  if (settings.maxWindowTokens > 0) return Math.min(declaredWindow, settings.maxWindowTokens);
  return declaredWindow;
}

export interface GuardDecision {
  /** Usable window after capping; 0 when the window is unknown and the guard must stand down. */
  window: number;
  /** Share of the usable window the current estimate occupies. */
  percent: number;
  /** Whether this request should be trimmed before it goes out. */
  trim: boolean;
  /** Size to trim down to. */
  targetTokens: number;
  /** Whether a real compaction should be requested at the next safe boundary. */
  wantCompaction: boolean;
}

export function decideGuard(
  adjustedTokens: number,
  declaredWindow: number,
  settings: ContextGuardSettings,
): GuardDecision {
  const window = effectiveWindow(declaredWindow, settings);
  if (!settings.enabled || window <= 0) {
    return { window, percent: 0, trim: false, targetTokens: 0, wantCompaction: false };
  }
  const percent = adjustedTokens / window;
  return {
    window,
    percent,
    trim: percent > settings.softPercent,
    targetTokens: Math.floor(window * settings.targetPercent),
    wantCompaction: percent > settings.compactPercent,
  };
}

export interface ElisionSettings {
  targetTokens: number;
  keepVerbatimTokens: number;
  minElideTokens: number;
}

export interface ElisionResult {
  /** The message list to send. Identical reference to the input when nothing changed. */
  messages: GuardMessage[];
  changed: boolean;
  /** How many messages were elided for the first time in this pass. */
  elidedNow: number;
  /** How many messages are stubbed in the returned list, new and previously elided together. */
  elidedTotal: number;
  /** Raw tokens removed from the request. */
  freedTokens: number;
  /** Raw estimate of the returned list (system prompt not included). */
  tokensAfter: number;
}

/**
 * Stable identity for an elidable message.
 *
 * Deliberately not the array index: `preserveInterruptedTurns` rewrites entries and compaction
 * rebuilds the list wholesale, so an index would silently start pointing at a different message.
 */
export function elisionKey(message: GuardMessage): string | undefined {
  if (!message) return undefined;
  if (message.role === "toolResult" && typeof message.toolCallId === "string")
    return `tr:${message.toolCallId}`;
  if (message.role === "bashExecution" && typeof message.timestamp === "number")
    return `bash:${message.timestamp}`;
  return undefined;
}

function stubText(message: GuardMessage, tokens: number): string {
  const what =
    message.role === "bashExecution"
      ? "a `!` bash execution"
      : `a \`${typeof message.toolName === "string" ? message.toolName : "tool"}\` result`;
  return (
    `${ELISION_MARKER} ~${tokens.toLocaleString("en-US")} tokens of ${what} from earlier in this ` +
    `session were dropped from this request to keep it inside the model's context window. ` +
    `The full output is still in the session transcript — re-run or re-read if you need it.`
  );
}

/** Replace a message's payload with a one-line stub, keeping every field the protocol needs. */
function makeStub(message: GuardMessage, tokens: number): GuardMessage | undefined {
  const text = stubText(message, tokens);
  if (message.role === "toolResult") {
    return { ...message, content: [{ type: "text", text }] };
  }
  if (message.role === "bashExecution") {
    return { ...message, output: text, truncated: true };
  }
  return undefined;
}

function isAlreadyStub(message: GuardMessage): boolean {
  if (message.role === "bashExecution")
    return typeof message.output === "string" && message.output.startsWith(ELISION_MARKER);
  if (message.role === "toolResult") {
    const content = message.content;
    if (!Array.isArray(content) || content.length !== 1) return false;
    const block = content[0] as ContentBlock;
    return block?.type === "text" && typeof block.text === "string" && block.text.startsWith(ELISION_MARKER);
  }
  return false;
}

/**
 * Build the trimmed message list.
 *
 * Two passes on purpose. The first re-applies every key that was elided before — unconditionally,
 * even when the request would already fit — because a request whose prefix keeps changing throws
 * away the provider's prompt cache on every single turn. The second pass adds new elisions,
 * oldest first, and stops the moment the target is met, so no more history is given up than the
 * window actually demands.
 *
 * Messages are never removed and assistant tool calls are never touched: a tool result must stay
 * paired with the call that produced it or providers reject the request outright.
 */
export function planElision(
  messages: GuardMessage[],
  elidedKeys: Set<string>,
  settings: ElisionSettings,
): ElisionResult {
  const sizes = messages.map(estimateMessageTokens);
  let total = 0;
  for (const size of sizes) total += size;

  // Everything from `firstProtected` onwards is the recent slice the agent is actively working in.
  let tail = 0;
  let firstProtected = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    tail += sizes[i];
    firstProtected = i;
    if (tail >= settings.keepVerbatimTokens) break;
  }

  let out: GuardMessage[] | undefined;
  let elidedNow = 0;
  let elidedTotal = 0;
  let freedTokens = 0;

  const apply = (index: number): boolean => {
    const message = messages[index];
    if (isAlreadyStub(message)) {
      elidedTotal++;
      return false;
    }
    const stub = makeStub(message, sizes[index]);
    if (!stub) return false;
    if (!out) out = messages.slice();
    out[index] = stub;
    const delta = sizes[index] - estimateMessageTokens(stub);
    if (delta > 0) {
      total -= delta;
      freedTokens += delta;
    }
    elidedTotal++;
    return true;
  };

  // Pass 1 — everything already given up stays given up, so the prefix stays stable.
  for (let i = 0; i < firstProtected; i++) {
    const key = elisionKey(messages[i]);
    if (!key || !elidedKeys.has(key)) continue;
    apply(i);
  }

  // Pass 2 — give up as little more as the target demands, oldest first.
  for (let i = 0; i < firstProtected && total > settings.targetTokens; i++) {
    const key = elisionKey(messages[i]);
    if (!key || elidedKeys.has(key)) continue;
    if (sizes[i] < settings.minElideTokens) continue;
    if (!apply(i)) continue;
    elidedKeys.add(key);
    elidedNow++;
  }

  return {
    messages: out ?? messages,
    changed: out !== undefined,
    elidedNow,
    elidedTotal,
    freedTokens,
    tokensAfter: total,
  };
}
