export interface Window {
  start: Date;
  end: Date;
}
const DAY = 86_400_000;

export function windowFor(now: Date, pastDays: number, futureDays: number): Window {
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { start: new Date(dayStart - pastDays * DAY), end: new Date(dayStart + futureDays * DAY + DAY - 1000) };
}

const pad = (n: number): string => String(n).padStart(2, "0");
function fmt(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

export function toDavTimeRange(w: Window): { start: string; end: string } {
  return { start: fmt(w.start), end: fmt(w.end) };
}
