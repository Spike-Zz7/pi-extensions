import type {
  DailyUsage,
  ModelUsage,
  ProviderUsage,
  TimeWindow,
  UsageAggregate,
  UsageRecord,
  UsageTotals,
} from "./types.js";

export const TIME_WINDOWS: readonly TimeWindow[] = ["today", "7", "30", "all"];

function emptyTotals(): UsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    costUSD: 0,
    messages: 0,
  };
}

function addRecord(target: UsageTotals, record: UsageRecord): void {
  target.inputTokens += record.inputTokens;
  target.outputTokens += record.outputTokens;
  target.cacheReadTokens += record.cacheReadTokens;
  target.cacheWriteTokens += record.cacheWriteTokens;
  target.totalTokens += record.totalTokens;
  target.costUSD += record.costUSD;
  target.messages++;
}

function compareUsage<T extends UsageTotals>(name: (item: T) => string): (a: T, b: T) => number {
  return (a, b) => b.totalTokens - a.totalTokens || name(a).localeCompare(name(b));
}

export function startOfLocalDay(now: number): number {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function localDayOffset(now: number, offset: number): number {
  const date = new Date(startOfLocalDay(now));
  date.setDate(date.getDate() + offset);
  return date.getTime();
}

function aggregateDaily(records: readonly UsageRecord[], window: TimeWindow, now: number): DailyUsage[] {
  if (window === "today") return [];

  if (window === "7") {
    const days: DailyUsage[] = [];
    const byTimestamp = new Map<number, DailyUsage>();
    for (let offset = -6; offset <= 0; offset++) {
      const timestamp = localDayOffset(now, offset);
      const date = new Date(timestamp);
      const day = {
        timestamp,
        label: `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`,
        totalTokens: 0,
      };
      days.push(day);
      byTimestamp.set(timestamp, day);
    }
    for (const record of records) {
      const day = byTimestamp.get(startOfLocalDay(record.timestamp));
      if (day) day.totalTokens += record.totalTokens;
    }
    return days;
  }

  if (window === "30") {
    const days: DailyUsage[] = [];
    const byTimestamp = new Map<number, DailyUsage>();
    for (let offset = -29; offset <= 0; offset++) {
      const timestamp = localDayOffset(now, offset);
      const date = new Date(timestamp);
      const day = {
        timestamp,
        label: `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`,
        totalTokens: 0,
      };
      days.push(day);
      byTimestamp.set(timestamp, day);
    }
    for (const record of records) {
      const day = byTimestamp.get(startOfLocalDay(record.timestamp));
      if (day) day.totalTokens += record.totalTokens;
    }
    return days;
  }

  if (window === "all") {
    if (records.length === 0) return [];
    const minTimestamp = Math.min(...records.map((r) => r.timestamp));
    const spanDays = Math.max(
      1,
      Math.ceil((startOfLocalDay(now) - startOfLocalDay(minTimestamp)) / 86_400_000) + 1,
    );

    if (spanDays <= 14) {
      const count = Math.max(7, spanDays);
      const days: DailyUsage[] = [];
      const byTimestamp = new Map<number, DailyUsage>();
      for (let offset = -(count - 1); offset <= 0; offset++) {
        const timestamp = localDayOffset(now, offset);
        const date = new Date(timestamp);
        const day = {
          timestamp,
          label: `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`,
          totalTokens: 0,
        };
        days.push(day);
        byTimestamp.set(timestamp, day);
      }
      for (const record of records) {
        const day = byTimestamp.get(startOfLocalDay(record.timestamp));
        if (day) day.totalTokens += record.totalTokens;
      }
      return days;
    }

    if (spanDays <= 45) {
      return aggregateDaily(records, "30", now);
    }

    if (spanDays <= 120) {
      const numWeeks = Math.min(16, Math.ceil(spanDays / 7));
      const weeks: DailyUsage[] = [];
      for (let offset = -(numWeeks - 1); offset <= 0; offset++) {
        const timestamp = localDayOffset(now, offset * 7);
        const date = new Date(timestamp);
        weeks.push({
          timestamp,
          label: `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`,
          totalTokens: 0,
        });
      }
      for (const record of records) {
        const dayTs = startOfLocalDay(record.timestamp);
        for (let i = weeks.length - 1; i >= 0; i--) {
          const w = weeks[i];
          if (w && dayTs >= w.timestamp) {
            w.totalTokens += record.totalTokens;
            break;
          }
        }
      }
      return weeks;
    }

    // Monthly bins (up to 12 months)
    const numMonths = Math.min(12, Math.ceil(spanDays / 30));
    const nowDate = new Date(now);
    const months: DailyUsage[] = [];
    for (let offset = -(numMonths - 1); offset <= 0; offset++) {
      const date = new Date(nowDate.getFullYear(), nowDate.getMonth() + offset, 1);
      const yr = String(date.getFullYear()).slice(-2);
      const mo = String(date.getMonth() + 1).padStart(2, "0");
      months.push({
        timestamp: date.getTime(),
        label: `${mo}/${yr}`,
        totalTokens: 0,
      });
    }
    for (const record of records) {
      const date = new Date(record.timestamp);
      const yr = String(date.getFullYear()).slice(-2);
      const mo = String(date.getMonth() + 1).padStart(2, "0");
      const key = `${mo}/${yr}`;
      const month = months.find((m) => m.label === key);
      if (month) month.totalTokens += record.totalTokens;
    }
    return months;
  }

  return [];
}

export function filterByTime(
  records: readonly UsageRecord[],
  window: TimeWindow,
  now = Date.now(),
): UsageRecord[] {
  if (window === "all") return [...records];

  const lowerBound =
    window === "today"
      ? startOfLocalDay(now)
      : window === "7"
        ? localDayOffset(now, -6)
        : now - 30 * 24 * 60 * 60 * 1000;
  return records.filter((record) => record.timestamp >= lowerBound && record.timestamp <= now);
}

export function aggregateUsage(
  records: readonly UsageRecord[],
  window: TimeWindow,
  now = Date.now(),
): UsageAggregate {
  const filtered = filterByTime(records, window, now);
  const totals = emptyTotals();
  const modelMap = new Map<string, ModelUsage>();
  const providerMap = new Map<string, ProviderUsage>();
  const providerModelMaps = new Map<string, Map<string, ModelUsage>>();

  for (const record of filtered) {
    addRecord(totals, record);

    // The model overview intentionally merges the same model used through
    // different accounts/providers. Provider-specific detail remains below.
    let model = modelMap.get(record.model);
    if (!model) {
      model = { ...emptyTotals(), provider: record.provider, model: record.model };
      modelMap.set(record.model, model);
    } else if (model.provider !== record.provider) {
      model.provider = "multiple";
    }
    addRecord(model, record);

    let provider = providerMap.get(record.provider);
    if (!provider) {
      provider = { ...emptyTotals(), provider: record.provider, models: [] };
      providerMap.set(record.provider, provider);
    }
    addRecord(provider, record);

    let providerModels = providerModelMaps.get(record.provider);
    if (!providerModels) {
      providerModels = new Map<string, ModelUsage>();
      providerModelMaps.set(record.provider, providerModels);
    }
    let providerModel = providerModels.get(record.model);
    if (!providerModel) {
      providerModel = { ...emptyTotals(), provider: record.provider, model: record.model };
      providerModels.set(record.model, providerModel);
    }
    addRecord(providerModel, record);
  }

  const models = [...modelMap.values()].sort(compareUsage((item) => item.model));
  const providers = [...providerMap.values()].sort(compareUsage((item) => item.provider));
  for (const provider of providers) {
    provider.models = [...(providerModelMaps.get(provider.provider)?.values() ?? [])].sort(
      compareUsage((item) => item.model),
    );
  }

  return { totals, models, providers, daily: aggregateDaily(filtered, window, now) };
}
