// All dates and times are shown in New York time.
export const TIME_ZONE = 'America/New_York';

const dateTimeFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const isoDateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

// Calendar date string (YYYY-MM-DD) rendered without time zone shifting.
export function date(value) {
  if (!value) return '';
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return String(value);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
}

export function dateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${dateTimeFmt.format(d)} ET`;
}

// Today's calendar date in New York as YYYY-MM-DD.
export function todayISO(now = new Date()) {
  return isoDateFmt.format(now);
}

// Whole days from today (New York) to a YYYY-MM-DD date; negative when it has passed.
export function daysUntil(isoDate, today = todayISO()) {
  if (!isoDate) return null;
  const a = Date.parse(`${today}T00:00:00Z`);
  const b = Date.parse(`${String(isoDate).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

export function formatPhone(digits) {
  const d = String(digits || '').replace(/\D/g, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)} ${d.slice(6)}` : String(digits || '');
}
