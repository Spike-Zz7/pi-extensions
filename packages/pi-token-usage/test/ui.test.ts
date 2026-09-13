import assert from "node:assert/strict";
import test from "node:test";
import { aggregateUsage } from "../src/aggregate.js";
import type { ScanDiagnostics, UsageRecord } from "../src/types.js";
import { buildReportLines } from "../src/ui.js";

const diagnostics: ScanDiagnostics = {
  filesFound: 2,
  filesRead: 2,
  fileErrors: 0,
  malformedLines: 1,
  missingIds: 0,
  invalidTimestamps: 0,
};

const records: UsageRecord[] = [
  {
    id: "1",
    timestamp: Date.now(),
    provider: "provider",
    model: "model",
    inputTokens: 1_000,
    outputTokens: 200,
    cacheReadTokens: 300,
    cacheWriteTokens: 0,
    totalTokens: 1_500,
    costUSD: 1.25,
  },
  {
    id: "2",
    timestamp: Date.now(),
    provider: "zero-provider",
    model: "zero-model",
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    costUSD: 0,
  },
];

test("renders non-zero usage as labeled bars within the requested width", () => {
  const lines = buildReportLines(aggregateUsage(records, "all"), "all", diagnostics, 60);
  const text = lines.join("\n");
  assert.match(text, /\[ All Time \]/);
  assert.match(text, /By Model/);
  assert.match(text, /By Provider/);
  assert.match(text, /█+/);
  assert.match(text, /1\.5K/);
  assert.match(text, /Skipped: 1 malformed line/);
  assert.doesNotMatch(text, /zero-model|zero-provider|\$0\.00/);
  assert.doesNotMatch(text, /├─|└─/);
  assert.ok(lines.every((line) => line.length <= 60));
});

test("renders seven local days as slim columns across the x-axis", () => {
  const lines = buildReportLines(aggregateUsage(records, "7"), "7", diagnostics, 100);
  const text = lines.join("\n");
  assert.match(text, /Daily Trend/);
  assert.equal(aggregateUsage(records, "7").daily.length, 7);
  assert.match(text, /\d{2}\/\d{2}/);
  assert.match(text, /█+/);
  assert.ok(lines.every((line) => line.length <= 100));
});
