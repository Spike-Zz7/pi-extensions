import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getSessionsDirectory, scanSessions } from "../src/scanner.js";

function line(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

function assistant(id: string | undefined, timestamp: string, overrides: Record<string, unknown> = {}) {
  return {
    type: "message",
    ...(id === undefined ? {} : { id }),
    timestamp,
    message: {
      role: "assistant",
      provider: "anthropic",
      model: "claude-test",
      usage: {
        input: 10,
        output: 2,
        cacheRead: 3,
        cacheWrite: 4,
        totalTokens: 19,
        cost: { total: 0.25 },
      },
      ...overrides,
    },
  };
}

test("resolves the configured and default sessions directories", () => {
  assert.equal(getSessionsDirectory({ PI_CODING_AGENT_DIR: "/custom/pi" }), "/custom/pi/sessions");
  assert.match(getSessionsDirectory({}), /\.pi\/agent\/sessions$/);
});

test("scans line-by-line, validates records, and deduplicates IDs across files", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-token-usage-"));
  const nested = join(root, "old-project");
  await mkdir(nested);
  const today = new Date().toISOString();
  const first = join(root, "a.jsonl");
  const second = join(nested, "b.jsonl");

  const userEntry = {
    type: "message",
    id: "user-1",
    timestamp: today,
    message: { role: "user", usage: { totalTokens: 999 } },
  };
  const noUsage = {
    type: "message",
    id: "assistant-no-usage",
    timestamp: today,
    message: { role: "assistant" },
  };
  const unknownFields = assistant("def", today, {
    provider: undefined,
    model: "",
    usage: { input: -1, output: undefined, totalTokens: 7, cost: {} },
  });

  try {
    await writeFile(
      first,
      line(assistant("abc", today)) +
        line(userEntry) +
        line(noUsage) +
        '{ broken json "usage"\n' +
        line(assistant(undefined, today)),
    );
    await writeFile(
      second,
      line(assistant("abc", today, { usage: { totalTokens: 999_999 } })) +
        line(unknownFields) +
        line(assistant("bad-time", "not-a-date")),
    );
    // A stale file mtime must not hide a message with a current entry timestamp.
    await utimes(first, new Date("2000-01-01T00:00:00Z"), new Date("2000-01-01T00:00:00Z"));

    const result = await scanSessions(root, { concurrency: 2 });
    assert.equal(result.records.length, 2);
    assert.deepEqual(result.records.map((record) => record.id), ["abc", "def"]);
    assert.equal(result.records[0]?.totalTokens, 19, "lexically first duplicate wins");
    assert.deepEqual(result.records[1], {
      id: "def",
      timestamp: Date.parse(today),
      provider: "unknown",
      model: "unknown",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 7,
      costUSD: 0,
    });
    assert.equal(result.diagnostics.filesFound, 2);
    assert.equal(result.diagnostics.filesRead, 2);
    assert.equal(result.diagnostics.malformedLines, 1);
    assert.equal(result.diagnostics.missingIds, 1);
    assert.equal(result.diagnostics.invalidTimestamps, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("returns an empty result when the sessions directory does not exist", async () => {
  const root = join(tmpdir(), `missing-pi-sessions-${Date.now()}`);
  const result = await scanSessions(root);
  assert.deepEqual(result.records, []);
  assert.equal(result.diagnostics.filesFound, 0);
});

test("reconciles records with token-usage.jsonl ledger without duplicates", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-token-ledger-"));
  const sessionsDir = join(root, "sessions");
  await mkdir(sessionsDir);
  const ledgerPath = join(root, "token-usage.jsonl");

  const today = new Date().toISOString();
  // Session file has message 1
  await writeFile(
    join(sessionsDir, "session.jsonl"),
    line(assistant("msg-1", today, { usage: { totalTokens: 100 } })),
  );

  // Pre-existing ledger (e.g. from another synced machine) has msg-1 (duplicate) and msg-2 (remote-only)
  await writeFile(
    ledgerPath,
    line({
      id: "msg-1",
      timestamp: Date.now(),
      provider: "anthropic",
      model: "claude-test",
      totalTokens: 100,
    }) +
      line({
        id: "msg-2",
        timestamp: Date.now(),
        provider: "openai",
        model: "gpt-4o",
        totalTokens: 250,
      }),
  );

  try {
    const result = await scanSessions(sessionsDir, { ledgerPath });
    assert.equal(result.records.length, 2);
    assert.ok(result.records.some((r) => r.id === "msg-1"));
    assert.ok(result.records.some((r) => r.id === "msg-2"));

    const { readTokenLedger } = await import("../src/scanner.js");
    const { records: ledgerRecords } = await readTokenLedger(ledgerPath);
    assert.equal(ledgerRecords.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
