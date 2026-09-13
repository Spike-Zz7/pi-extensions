/**
 * What an extension-free Pi child can and cannot run on.
 *
 * These encode a measurement, not a belief. In an isolated agent directory holding one
 * `models.json` provider entry that mirrors the built-in Codex definition, plus the matching
 * **OAuth** credential under the same key:
 *
 *     pi -p --no-extensions --no-session --model openai-codex-account-4/gpt-5.6-sol …
 *     → exit 1: "No API key found for openai-codex-account-4."
 *
 * The same child pointed at the **built-in** `openai-codex` provider got past authentication.
 * Pi honours an OAuth credential only for a provider definition that declares the flow, and a
 * `models.json` entry declares none.
 *
 * That is the whole reason this module exists, and every case below is one row of it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyChildUsability,
  defaultRouteWarning,
  describeChildUsability,
  type ChildUsability,
  type SlotChildFacts,
} from "../child-usability.ts";

const facts = (over: Partial<SlotChildFacts> = {}): SlotChildFacts => ({
  slotId: "openai-codex-account-4",
  credential: "oauth",
  builtin: false,
  ...over,
});

test("the measured failure: an alias slot with an OAuth credential is NOT child-usable", () => {
  const verdict = classifyChildUsability(facts());
  assert.equal(verdict.usable, false);
  if (verdict.usable) return;
  // The reason must name the observable symptom, or nobody reading it will connect this verdict
  // to the error they actually saw.
  assert.match(verdict.reason, /No API key found/);
  assert.match(verdict.remedy, /loopback proxy|placeholder/i);
});

test("a built-in provider is usable whatever we publish — Pi owns its auth flow", () => {
  // Measured: the same bare child reached the network on built-in `openai-codex` + OAuth.
  const verdict = classifyChildUsability(facts({ slotId: "openai-codex", builtin: true }));
  assert.equal(verdict.usable, true);
  if (!verdict.usable) return;
  assert.equal(verdict.via, "builtin");
});

test("an API-key slot is usable: Pi resolves it through its own credential store", () => {
  const verdict = classifyChildUsability(facts({ slotId: "zai", credential: "api_key" }));
  assert.equal(verdict.usable, true);
  if (!verdict.usable) return;
  assert.equal(verdict.via, "api-key");
});

test("the Cursor pattern is what makes an OAuth account reachable by a child", () => {
  const verdict = classifyChildUsability(
    facts({
      slotId: "cursor",
      publishedApiKey: "cursor-proxy",
      publishedBaseUrl: "http://127.0.0.1:57387/v1",
    }),
  );
  assert.equal(verdict.usable, true);
  if (!verdict.usable) return;
  assert.equal(verdict.via, "parent-proxy");
  assert.match(verdict.note, /never leaves the parent/);
});

test("a placeholder key pointing off this machine is a misconfiguration, not a route", () => {
  // A placeholder only means anything to a proxy the parent owns. Sent upstream it authenticates
  // nothing, and it would put our routing shape on the wire.
  const verdict = classifyChildUsability(
    facts({ publishedApiKey: "cursor-proxy", publishedBaseUrl: "https://api.anthropic.com" }),
  );
  assert.equal(verdict.usable, false);
  if (verdict.usable) return;
  assert.match(verdict.reason, /does not point at this machine/);
});

test("localhost and ::1 count as this machine; a lookalike hostname does not", () => {
  for (const baseUrl of ["http://localhost:1234/v1", "http://127.0.0.1:1/v1", "http://[::1]:9/v1"]) {
    assert.equal(
      classifyChildUsability(facts({ publishedApiKey: "k", publishedBaseUrl: baseUrl })).usable,
      true,
      baseUrl,
    );
  }
  // `127.0.0.1.evil.tld` and friends must not pass by prefix matching.
  for (const baseUrl of ["http://127.0.0.1.evil.tld/v1", "http://notlocalhost/v1", "gibberish"]) {
    assert.equal(
      classifyChildUsability(facts({ publishedApiKey: "k", publishedBaseUrl: baseUrl })).usable,
      false,
      baseUrl,
    );
  }
});

test("no credential at all is reported as such, not as an auth-flow problem", () => {
  const verdict = classifyChildUsability(facts({ credential: "none" }));
  assert.equal(verdict.usable, false);
  if (verdict.usable) return;
  assert.match(verdict.reason, /No credential/i);
});

// ---------------------------------------------------------------------------
// The warning that connects this to the symptom people actually hit
// ---------------------------------------------------------------------------

test("an unusable active slot is called out, because every bare child silently reroutes", () => {
  // Pi writes the active slot into settings.json on every switch, so this is the slot a child
  // reads. When it is unusable the child does not fail — it quietly runs on another vendor.
  const warning = defaultRouteWarning("openai-codex-account-4", () =>
    classifyChildUsability(facts()),
  );
  assert.ok(warning, "an unusable default must produce a warning");
  assert.match(warning, /openai-codex-account-4/);
  assert.match(warning, /first-available provider/);
});

test("a usable active slot produces no noise", () => {
  const warning = defaultRouteWarning("openai-codex", () =>
    classifyChildUsability(facts({ slotId: "openai-codex", builtin: true })),
  );
  assert.equal(warning, undefined);
});

test("no active slot, or an unknown one, is silence rather than a guess", () => {
  assert.equal(defaultRouteWarning(undefined, () => undefined), undefined);
  assert.equal(defaultRouteWarning("mystery", () => undefined), undefined);
});

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

test("the report puts unusable slots first and is otherwise stable", () => {
  const verdicts: ChildUsability[] = [
    classifyChildUsability(facts({ slotId: "zai", credential: "api_key" })),
    classifyChildUsability(facts({ slotId: "openai-codex-account-4" })),
    classifyChildUsability(facts({ slotId: "anthropic", builtin: true })),
    classifyChildUsability(facts({ slotId: "kimi-coding-account-2" })),
  ];
  const lines = describeChildUsability(verdicts);
  // Problems first, so the thing needing attention is not buried under healthy rows.
  assert.match(lines[0], /anthropic-account|kimi-coding-account-2|openai-codex-account-4/);
  assert.match(lines[0], /NOT usable/);
  assert.match(lines[1], /NOT usable/);
  assert.equal(lines.filter((l) => /NOT usable/.test(l)).length, 2);
  // Same input, same output — a report that reorders itself cannot be diffed between runs.
  assert.deepEqual(describeChildUsability(verdicts), lines);
  assert.deepEqual(describeChildUsability([...verdicts].reverse()), lines);
});
