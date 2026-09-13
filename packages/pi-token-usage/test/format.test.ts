import assert from "node:assert/strict";
import test from "node:test";
import { formatCost, formatTokens, formatWindow } from "../src/format.js";

test("formats token magnitudes", () => {
  assert.equal(formatTokens(950), "950");
  assert.equal(formatTokens(12_400), "12.4K");
  assert.equal(formatTokens(8_300_000), "8.3M");
  assert.equal(formatTokens(1_200_000_000), "1.2B");
});

test("formats costs and windows", () => {
  assert.equal(formatCost(12.345), "$12.35");
  assert.equal(formatWindow("7"), "Last 7 Days");
  assert.equal(formatWindow("30"), "Last 30 Days");
});
