import { createReadStream } from "node:fs";
import { appendFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline";
import type { ScanDiagnostics, ScanResult, UsageRecord } from "./types.js";

const DEFAULT_CONCURRENCY = 8;

type UnknownObject = Record<string, unknown>;

interface FileScanResult {
  records: UsageRecord[];
  malformedLines: number;
  missingIds: number;
  invalidTimestamps: number;
  failed: boolean;
}

function isObject(value: unknown): value is UnknownObject {
  return typeof value === "object" && value !== null;
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function nameOrUnknown(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0 ? value : "unknown";
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseUsageEntry(
  parsed: unknown,
): { record?: UsageRecord; missingId?: true; invalidTimestamp?: true } {
  if (!isObject(parsed) || parsed.type !== "message" || !isObject(parsed.message)) return {};
  const message = parsed.message;
  if (message.role !== "assistant" || !isObject(message.usage)) return {};

  if (typeof parsed.id !== "string" || parsed.id.length === 0) return { missingId: true };
  const timestamp = parseTimestamp(parsed.timestamp);
  if (timestamp === undefined) return { invalidTimestamp: true };

  const usage = message.usage;
  const cost = isObject(usage.cost) ? usage.cost : undefined;
  return {
    record: {
      id: parsed.id,
      timestamp,
      provider: nameOrUnknown(message.provider),
      model: nameOrUnknown(message.model),
      inputTokens: nonNegativeNumber(usage.input),
      outputTokens: nonNegativeNumber(usage.output),
      cacheReadTokens: nonNegativeNumber(usage.cacheRead),
      cacheWriteTokens: nonNegativeNumber(usage.cacheWrite),
      totalTokens: nonNegativeNumber(usage.totalTokens),
      costUSD: nonNegativeNumber(cost?.total),
    },
  };
}

async function findJsonlFiles(directory: string, signal?: AbortSignal): Promise<string[]> {
  const files: string[] = [];

  async function visit(current: string): Promise<void> {
    signal?.throwIfAborted();
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (current === directory && code === "ENOENT") return;
      throw error;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      signal?.throwIfAborted();
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
    }
  }

  await visit(directory);
  return files.sort((a, b) => a.localeCompare(b));
}

async function scanFile(path: string, signal?: AbortSignal): Promise<FileScanResult> {
  const records: UsageRecord[] = [];
  let malformedLines = 0;
  let missingIds = 0;
  let invalidTimestamps = 0;
  const stream = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of lines) {
      signal?.throwIfAborted();
      if (!line.includes('"usage"')) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        malformedLines++;
        continue;
      }

      const result = parseUsageEntry(parsed);
      if (result.missingId) missingIds++;
      else if (result.invalidTimestamp) invalidTimestamps++;
      else if (result.record) records.push(result.record);
    }
    return { records, malformedLines, missingIds, invalidTimestamps, failed: false };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { records: [], malformedLines, missingIds, invalidTimestamps, failed: true };
  } finally {
    lines.close();
    stream.destroy();
  }
}

export function getAgentDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
}

export function getSessionsDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return join(getAgentDirectory(env), "sessions");
}

export function getTokenLedgerPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(getAgentDirectory(env), "token-usage.jsonl");
}

export async function readTokenLedger(
  ledgerPath = getTokenLedgerPath(),
  signal?: AbortSignal,
): Promise<{ records: UsageRecord[]; malformedLines: number }> {
  const records: UsageRecord[] = [];
  let malformedLines = 0;
  let stream: ReturnType<typeof createReadStream> | undefined;
  try {
    stream = createReadStream(ledgerPath, { encoding: "utf8" });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of lines) {
      signal?.throwIfAborted();
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as Partial<UsageRecord>;
        if (
          typeof parsed.id === "string" &&
          parsed.id.length > 0 &&
          typeof parsed.timestamp === "number" &&
          Number.isFinite(parsed.timestamp) &&
          typeof parsed.provider === "string" &&
          typeof parsed.model === "string"
        ) {
          records.push({
            id: parsed.id,
            timestamp: parsed.timestamp,
            provider: parsed.provider,
            model: parsed.model,
            inputTokens: nonNegativeNumber(parsed.inputTokens),
            outputTokens: nonNegativeNumber(parsed.outputTokens),
            cacheReadTokens: nonNegativeNumber(parsed.cacheReadTokens),
            cacheWriteTokens: nonNegativeNumber(parsed.cacheWriteTokens),
            totalTokens: nonNegativeNumber(parsed.totalTokens),
            costUSD: nonNegativeNumber(parsed.costUSD),
          });
        } else {
          malformedLines++;
        }
      } catch {
        malformedLines++;
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      if (signal?.aborted) throw error;
    }
  } finally {
    stream?.destroy();
  }
  return { records, malformedLines };
}

export async function writeTokenLedger(
  records: UsageRecord[],
  ledgerPath = getTokenLedgerPath(),
  signal?: AbortSignal,
): Promise<void> {
  const sorted = [...records].sort(
    (a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id),
  );
  const tempPath = `${ledgerPath}.tmp.${process.pid}.${Date.now()}`;
  const content = sorted.map((record) => `${JSON.stringify(record)}\n`).join("");
  signal?.throwIfAborted();
  await writeFile(tempPath, content, { encoding: "utf8", mode: 0o600 });
  try {
    await rename(tempPath, ledgerPath);
  } catch (err) {
    try {
      await unlink(tempPath);
    } catch {}
    throw err;
  }
}

export async function appendLedgerRecord(
  record: UsageRecord,
  ledgerPath = getTokenLedgerPath(),
): Promise<void> {
  try {
    await appendFile(ledgerPath, `${JSON.stringify(record)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch {
    // Non-fatal
  }
}

export async function scanSessions(
  sessionsDirectory = getSessionsDirectory(),
  options: {
    concurrency?: number;
    signal?: AbortSignal;
    syncLedger?: boolean;
    ledgerPath?: string;
  } = {},
): Promise<ScanResult> {
  const files = await findJsonlFiles(sessionsDirectory, options.signal);
  const diagnostics: ScanDiagnostics = {
    filesFound: files.length,
    filesRead: 0,
    fileErrors: 0,
    malformedLines: 0,
    missingIds: 0,
    invalidTimestamps: 0,
  };
  const records: UsageRecord[] = [];
  const seen = new Set<string>();
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? DEFAULT_CONCURRENCY));

  // Process bounded batches concurrently, then merge in sorted file order so
  // duplicate-ID selection is deterministic regardless of I/O completion order.
  for (let start = 0; start < files.length; start += concurrency) {
    options.signal?.throwIfAborted();
    const batch = files.slice(start, start + concurrency);
    const results = await Promise.all(batch.map((file) => scanFile(file, options.signal)));

    for (const result of results) {
      diagnostics.malformedLines += result.malformedLines;
      diagnostics.missingIds += result.missingIds;
      diagnostics.invalidTimestamps += result.invalidTimestamps;
      if (result.failed) {
        diagnostics.fileErrors++;
        continue;
      }
      diagnostics.filesRead++;
      for (const record of result.records) {
        if (seen.has(record.id)) continue;
        seen.add(record.id);
        records.push(record);
      }
    }
  }

  // Reconcile with the token usage ledger
  if (options.syncLedger !== false) {
    const isDefaultSessions = sessionsDirectory === getSessionsDirectory();
    const defaultLedgerPath = isDefaultSessions
      ? getTokenLedgerPath()
      : (basename(sessionsDirectory) === "sessions"
          ? join(dirname(sessionsDirectory), "token-usage.jsonl")
          : undefined);
    const ledgerPath = options.ledgerPath ?? defaultLedgerPath;

    if (ledgerPath) {
      const ledgerResult = await readTokenLedger(ledgerPath, options.signal);
      diagnostics.malformedLines += ledgerResult.malformedLines;

      let hasNewFromLedger = false;
      for (const record of ledgerResult.records) {
        if (seen.has(record.id)) continue;
        seen.add(record.id);
        records.push(record);
        hasNewFromLedger = true;
      }

      // If there were records from sessions that aren't yet in ledger, or new records, write back the full union
      if (records.length > 0 && (records.length !== ledgerResult.records.length || hasNewFromLedger)) {
        try {
          await writeTokenLedger(records, ledgerPath, options.signal);
        } catch {
          // Non-fatal if ledger cannot be written
        }
      }
    }
  }

  return { records, diagnostics };
}
