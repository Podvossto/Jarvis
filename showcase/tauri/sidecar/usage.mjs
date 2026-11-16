// The usage tracker's pure pieces: the per-request lines in usage.jsonl (written by sidekick.mjs, token counts only)
// are summarised by day and by provider+model for the panel's Usage page, and into one short line the model sees with
// every request, so questions about usage are answerable by voice. Run: npm test
const DAY = 864e5;
const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : `${n}`);

/** The lines of usage.jsonl -> { today: { requests, in, out, rows }, week: [{ day, requests, in, out }] }.
 *  in is everything the model read (input + cache read + cache write), out what it wrote. Rows are per provider+model
 *  with requests today, busiest first; old lines without a provider count as "unknown". Bad lines are skipped. */
export function summarise(lines, { now = Date.now() } = {}) {
  const today = new Date(now).toDateString();
  const days = new Map(), rows = new Map();
  let requests = 0, tin = 0, tout = 0;
  for (const l of lines) {
    let r; try { r = JSON.parse(l); } catch { continue; }
    if (typeof r.t !== 'number' || typeof r.in !== 'number' || typeof r.out !== 'number') continue;
    const ain = r.in + (r.cacheRead ?? 0) + (r.cacheWrite ?? 0), use = { requests: 1, in: ain, out: r.out };
    const day = new Date(r.t).toDateString();
    if (day === today) {
      requests++; tin += ain; tout += r.out;
      const key = `${r.provider ?? 'unknown'}\n${r.model ?? '?'}`, row = rows.get(key) ?? { provider: r.provider ?? 'unknown', model: r.model ?? '?', requests: 0, in: 0, out: 0 };
      row.requests++; row.in += ain; row.out += r.out; rows.set(key, row);
    }
    const bucket = days.get(day) ?? { requests: 0, in: 0, out: 0 };
    bucket.requests++; bucket.in += ain; bucket.out += r.out; days.set(day, bucket);
  }
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now - (6 - i) * DAY), day = d.toDateString();
    return { day, ...(days.get(day) ?? { requests: 0, in: 0, out: 0 }) };
  });
  return { today: { requests, in: tin, out: tout, rows: [...rows.values()].sort((a, b) => b.requests - a.requests) }, week };
}

/** What the model sees with every request: today's totals, and where this conversation sits in its context budget.
 *  '' on a quiet day: the line is only there to be asked about. */
export function usageLine(usage, context) {
  if (!usage?.requests) return '';
  const at = context?.tokens && context?.budget ? `; this conversation is at ${fmt(context.tokens)} of the ${fmt(context.budget)}-token context budget.` : '.';
  return `Usage today: ${usage.requests} request${usage.requests === 1 ? '' : 's'}, ${fmt(usage.in + usage.out)} tokens (${fmt(usage.in)} in, ${fmt(usage.out)} out)${at}`;
}
