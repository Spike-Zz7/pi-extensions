import assert from "node:assert/strict";
import test from "node:test";
import { aggregateUsage, filterByTime, startOfLocalDay } from "../src/aggregate.js";
import type { UsageRecord } from "../src/types.js";

function record(
  id: string,
  timestamp: number,
  provider = "provider-a",
  model = "model-a",
  totalTokens = 10,
): UsageRecord {
  return {
    id,
    timestamp,
    provider,
    model,
    inputTokens: totalTokens - 2,
    outputTokens: 2,
    cacheReadTokens: 1,
    cacheWriteTokens: 0,
    totalTokens,
    costUSD: 0.1,
  };
}

test("today and the seven-day view use local calendar-day boundaries", () => {
  const now = new Date(2025, 4, 10, 12, 0, 0).getTime();
  const midnight = startOfLocalDay(now);
  const records = [
    record("before-midnight", midnight - 1),
    record("midnight", midnight),
    record("now", now),
    record("future", now + 1),
    record("seven-days", now - 7 * 86_400_000),
    record("too-old", now - 7 * 86_400_000 - 1),
  ];

  assert.deepEqual(filterByTime(records, "today", now).map((item) => item.id), ["midnight", "now"]);
  assert.deepEqual(filterByTime(records, "7", now).map((item) => item.id), [
    "before-midnight",
    "midnight",
    "now",
  ]);
  assert.equal(filterByTime(records, "all", now).length, records.length);

  const aggregate = aggregateUsage(records, "7", now);
  assert.equal(aggregate.daily.length, 7);
  assert.equal(aggregate.daily.at(-1)?.totalTokens, 20);
  assert.equal(aggregate.daily.at(-2)?.totalTokens, 10);
});

test("merges the same model across providers while preserving provider detail", () => {
  const now = Date.now();
  const aggregate = aggregateUsage(
    [
      record("1", now, "beta", "shared", 10),
      record("2", now, "alpha", "shared", 30),
      record("3", now, "alpha", "other", 20),
    ],
    "all",
    now,
  );

  assert.equal(aggregate.totals.totalTokens, 60);
  assert.equal(aggregate.totals.messages, 3);
  assert.deepEqual(
    aggregate.models.map((item) => `${item.provider}/${item.model}:${item.totalTokens}`),
    ["multiple/shared:40", "alpha/other:20"],
  );
  assert.deepEqual(
    aggregate.providers.map((item) => `${item.provider}:${item.totalTokens}`),
    ["alpha:50", "beta:10"],
  );
  assert.deepEqual(aggregate.providers[0]?.models.map((item) => item.model), ["shared", "other"]);
  assert.deepEqual(aggregate.providers[1]?.models.map((item) => item.model), ["shared"]);
  assert.ok(aggregate.daily.length > 0, "trend bins are produced for the all view");
  assert.equal(aggregateUsage([], "today", now).daily.length, 0, "no trend bins for today");
  assert.equal(aggregateUsage([], "30", now).daily.length, 30, "30 daily bins for 30 view");
});
