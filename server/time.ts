// Simulated-clock helpers. All sim timestamps are ISO strings; business rules are evaluated in IST.
const IST_OFFSET_MIN = 330;

export function addHours(iso: string, hours: number): string {
  return new Date(new Date(iso).getTime() + hours * 3600_000).toISOString();
}
export function hoursBetween(aIso: string, bIso: string): number {
  return (new Date(bIso).getTime() - new Date(aIso).getTime()) / 3600_000;
}
/** Hour of day (0-23, fractional) in IST. */
export function istHour(iso: string): number {
  const d = new Date(iso);
  const mins = (d.getUTCHours() * 60 + d.getUTCMinutes() + IST_OFFSET_MIN) % 1440;
  return mins / 60;
}
export function istDayIndex(iso: string): number {
  return Math.floor((new Date(iso).getTime() + IST_OFFSET_MIN * 60_000) / 86_400_000);
}
export function isWeekendIST(iso: string): boolean {
  const d = new Date(new Date(iso).getTime() + IST_OFFSET_MIN * 60_000);
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}
/** Next sim time at or after `iso` whose IST hour is `hour` (0-23). */
export function nextIstHour(iso: string, hour: number): string {
  const t = new Date(iso).getTime();
  const shifted = t + IST_OFFSET_MIN * 60_000;
  const dayStart = Math.floor(shifted / 86_400_000) * 86_400_000;
  let target = dayStart + hour * 3600_000;
  if (target <= shifted) target += 86_400_000;
  return new Date(target - IST_OFFSET_MIN * 60_000).toISOString();
}
export function fmtIST(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}
export function rupees(paise: number): string {
  return '₹' + (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}
