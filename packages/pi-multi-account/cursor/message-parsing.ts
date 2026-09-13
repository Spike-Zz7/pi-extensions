/**
 * Turning Pi's OpenAI-shaped message list into the turn structure Cursor wants.
 *
 * This is the module that matters whenever we cannot resume Cursor's own server-side
 * conversation and have to rebuild it from Pi's transcript — which happens on a restored
 * session, on a fresh process, and (since compaction stopped being a no-op) after every
 * compaction. Everything the model will know about the work so far has to survive this
 * function; whatever it drops is gone.
 *
 * It lives apart from proxy.ts because proxy.ts imports generated protobuf code with
 * non-erasable `enum`s, which Node's type stripping refuses to load — so nothing in proxy.ts
 * can be unit tested. This file has no such dependency and is tested directly.
 */

export interface ContentPart {
  type: string;
  text?: string;
}

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null | ContentPart[];
  tool_call_id?: string;
  tool_calls?: OpenAIToolCall[];
}

export interface ParsedToolResult {
  content: string;
  isError: boolean;
}

export interface ParsedAssistantTextStep {
  kind: "assistantText";
  text: string;
}

export interface ParsedToolCallStep {
  kind: "toolCall";
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  result?: ParsedToolResult;
}

export type ParsedTurnStep = ParsedAssistantTextStep | ParsedToolCallStep;

export interface ParsedTurn {
  userText: string;
  steps: ParsedTurnStep[];
}

export interface ToolResultInfo {
  toolCallId: string;
  content: string;
}

export interface ParsedMessages {
  systemPrompt: string;
  userText: string;
  /** Completed turns, ready to be replayed as conversation history. */
  turns: ParsedTurn[];
  toolResults: ToolResultInfo[];
  /**
   * The turn that is still in flight: the user asked something, the assistant called tools,
   * and their results have just come back. On the live path those results are fed straight
   * into the open stream, so this is unused. On the rebuild path it is the only record that
   * the work happened at all — without it the model is handed the original question again
   * with no idea it already ran the tools, or a naked blob of tool output with no question
   * attached to it.
   */
  pendingTurn?: ParsedTurn;
}

export function textContent(content: OpenAIMessage["content"]): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  return content.filter((p) => p.type === "text" && p.text).map((p) => p.text!).join("\n");
}

export function parseToolCallArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return raw ? { __raw: raw } : {};
  }
}

export function isToolCallStep(step: ParsedTurnStep): step is ParsedToolCallStep {
  return step.kind === "toolCall";
}

function stripTurnRuntimeState(turn: ParsedTurn & {
  toolCallById?: Map<string, ParsedToolCallStep>;
  sawToolResult?: boolean;
  sawAssistantAfterToolResult?: boolean;
}): ParsedTurn {
  return { userText: turn.userText, steps: turn.steps };
}

export function parseMessages(
  messages: OpenAIMessage[],
  debug?: (event: string, data: Record<string, unknown>) => void,
): ParsedMessages {
  let systemPrompt = "You are a helpful assistant.";
  const turns: ParsedTurn[] = [];

  debug?.("parse_messages.start", { messages });

  const systemParts = messages.filter((m) => m.role === "system").map((m) => textContent(m.content));
  if (systemParts.length > 0) systemPrompt = systemParts.join("\n");

  const nonSystem = messages.filter((m) => m.role !== "system");
  let currentTurn: (ParsedTurn & {
    toolCallById: Map<string, ParsedToolCallStep>;
    sawToolResult: boolean;
    sawAssistantAfterToolResult: boolean;
  }) | null = null;

  const finalizeCurrentTurn = () => {
    if (!currentTurn) return;
    turns.push(stripTurnRuntimeState(currentTurn));
    currentTurn = null;
  };

  for (const msg of nonSystem) {
    if (msg.role === "user") {
      finalizeCurrentTurn();
      currentTurn = {
        userText: textContent(msg.content),
        steps: [],
        toolCallById: new Map(),
        sawToolResult: false,
        sawAssistantAfterToolResult: false,
      };
      continue;
    }

    if (!currentTurn) continue;

    if (msg.role === "assistant") {
      const text = textContent(msg.content);
      if (text) {
        if (currentTurn.sawToolResult) currentTurn.sawAssistantAfterToolResult = true;
        currentTurn.steps.push({ kind: "assistantText", text });
      }

      for (const toolCall of msg.tool_calls ?? []) {
        const step: ParsedToolCallStep = {
          kind: "toolCall",
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          arguments: parseToolCallArguments(toolCall.function.arguments),
        };
        currentTurn.steps.push(step);
        currentTurn.toolCallById.set(step.toolCallId, step);
      }
      continue;
    }

    if (msg.role === "tool") {
      const toolCallId = msg.tool_call_id ?? "";
      const content = textContent(msg.content);
      const existing = toolCallId ? currentTurn.toolCallById.get(toolCallId) : undefined;
      if (existing) {
        existing.result = { content, isError: false };
      } else {
        const step: ParsedToolCallStep = {
          kind: "toolCall",
          toolCallId,
          toolName: "",
          arguments: {},
          result: { content, isError: false },
        };
        currentTurn.steps.push(step);
        if (toolCallId) currentTurn.toolCallById.set(toolCallId, step);
      }
      currentTurn.sawToolResult = true;
    }
  }

  let userText = "";
  let toolResults: ToolResultInfo[] = [];
  let pendingTurn: ParsedTurn | undefined;

  if (currentTurn) {
    const toolCallSteps = currentTurn.steps.filter(isToolCallStep);
    const hasAnyToolResults = toolCallSteps.some((step) => step.result);
    const lastStep = currentTurn.steps.at(-1);
    const isToolContinuation = lastStep?.kind === "toolCall";

    if (currentTurn.steps.length === 0 || isToolContinuation) {
      userText = currentTurn.userText;
      if (hasAnyToolResults) {
        toolResults = toolCallSteps
          .filter((step) => step.result)
          .map((step) => ({ toolCallId: step.toolCallId, content: step.result!.content }));
      }
      // Keep the whole in-flight turn, not just its results. The live path ignores this;
      // the rebuild path cannot reconstruct the session without it.
      if (currentTurn.steps.length > 0) {
        pendingTurn = stripTurnRuntimeState(currentTurn);
      }
    } else {
      turns.push(stripTurnRuntimeState(currentTurn));
    }
  }

  const parsed: ParsedMessages = { systemPrompt, userText, turns, toolResults, pendingTurn };
  debug?.("parse_messages.end", parsed as unknown as Record<string, unknown>);
  return parsed;
}

/**
 * Rebuilding a conversation Cursor has no memory of.
 *
 * There are two ways to put words in front of the model, and they are not equally reliable:
 *
 *   - the request's own user message travels inline in the request — it is how the first turn
 *     of every conversation works, so it always arrives;
 *   - history turns travel as sha256 blob IDs. The words themselves stay on our side, and
 *     Cursor has to come back over the KV channel and ask for each blob. If it does not ask,
 *     or asks for something we do not hold, nothing surfaces and nothing complains: a missing
 *     blob is answered with an empty result.
 *
 * Replaying the restored session as history therefore put the compaction summary somewhere the
 * model could not read it — present in Pi's chat, invisible to Cursor. So the rebuild does not
 * use history at all: everything the model needs is rendered into the message it is answering,
 * through the channel that cannot silently drop it.
 */

const CONTEXT_OPEN = "=== RESTORED SESSION CONTEXT ===";
const CONTEXT_CLOSE = "=== END RESTORED SESSION CONTEXT ===";

function renderStep(step: ParsedTurnStep): string {
  if (step.kind === "assistantText") return `Assistant: ${step.text}`;
  const args = JSON.stringify(step.arguments ?? {});
  const call = `Assistant called ${step.toolName || "tool"}(${args})`;
  if (!step.result) return `${call}\n  -> (no result recorded)`;
  const label = step.result.isError ? "error" : "result";
  return `${call}\n  -> ${label}: ${step.result.content}`;
}

/** A faithful plain-text transcript of everything that already happened. */
export function renderTurnsAsText(turns: ParsedTurn[]): string {
  const blocks: string[] = [];
  for (const turn of turns) {
    const lines: string[] = [];
    if (turn.userText.trim()) lines.push(`User: ${turn.userText}`);
    for (const step of turn.steps) lines.push(renderStep(step));
    if (lines.length > 0) blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n");
}

/** The turns to replay as Cursor conversation history. Empty on the rebuild path — see above. */
export function historyForRebuild(_parsed: Pick<ParsedMessages, "turns" | "pendingTurn">): ParsedTurn[] {
  return [];
}

/** Every turn that already happened, in order, including the one still in flight. */
export function allPriorTurns(parsed: Pick<ParsedMessages, "turns" | "pendingTurn">): ParsedTurn[] {
  return parsed.pendingTurn ? [...parsed.turns, parsed.pendingTurn] : [...parsed.turns];
}

const CONTINUATION_INSTRUCTION =
  "Continue the work above from where it stopped. Do not repeat steps that are already done, "
  + "and do not ask the user to repeat themselves — everything you need is in the context above.";

export const CONTINUATION_PROMPT = CONTINUATION_INSTRUCTION;

/**
 * What to send as the request's user message.
 *
 * Rebuild path: the whole restored session is rendered into this text, because it is the only
 * channel that reliably reaches the model. Checkpoint path: Cursor already holds the history
 * and ignores ours, but its checkpoint has the assistant's tool calls without their results
 * (the stream died before delivery), so the results travel here instead.
 */
export function requestActionText(
  parsed: Pick<ParsedMessages, "userText" | "toolResults" | "turns" | "pendingTurn">,
  options: { hasCheckpoint: boolean },
): string {
  if (options.hasCheckpoint) {
    if (!parsed.pendingTurn) return parsed.userText;
    const results = parsed.toolResults.map((r) => r.content).join("\n").trim();
    return results ? `${CONTINUATION_INSTRUCTION}\n\n${results}` : CONTINUATION_INSTRUCTION;
  }

  const prior = allPriorTurns(parsed);
  const transcript = renderTurnsAsText(prior);
  // A brand new conversation has nothing to restore — send the question as-is.
  if (!transcript) return parsed.userText;

  const ask = parsed.pendingTurn ? CONTINUATION_INSTRUCTION : parsed.userText;
  return `${CONTEXT_OPEN}\n${transcript}\n${CONTEXT_CLOSE}\n\n${ask}`;
}

/** @deprecated Use {@link requestActionText}. */
export function actionTextForRebuild(
  parsed: Pick<ParsedMessages, "userText" | "toolResults" | "turns" | "pendingTurn">,
): string {
  return requestActionText(parsed, { hasCheckpoint: false });
}
