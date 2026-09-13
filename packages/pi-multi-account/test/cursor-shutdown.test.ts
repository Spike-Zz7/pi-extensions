import assert from "node:assert/strict";
import test from "node:test";
import { registerSessionLifecycleHooks } from "../cursor/session-lifecycle.ts";

test("session shutdown cleans the session and stops the process-scoped Cursor proxy", () => {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const cleaned: string[] = [];
  let stopped = 0;
  const pi = { on: (name: string, handler: (...args: any[]) => unknown) => handlers.set(name, handler) } as any;
  const ctx = { sessionManager: { getSessionId: () => "test-session", getLeafId: () => "leaf" } };

  registerSessionLifecycleHooks(pi, {
    cleanupSessionState: (sessionId) => cleaned.push(sessionId),
    stopProxy: () => { stopped += 1; },
  });
  handlers.get("session_shutdown")?.({}, ctx);

  assert.deepEqual(cleaned, ["test-session"]);
  assert.equal(stopped, 1);
});
