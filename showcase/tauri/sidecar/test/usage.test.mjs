// The usage tracker: one jsonl line per request is summarised by day and by provider+model for the panel's Usage
// page, and into one short line the model sees so questions about usage are answerable by voice. Run: npm test
import assert from 'node:assert/strict';
import { summarise, usageLine } from '../usage.mjs';

const NOON = new Date('2026-11-17T12:00:00').getTime();       // today, for the fixed clock
const YESTERDAY = NOON - 864e5, THREE_BACK = NOON - 3 * 864e5;
const line = (t, rec) => JSON.stringify({ t, in: 0, cacheRead: 0, cacheWrite: 0, out: 0, calls: 1, tools: 0, model: 'glm-5.3-flash', provider: 'zai', ...rec });

// ---- the day and provider split
{
  const lines = [
    line(NOON, { in: 900, cacheRead: 100, cacheWrite: 50, out: 30 }),                       // today, zai
    line(NOON, { in: 800, out: 120, provider: 'zai', model: 'glm-5.3-flash' }),             // today, zai again
    line(NOON, { in: 500, out: 200, provider: 'anthropic', model: 'claude-sonnet-5-5' }),   // today, another provider
    line(NOON, { in: 10, out: 5, model: 'local-model', provider: undefined }),              // old line without a provider
    line(YESTERDAY, { in: 700, out: 70 }),                                                  // yesterday
    line(THREE_BACK, { in: 60, out: 40 }),                                                  // three days back
    'not json at all',                                                                      // a bad line is skipped
  ];
  const s = summarise(lines, { now: NOON });
  assert.equal(s.today.requests, 4, 'today counts every request');
  // in is everything the model read: input + cache read + cache write.
  assert.equal(s.today.in, 900 + 100 + 50 + 800 + 500 + 10);
  assert.equal(s.today.out, 30 + 120 + 200 + 5);
  assert.deepEqual(s.today.rows.map((r) => [r.provider, r.model, r.requests]),
    [['zai', 'glm-5.3-flash', 2], ['anthropic', 'claude-sonnet-5-5', 1], ['unknown', 'local-model', 1]], 'rows by provider+model, busiest first, ties in first-seen order');
  assert.equal(s.week.length, 7, 'a week of days, zero-filled');
  assert.equal(s.week[6].requests, 4, 'today is last');
  assert.equal(s.week[5].requests, 1, 'yesterday');
  assert.equal(s.week[3].requests, 1, 'three days back');
  assert.equal(s.week[0].requests, 0, 'six days back is empty');
}

// ---- the day turns over at midnight
{
  const DAWN = new Date('2026-11-17T00:00:00').getTime();
  const s = summarise([line(DAWN - 2000, { in: 100 }), line(DAWN + 60_000, { in: 5 })], { now: DAWN + 120_000 });
  assert.equal(s.today.requests, 1, 'only today\'s requests are today');
  assert.equal(s.week[6].requests, 1, 'the new day is last');
  assert.equal(s.week[5].requests, 1, 'yesterday keeps its own');
}

// ---- empty and quiet
assert.deepEqual(summarise([], { now: NOON }).today, { requests: 0, in: 0, out: 0, rows: [] });
assert.deepEqual(summarise(['garbage', '{}'], { now: NOON }).today.rows, [], 'lines without token counts are skipped');

// ---- the line the model sees
assert.equal(usageLine(null), '', 'nothing used today: no line');
assert.equal(usageLine({ requests: 0, in: 0, out: 0 }), '', 'still no line');
assert.match(usageLine({ requests: 14, in: 43100, out: 2100 }), /^Usage today: 14 requests, 45\.2k tokens \(43\.1k in, 2\.1k out\)\.$/);
assert.match(usageLine({ requests: 3, in: 812, out: 45 }, { tokens: 38000, budget: 72000 }),
  /; this conversation is at 38k of the 72k-token context budget\.$/, 'the context comes along when known');
assert.match(usageLine({ requests: 1, in: 800, out: 40 }), /840 tokens/, 'small counts stay plain numbers');

// ---- the wiring, read off the source like prompt.test does: every request records its provider, the panel gets the
// split, the model gets the line, and Claude's quota rides along when the Claude Code route reports it.
import { readFileSync } from 'node:fs';
const side = readFileSync(new URL('../sidekick.mjs', import.meta.url), 'utf8');
assert.match(side, /const use = \{ t: Date\.now\(\), provider: config\.provider, model: config\.model/, 'every usage line records its provider');
assert.match(side, /usageToday\.in \+= rec\.in \+ rec\.cacheRead \+ rec\.cacheWrite/, "today's in and out are kept apart");
assert.match(side, /usage: usageState\(\)/, 'the panel gets the usage split');
assert.match(side, /refreshQuota\(\);/, 'the panel push refreshes the quota');
assert.match(side, /readClaudeCodeUsage\(\)\.then/, 'Claude quota is read when there is one');
assert.match(side, /\$\{usageNow\(\)\}/, 'the model sees the usage line');
const about = readFileSync(new URL('../about.mjs', import.meta.url), 'utf8');
assert.match(about, /Usage: /, 'the manual mentions the Usage page');

console.log('usage tests: passed');
