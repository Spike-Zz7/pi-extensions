/**
 * Where a Cursor conversation lives between requests.
 *
 * Cursor is stateful: once we hold a checkpoint for a conversation, the bridge replays that
 * checkpoint instead of the message list Pi sent, and Cursor answers from its own copy of the
 * history. That is fine while Pi and Cursor agree on what the history is — and wrong the moment
 * Pi compacts, because Pi's short summary never reaches Cursor and Cursor's `usedTokens` keeps
 * reporting the full pre-compaction size back to Pi.
 *
 * So the registry owns two things: the stored conversations, and a per-conversation generation
 * counter. Bumping the generation mints a new Cursor conversation id, which is how a compaction
 * is made to actually take effect — the checkpoint is dropped AND the old server-side
 * conversation is left behind rather than resumed under the same id.
 *
 * It is a separate module from proxy.ts on purpose: proxy.ts pulls in generated protobuf code
 * with non-erasable `enum`s, which Node's type stripping refuses to load, so nothing in it can
 * be unit-tested directly.
 */
import { createHash } from "node:crypto";

export interface StoredConversation {
  conversationId: string;
  checkpoint: Uint8Array | null;
  sessionScoped: boolean;
  blobStore: Map<string, Uint8Array>;
  lastAccessMs: number;
  /**
   * How many completed turns of Pi's transcript this conversation has actually seen. Cursor
   * answers from its own copy of the history, so anything that happened while the session was
   * on another provider is invisible to it — and rotation moves the session between accounts
   * constantly. See {@link isStaleForTranscript}.
   */
  turnsCovered: number;
}

/**
 * Has the session moved on without Cursor?
 *
 * Between two consecutive requests on this conversation the transcript grows by at most one
 * completed turn — the one we just answered. A bigger jump means turns were completed
 * somewhere Cursor never saw: a failover to another provider and back, a branch, another
 * client. Its checkpoint is then a conversation with a hole in it, and resuming from it hands
 * the model a past that is missing whatever happened while it was away.
 *
 * Rebuilding costs tokens; resuming a stale checkpoint costs correctness, silently. So the
 * doubt is resolved toward rebuilding.
 */
export function isStaleForTranscript(stored: StoredConversation, completedTurns: number): boolean {
  if (!stored.checkpoint) return false;
  return completedTurns > stored.turnsCovered + 1;
}

export const conversationStates = new Map<string, StoredConversation>();

/** How many times this conversation has been restarted (compaction, mostly). */
const conversationGenerations = new Map<string, number>();

export function deriveBridgeKeyFromSessionId(sessionId: string): string {
  return createHash("sha256").update(`bridge:${sessionId}`).digest("hex").slice(0, 16);
}

export function deriveConversationKeyFromSessionId(sessionId: string): string {
  return createHash("sha256").update(`conv:${sessionId}`).digest("hex").slice(0, 16);
}

export function conversationGeneration(convKey: string): number {
  return conversationGenerations.get(convKey) ?? 0;
}

/**
 * Stable per (conversation, generation) so a retried request rejoins the same Cursor
 * conversation, while a post-compaction request starts a new one.
 */
export function deterministicConversationId(convKey: string, generation = conversationGeneration(convKey)): string {
  const seed = generation > 0 ? `cursor-conv-id:${convKey}#${generation}` : `cursor-conv-id:${convKey}`;
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32);
  return [
    hex.slice(0, 8), hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${(0x8 | (parseInt(hex[16], 16) & 0x3)).toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

/**
 * Forget everything Cursor is holding for this conversation and move to a fresh id.
 * Returns whether a conversation was actually stored, for logging.
 */
export function forgetConversation(convKey: string): boolean {
  const existed = conversationStates.delete(convKey);
  conversationGenerations.set(convKey, conversationGeneration(convKey) + 1);
  return existed;
}

/** Drop a conversation for good — the session itself is gone, so its generation is noise. */
export function dropConversation(convKey: string): boolean {
  conversationGenerations.delete(convKey);
  return conversationStates.delete(convKey);
}

export function clearConversationRegistry(): void {
  conversationStates.clear();
  conversationGenerations.clear();
}
