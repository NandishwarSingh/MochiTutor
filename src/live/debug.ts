// A small ring buffer of what happened in the Live call, so a lesson that
// goes quiet can be explained afterwards. Readable from the console as
// __mochiLog, and by the end-to-end scripts.

export interface LogEntry {
  /** ms since the page loaded */
  t: number;
  kind: string;
  detail?: string;
}

const MAX = 500;
const entries: LogEntry[] = [];

export function logEvent(kind: string, detail?: string): void {
  entries.push({ t: Math.round(performance.now()), kind, ...(detail ? { detail: detail.slice(0, 160) } : {}) });
  if (entries.length > MAX) entries.splice(0, entries.length - MAX);
}

export function eventLog(): readonly LogEntry[] {
  return entries;
}

if (typeof window !== "undefined") (window as unknown as { __mochiLog: readonly LogEntry[] }).__mochiLog = entries;
