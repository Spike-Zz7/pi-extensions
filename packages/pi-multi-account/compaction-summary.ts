/**
 * Guard against Pi throwing away an accumulated compaction summary.
 *
 * Pi's `compact()` has a branch for "the cut fell inside a turn": it summarizes the history
 * range, summarizes the turn prefix, and glues them together. When the history range is empty —
 * which is exactly what happens when a second compaction fires minutes after the first — that
 * branch substitutes the literal string "No prior history." and never passes `previousSummary`
 * to the model at all. The new compaction entry then replaces the accumulated summary with a
 * note about one truncated turn, and everything the session had learned is gone.
 *
 * Seen in a real session: an 11 130-char summary became 2 032 chars beginning "No prior history."
 * and describing work from a different day.
 *
 * We intercept compaction anyway (to route it to a healthy account), so the repair goes here:
 * put the previous summary back where the placeholder is, keeping the turn-prefix context Pi
 * did manage to produce.
 */

/** The exact placeholder Pi writes when it has no history left to summarize. */
const NO_HISTORY_PLACEHOLDER = "No prior history.";

export function restorePreviousSummary(summary: string, previousSummary?: string): string {
  if (!summary.startsWith(NO_HISTORY_PLACEHOLDER)) return summary;
  const previous = previousSummary?.trim();
  if (!previous) return summary;
  return `${previous}${summary.slice(NO_HISTORY_PLACEHOLDER.length)}`;
}

/** True when Pi produced a summary that dropped an existing accumulated summary. */
export function droppedPreviousSummary(summary: string, previousSummary?: string): boolean {
  return summary.startsWith(NO_HISTORY_PLACEHOLDER) && !!previousSummary?.trim();
}
