export interface UsageRecord {
  id: string;
  timestamp: number;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUSD: number;
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUSD: number;
  messages: number;
}

export interface ModelUsage extends UsageTotals {
  provider: string;
  model: string;
}

export interface ProviderUsage extends UsageTotals {
  provider: string;
  models: ModelUsage[];
}

export interface DailyUsage {
  timestamp: number;
  label: string;
  totalTokens: number;
}

export interface UsageAggregate {
  totals: UsageTotals;
  models: ModelUsage[];
  providers: ProviderUsage[];
  daily: DailyUsage[];
}

export type TimeWindow = "today" | "7" | "30" | "all";

export interface ScanDiagnostics {
  filesFound: number;
  filesRead: number;
  fileErrors: number;
  malformedLines: number;
  missingIds: number;
  invalidTimestamps: number;
}

export interface ScanResult {
  records: UsageRecord[];
  diagnostics: ScanDiagnostics;
}
