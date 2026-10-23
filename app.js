'use strict';

// ---------------------------------------------------------------------------
// Data
// Everything lives in one object, saved by `store`. To share live between two
// phones later, swap store.load/save for a backend (see README).
// ---------------------------------------------------------------------------

const VERSION = 8; // shown in Settings; keep in step with CACHE in sw.js
const KEY = 'sento:v1';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const $ = (s, el = document) => el.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const freshState = () => ({ v: 1, names: { a: '', b: 'Moka' }, calendar: { url: '', key: '' }, goal: { perMonth: 4 }, sentos: [], visits: [], deleted: [] });

const store = {
  load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && s.v === 1) return { ...freshState(), ...s };
    } catch {}
    return freshState();
  },
  save(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); }
    catch { toast('Couldn’t save on this device'); }
  },
};

let S = store.load();
let tab = 'go';

const commit = () => { store.save(S); render(); scheduleSync(); };
const touch = rec => { rec.u = Date.now(); markDirty(rec.id, rec.u); return rec; };
const remove = (list, id) => { S.deleted.push(id); markDirty(id, Date.now()); return list.filter(r => r.id !== id); };

// Settings-like records synced as a whole (each has S[id] and its edit time S[id + 'U']).
const SINGLETONS = ['names', 'calendar', 'goal'];

const sentoOf = id => S.sentos.find(s => s.id === id);
const visitOf = id => S.visits.find(v => v.id === id);
const byName = (x, y) => x.name.localeCompare(y.name);
const pastVisits = () => S.visits.slice().sort((x, y) => y.date.localeCompare(x.date) || (y.u || 0) - (x.u || 0));

// ---------------------------------------------------------------------------
// Dates & times
// ---------------------------------------------------------------------------

const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => ymd(new Date());
const parseDay = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
// Whole days between two YYYY-MM-DD strings, immune to DST.
const dayNum = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) / 864e5; };
const daysBetween = (a, b) => dayNum(b) - dayNum(a);
const mins = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const hhmm = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

function dayWord(date) {
  const n = daysBetween(today(), date);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  const d = parseDay(date);
  if (n > 1 && n < 7) return DAYS_LONG[d.getDay()];
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

const lastWord = date => {
  const w = dayWord(date);
  return w === 'Today' || w === 'Yesterday' ? w.toLowerCase() : w;
};

// Weekly schedule, index 0 = Sunday: { open: '15:00', close: '00:00' } or null when closed.
// Returns null if hours were never set. Older favourites stored one open/close plus closed days.
function weekOf(s) {
  if (Array.isArray(s.week)) return s.week;
  if (!s.open || !s.close) return null;
  return DAYS.map((_, d) => s.closed?.includes(d) ? null : { open: s.open, close: s.close });
}

// Opening/closing on a weekday in minutes since midnight; a close at or before opening means after midnight.
function hoursOn(s, dow) {
  const day = weekOf(s)?.[dow];
  if (!day?.open || !day?.close) return null;
  const open = mins(day.open);
  let close = mins(day.close);
  if (close <= open) close += 1440;
  return { open, close };
}

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon → Sun

// "Mon–Fri 15:00–00:00 · Sat–Sun 14:00–00:00 · Closed Thu"
function weekSummary(s) {
  const week = weekOf(s);
  if (!week) return 'Hours not set';
  const runs = [];
  for (const d of WEEK_ORDER) {
    const key = week[d] ? `${week[d].open}–${week[d].close}` : '';
    const last = runs[runs.length - 1];
    if (last && last.key === key) last.days.push(d);
    else runs.push({ key, days: [d] });
  }
  const span = days => days.length > 2 ? `${DAYS[days[0]]}–${DAYS[days[days.length - 1]]}` : days.map(d => DAYS[d]).join(', ');
  const open = runs.filter(r => r.key);
  const closed = WEEK_ORDER.filter(d => !week[d]);
  const parts = new Set(open.map(r => r.key)).size === 1
    ? [open[0].key]
    : open.map(r => `${span(r.days)} ${r.key}`);
  if (closed.length) parts.push(`Closed ${closed.map(d => DAYS[d]).join(', ')}`);
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Special baths (e.g. Kosugiyu's monthly おふろカレンダー)
// Stored per sento as s.specials = [{ id, name, emoji, color, from, to }], dates YYYY-MM-DD.
// ---------------------------------------------------------------------------

// Emoji + colour picked from the bath's name; first match wins.
const SPECIAL_STYLES = [
  [/ミルク|牛乳|milk/i, '🥛', '#8DB8E8'],
  [/ほうじ茶|緑茶|抹茶|茶|tea/i, '🍵', '#B08A64'],
  [/ラベンダー|lavender/i, '💜', '#9B8FD6'],
  [/カモミール|chamomile/i, '🌼', '#7DBE8A'],
  [/オリーブ|olive/i, '🫒', '#8FBFB0'],
  [/柚子|ゆず|ユズ|yuzu/i, '🍊', '#EDB43C'],
  [/唐辛子|chil/i, '🌶️', '#A9B84E'],
  [/ヨモギ|よもぎ|蓬|mugwort/i, '🌿', '#8DB46A'],
  [/生姜|しょうが|ginger/i, '🫚', '#E2B75A'],
  [/泡|bubble|foam/i, '🫧', '#E7A992'],
  [/薬湯|herb/i, '🌿', '#E59F6B'],
  [/桜|さくら|sakura|cherry/i, '🌸', '#F0A3C0'],
  [/りんご|林檎|apple/i, '🍎', '#E8857A'],
  [/菖蒲|iris/i, '🌱', '#7CB58C'],
  [/炭酸|soda|carbon/i, '🫧', '#8FC8E0'],
  [/酒|sake/i, '🍶', '#C2B89E'],
  [/ローズ|薔薇|バラ|rose/i, '🌹', '#E58FA5'],
  [/ミント|mint/i, '🌱', '#7CCBB5'],
  [/レモン|lemon/i, '🍋', '#E6CF4A'],
];
const FALLBACK_COLORS = ['#E89A9A', '#9FB8E6', '#B4D38F', '#E6C27F', '#BFA3DE', '#8FD0C5'];

function specialStyle(name) {
  const hit = SPECIAL_STYLES.find(([re]) => re.test(name));
  if (hit) return { emoji: hit[1], color: hit[2] };
  let h = 0;
  for (const c of name) h = (h * 31 + c.codePointAt(0)) % 9973;
  return { emoji: '✨', color: FALLBACK_COLORS[h % FALLBACK_COLORS.length] };
}

// Specials running on a date, most specific (shortest) first, so "every day" baths come last.
const span = sp => daysBetween(sp.from, sp.to);
const specialsOn = (s, date) => (s.specials || []).filter(sp => sp.from <= date && date <= sp.to).sort((a, b) => span(a) - span(b));

// Parse poster-style lines for a month ("2026-10"):
//   毎日 ミルク風呂 · 2-4 ほうじ茶風呂 · 2〜4日 … · 30-11/1 JIKKO · 10/5 … · 5 …
function parseSpecials(text, month) {
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const date = (mm, dd) => ymd(new Date(y, mm - 1, dd));
  const out = [], bad = [];
  for (const raw of String(text).split('\n')) {
    const line = raw
      .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)) // full-width digits
      .replace(/[／]/g, '/')
      .replace(/(\d)\s*日/g, '$1')
      .trim();
    if (!line) continue;
    let hit = line.match(/^(?:毎日|every\s*day|daily)[\s:・、]*(.+)$/i);
    if (hit) { out.push({ from: date(m, 1), to: date(m, lastDay), name: hit[1].trim() }); continue; }
    hit = line.match(/^(?:(\d{1,2})\/)?(\d{1,2})(?:\s*(?:[-〜~～–—－]|から)\s*(?:(\d{1,2})\/)?(\d{1,2}))?[\s:・、]+(.+)$/);
    if (!hit) { bad.push(raw.trim()); continue; }
    const [, m1, d1, m2, d2, name] = hit;
    let startM = m1 ? +m1 : m;
    if (startM < m - 6) startM += 12;                // "1/2" on a December calendar is next January
    let endM = m2 ? +m2 : startM;
    const endD = d2 ? +d2 : +d1;
    if (!m2 && d2 && endD < +d1) endM = startM + 1; // e.g. 30-1 runs into next month
    if (endM < startM) endM += 12;                   // e.g. 12/31-1/2
    const from = date(startM, +d1), to = date(endM, endD);
    if (to < from || +d1 > 31 || endD > 31) { bad.push(raw.trim()); continue; }
    out.push({ from, to, name: name.trim() });
  }
  return { specials: out.map(sp => ({ ...sp, ...specialStyle(sp.name) })), bad };
}

const rangeText = sp => {
  const f = parseDay(sp.from), t = parseDay(sp.to);
  const md = d => `${d.getMonth() + 1}/${d.getDate()}`;
  if (sp.from === sp.to) return md(f);
  return f.getMonth() === t.getMonth() ? `${md(f)}–${t.getDate()}` : `${md(f)}–${md(t)}`;
};

function openState(s) {
  if (!weekOf(s)) return null;
  const now = new Date();
  const dow = now.getDay();
  const t = now.getHours() * 60 + now.getMinutes();
  // Still inside yesterday's after-midnight hours?
  const y = hoursOn(s, (dow + 6) % 7);
  if (y && t + 1440 < y.close) return { cls: 'on', text: `Open till ${hhmm(y.close)}` };
  const h = hoursOn(s, dow);
  if (!h) return { cls: 'off', text: 'Closed today' };
  if (t >= h.open && t < h.close) return { cls: 'on', text: `Open till ${hhmm(h.close)}` };
  if (t < h.open) return { cls: '', text: `Opens ${hhmm(h.open)}` };
  return { cls: '', text: 'Closed now' };
}

// ---------------------------------------------------------------------------
// "Should we go?" — nudge + suggested slots for the coming 7 days
// ---------------------------------------------------------------------------

function daysSinceLast() {
  const last = pastVisits().find(v => v.date <= today());
  return last ? daysBetween(last.date, today()) : null;
}

// ---------------------------------------------------------------------------
// Milk bottles (top of "Should we go?")
//   🥛 regular:    full right after a soak, drinks down to empty over MILK_DAYS
//   🍓 strawberry: fills with this month's visits toward the monthly goal
//   ☕ coffee:     fills with the weekly streak, full at STREAK_FULL weeks
// ---------------------------------------------------------------------------

const MILK_DAYS = 14;
const STREAK_FULL = 8;
const monthlyGoal = () => Math.max(1, Number(S.goal?.perMonth) || 4);

// The message that goes with the regular milk level.
function milkMessage(days) {
  const d = `${days} day${days === 1 ? '' : 's'}`;
  if (days === null) return { head: 'An empty bottle…', text: 'Log your first soak to pour the milk. Pick a time below!' };
  if (days === 0) return { head: 'Freshly poured!', text: 'You went today. Enjoy that cold milk after the bath ♨' };
  if (days <= 3) return { head: 'Still plenty of milk', text: `Last soak was ${d} ago. No rush, maybe later this week?` };
  if (days <= 6) return { head: 'Half a bottle left', text: `It’s been ${d}. A soak and a cold milk would be nice soon.` };
  if (days < MILK_DAYS) return { head: 'Running low…', text: `${d} without a bath! Time to soak and drink some milk.` };
  return { head: 'The bottle’s empty!', text: `${d}?! Go soak and grab a milk as soon as you can.` };
}

const BOTTLES = {
  regular:    { milk: '#FFFDF6', cap: '#9DB4EC', band: '#D9483B', label: '牛乳' },
  strawberry: { milk: '#F7B9C9', cap: '#F29BB4', band: '#E0577C', label: 'いちご' },
  coffee:     { milk: '#C08D5C', cap: '#EBA25A', band: '#8A5A2B', label: 'コーヒー' },
};

// A glass milk bottle with a paper cap tied with string; `level` is 0–1.
function milkBottle(kind, level, pour) {
  const b = BOTTLES[kind];
  const top = 30, bottom = 132;                       // milk can fill from the neck to the base
  const drop = (1 - Math.max(0, Math.min(1, level))) * (bottom - top);
  const glass = 'M25 22H55V34C55 44 70 47 70 60V123Q70 132 61 132H19Q10 132 10 123V60C10 47 25 44 25 34Z';
  return `<svg class="bottle${pour ? ' pour' : ''}" viewBox="0 0 80 140" style="--drop:${drop.toFixed(1)}px" aria-hidden="true">
    <defs><clipPath id="glass-${kind}"><path d="${glass}"/></clipPath></defs>
    <path d="${glass}" class="glass"/>
    <g clip-path="url(#glass-${kind})">
      <g class="milk"><rect x="0" y="${top}" width="80" height="${bottom - top + 4}" fill="${b.milk}"/>
        <ellipse cx="40" cy="${top}" rx="34" ry="3.5" fill="${b.milk}" class="surface"/></g>
    </g>
    <rect x="10" y="80" width="60" height="21" fill="${b.band}" opacity=".92"/>
    <text x="40" y="94.5" text-anchor="middle" fill="#fff" font-size="${b.label.length > 3 ? 10 : 11.5}" font-weight="900" class="bottle-label">${b.label}</text>
    <path d="M17 64V118" class="shine"/>
    <path d="${glass}" class="glass-edge"/>
    <path d="M21 25Q20 12 40 10Q60 12 59 25Q55 29 50 26Q45 30 40 26Q35 30 30 26Q25 29 21 25Z" fill="${b.cap}" class="cap"/>
    <path d="M23 22.5Q40 25.5 57 22.5" class="string"/>
  </svg>`;
}

let milkPoured = false; // play the pour animation once per app launch

function milkShelf(since) {
  const visitsThisMonth = S.visits.filter(v => v.date.startsWith(today().slice(0, 7)) && v.date <= today()).length;
  const goal = monthlyGoal();
  const { current } = streaks();
  const pour = !milkPoured;
  milkPoured = true;
  const shelf = [
    { kind: 'regular', level: since === null ? 0 : 1 - since / MILK_DAYS,
      name: 'Milk', value: since === null ? 'empty' : since === 0 ? 'today' : `${since}d ago` },
    { kind: 'strawberry', level: visitsThisMonth / goal,
      name: 'Strawberry', value: `${visitsThisMonth} / ${goal}${visitsThisMonth >= goal ? ' 🎉' : ''}` },
    { kind: 'coffee', level: current / STREAK_FULL,
      name: 'Coffee', value: `${current} wk streak` },
  ];
  return `<div class="shelf">${shelf.map(x => `
    <button class="shelf-item" data-action="milk-info" data-kind="${x.kind}">
      ${milkBottle(x.kind, x.level, pour)}
      <b>${x.name}</b><small>${esc(x.value)}</small>
    </button>`).join('')}</div>`;
}

function milkInfo(kind) {
  const goal = monthlyGoal();
  toast({
    regular: `🥛 Full after a soak, empty after ${MILK_DAYS} days without one.`,
    strawberry: `🍓 Fills up with this month’s visits. Goal: ${goal} (change it in Settings).`,
    coffee: `☕ Fills with your weekly streak: full at ${STREAK_FULL} weeks in a row.`,
  }[kind], 4000);
}

const TOGETHER = 120; // minutes you both need free (soak + getting there)

// How quiet a sento tends to be in the 30 minutes starting at `m` (minutes since midnight).
function blockQuiet(m, h, weekend) {
  if (m < h.open + 60) return 1;                       // just after opening
  if (m >= 21 * 60 + 30) return 0.9;                   // late evening
  if (m >= 17 * 60 + 30) return weekend ? 0.25 : 0.3;  // after-work rush
  return weekend ? 0.4 : 0.65;                         // afternoon
}
const quietLabel = (m, h) =>
  m < h.open + 60 ? 'Just after opening' : m >= 21 * 60 ? 'Late evening' : m >= 17 * 60 + 30 ? 'Evening, may be busy' : 'Afternoon';

// With calendars: the quietest 2-hour window you're both free, per sento and day.
function freeOptions(h, at, weekend, earliest, busy) {
  let best = null;
  for (let m = h.open; m + TOGETHER <= h.close; m += 30) {
    const a = at(m), b = at(m + TOGETHER);
    if (a < earliest || busy.some(([s, e]) => s < b && e > a)) continue;
    const quiet = [0, 30, 60, 90].reduce((sum, k) => sum + blockQuiet(m + k, h, weekend), 0) / 4;
    if (!best || quiet > best.quiet) best = { start: m, end: m + TOGETHER, quiet, label: `${quietLabel(m, h)} · both free` };
  }
  return best ? [best] : [];
}

// Without calendars: the usual quiet windows.
function fixedOptions(h, at, earliest) {
  const late = h.close >= 20 * 60;
  return [
    { start: h.open, end: Math.min(h.open + 60, h.close), label: 'Just after opening', quiet: 1 },
    { start: Math.max(h.close - 120, h.open), end: h.close - 30, label: late ? 'Late evening' : 'Before closing', quiet: late ? 0.9 : 0.6 },
  ].filter(o => o.end - o.start >= 30 && at(o.end) > earliest); // drop slots that are (nearly) over
}

function suggestions() {
  const now = new Date();
  const earliest = now.getTime() + 15 * 60000;
  const busy = calReady() ? cal.busy : null;
  const since = daysSinceLast();
  // 0 = relaxed (spread across the week), 1 = overdue (strongly prefer sooner)
  const urgency = since === null ? 0.7 : Math.min(1, since / 10);

  const lastAt = {};
  for (const v of S.visits) if (!lastAt[v.sentoId] || v.date > lastAt[v.sentoId]) lastAt[v.sentoId] = v.date;

  const slots = [];
  for (let d = 0; d < 7; d++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
    const date = ymd(day);
    const dow = day.getDay();
    const weekend = dow === 0 || dow === 6;
    for (const s of S.sentos) {
      const h = hoursOn(s, dow);
      if (!h) continue; // closed that day, or no hours set
      // Minutes since this day's midnight → timestamp (works past midnight too)
      const at = m => new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, m).getTime();
      const options = busy ? freeOptions(h, at, weekend, earliest, busy) : fixedOptions(h, at, earliest);
      for (const o of options) {
        const sinceSento = lastAt[s.id] ? daysBetween(lastAt[s.id], date) : 30;
        const score =
          o.quiet * 1.5 +
          (weekend ? -0.6 : 0) +                    // weekends are busier
          (1 - d / 6) * urgency * 3 +               // nudge: longer gap → sooner slots
          Math.min(sinceSento, 30) / 30 * 0.6;      // rotate between favourites
        slots.push({ s, date, d, start: o.start, end: o.end, label: o.label, weekend, score, special: specialsOn(s, date)[0] });
      }
    }
  }
  slots.sort((x, y) => y.score - x.score);

  // Best slot per day, at most 4 days
  const picked = [];
  const days = new Set();
  for (const sl of slots) {
    if (days.has(sl.date)) continue;
    days.add(sl.date);
    picked.push(sl);
    if (picked.length === 4) break;
  }
  return picked;
}

// ---------------------------------------------------------------------------
// History stats
// ---------------------------------------------------------------------------

// Monday-based week number (1970-01-01 was a Thursday).
const weekNum = date => Math.floor((dayNum(date) + 3) / 7);

function streaks() {
  const weeks = [...new Set(S.visits.filter(v => v.date <= today()).map(v => weekNum(v.date)))].sort((a, b) => a - b);
  let longest = 0, run = 0;
  weeks.forEach((w, i) => {
    run = i && w === weeks[i - 1] + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  });
  // Current streak stays alive through this week even before you’ve gone.
  const thisWeek = weekNum(today());
  const last = weeks[weeks.length - 1];
  const current = last === thisWeek || last === thisWeek - 1 ? run : 0;
  return { longest, current };
}

function sentoStats(id) {
  const vs = S.visits.filter(v => v.sentoId === id);
  const rated = vs.filter(v => v.rating);
  return {
    count: vs.length,
    last: vs.map(v => v.date).sort().pop(),
    avg: rated.length ? rated.reduce((a, v) => a + v.rating, 0) / rated.length : 0,
  };
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

const view = $('#view');
const stars = n => n ? `<span class="stars-show" aria-label="${n} out of 5">${'★'.repeat(n)}<span>${'★'.repeat(5 - n)}</span></span>` : '';

function render() {
  const { a, b } = S.names;
  $('#subtitle').textContent = a ? `${a} & ${b || 'Moka'}` : `with ${b || 'Moka'}`;
  document.querySelectorAll('[data-tab]').forEach(el => el.setAttribute('aria-current', el.dataset.tab === tab ? 'page' : 'false'));
  view.innerHTML = tab === 'go' ? viewGo() : tab === 'sentos' ? viewSentos() : tab === 'diary' ? viewDiary() : viewHistory();
  hydratePhotos(view);
}

// さっぱり: every visit photo as a grid, grouped by month.
function viewDiary() {
  const items = diaryPhotos();
  const visits = new Set(items.map(p => p.v.id)).size;
  let h = `<h2 class="page-title">さっぱり</h2>
    <p class="hint">${items.length ? `${items.length} photo${items.length > 1 ? 's' : ''} from ${visits} visit${visits > 1 ? 's' : ''}` : 'Your bath-day photo diary'}</p>`;
  if (photoQ.up.length && sync.state.code) {
    h += `<p class="hint${photoErr ? ' warn' : ''}">${photoQ.up.length} photo${photoQ.up.length > 1 ? 's' : ''} waiting to upload${photoErr ? ` (${esc(photoErr)})` : '…'}</p>`;
  }
  if (!items.length) {
    return h + `<section class="empty-note">
      <p>No photos yet. Snap a selfie when you log your next soak, and it’ll show up here.</p>
      <button class="btn primary" data-action="log">+ Log a visit</button>
    </section>`;
  }
  let month = '';
  for (const { id, v } of items) {
    const m = v.date.slice(0, 7);
    if (m !== month) {
      h += `${month ? '</div>' : ''}<h3 class="section month">${esc(parseDay(v.date).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))}</h3><div class="grid">`;
      month = m;
    }
    const src = photoSrc(id, 'thumb');
    h += `<button class="tile" data-action="view-photo" data-id="${esc(id)}" aria-label="${esc(sentoOf(v.sentoId)?.name || 'Sento')}, ${esc(dayWord(v.date))}">
      <img data-photo="${esc(id)}" data-size="thumb" alt="" ${src ? `src="${src}" data-ready="1"` : ''} loading="lazy">
      <span class="tile-date">${parseDay(v.date).getDate()}</span>
    </button>`;
  }
  return h + '</div>';
}

function openPhoto(id) {
  const items = diaryPhotos();
  const i = items.findIndex(p => p.id === id);
  if (i < 0) return;
  const { v } = items[i];
  const prev = items[i - 1], next = items[i + 1];
  const thumb = photoSrc(id, 'thumb');
  openSheet(sentoOf(v.sentoId)?.name || 'Sento', `
    <figure class="viewer">
      <img data-photo="${esc(id)}" data-size="full" alt="" ${thumb ? `src="${thumb}"` : ''}>
    </figure>
    <div class="viewer-nav">
      <button type="button" class="btn small" data-action="view-photo" data-id="${esc(prev?.id || '')}" ${prev ? '' : 'disabled'} aria-label="Newer photo">‹</button>
      <span class="hint">${i + 1} / ${items.length}</span>
      <button type="button" class="btn small" data-action="view-photo" data-id="${esc(next?.id || '')}" ${next ? '' : 'disabled'} aria-label="Older photo">›</button>
    </div>
    <p class="meta">${esc(dayWord(v.date))} ${stars(v.rating)}</p>
    ${v.note ? `<p>${esc(v.note)}</p>` : ''}
    <div class="two">
      <button type="button" class="btn" data-action="edit-visit" data-id="${v.id}">Edit visit</button>
      <button type="button" class="btn danger" data-action="delete-photo" data-id="${esc(id)}">Delete photo</button>
    </div>`, null);
}

function viewGo() {
  const since = daysSinceLast();
  const n = milkMessage(since);
  let h = `
    <section class="card nudge">
      <p class="eyebrow">${since === null ? 'Welcome' : since === 0 ? 'Last soak: today' : `Last soak: ${since} day${since > 1 ? 's' : ''} ago`}</p>
      <h2 class="cute">${esc(n.head)}</h2>
      <p>${esc(n.text)}</p>
      ${milkShelf(since)}
      <button class="btn primary wide" data-action="log">+ Log a visit</button>
    </section>`;

  if (!S.sentos.length) {
    return h + `<section class="empty-note">
      <p>Add your favourite sento with their hours and closing day, and we’ll suggest quiet times to go.</p>
      <button class="btn" data-action="new-sento">Add a sento</button></section>`;
  }

  const list = suggestions();
  const withCal = calReady();
  const missingHours = S.sentos.filter(s => !weekOf(s));
  h += `<h3 class="section">Good times this week</h3>`;
  if (calSrc() && !withCal) {
    h += `<p class="hint warn">${cal.error ? `Couldn’t check your calendars (${esc(cal.error)}).` : 'Checking your calendars…'} Showing the usual quiet times for now.</p>`;
  } else if (withCal && cal.problems?.length) {
    h += `<p class="hint warn">${cal.problems.map(esc).join(' ')}</p>`;
  }
  if (!list.length) {
    h += `<p class="empty-note">${withCal
      ? `No 2-hour window in the next 7 days when you’re both free and a favourite is open.`
      : `No open slots in the next 7 days${missingHours.length ? ' — add opening hours in the Sento tab' : ''}.`}</p>`;
  } else {
    h += `<div class="list">${list.map((sl, i) => `
      <div class="row slot${i === 0 ? ' best' : ''}">
        <span class="when"><b>${esc(dayWord(sl.date))}</b><small>${hhmm(sl.start)}–${hhmm(sl.end)}</small></span>
        <span class="grow"><b>${esc(sl.s.name)}</b><small>${esc(sl.label)}${sl.weekend ? ' · weekend, may be busier' : ''}</small>${sl.special ? `<small class="special-line">${sl.special.emoji} ${esc(sl.special.name)}</small>` : ''}</span>
        ${i === 0 ? '<span class="pill">Best bet</span>' : ''}
      </div>`).join('')}</div>
      <p class="hint">${withCal
        ? `Times you’re both free for 2 hours, from your Google Calendars (checked ${esc(lastSynced(cal.fetchedAt))}). `
        : calSrc() ? '' : 'Connect Google Calendar in Settings to only see times you’re both free. '}Quietest right after opening and late in the evening. Closing days are skipped.</p>`;
  }
  if (missingHours.length) {
    h += `<p class="hint warn">${missingHours.map(s => esc(s.name)).join(', ')} ${missingHours.length > 1 ? 'have' : 'has'} no hours yet, so ${missingHours.length > 1 ? 'they’re' : 'it’s'} not in the suggestions.</p>`;
  }
  return h;
}

// Sento tab: a playful month calendar (default) or the plain list.
let sentoView = 'calendar';
let calMonth = today().slice(0, 7);
let calFilter = 'all';

const SENTO_COLORS = ['#E2574C', '#3E7CC9', '#3FA36B', '#E59A2F', '#8C63C9', '#D9578E'];
const sentoColor = s => SENTO_COLORS[S.sentos.slice().sort(byName).findIndex(x => x.id === s.id) % SENTO_COLORS.length];

function viewSentos() {
  const list = S.sentos.slice().sort(byName);
  const seg = v => `<button class="seg-btn" aria-pressed="${sentoView === v}" data-action="sento-view" data-v="${v}">${v === 'calendar' ? '📅 Calendar' : '📋 List'}</button>`;
  const head = `<div class="toolbar"><h2 class="page-title">Sento</h2><button class="btn primary small" data-action="new-sento">+ Add</button></div>
    ${list.length ? `<div class="seg">${seg('calendar')}${seg('list')}</div>` : ''}`;
  if (list.length && sentoView === 'calendar') return head + viewCalendar(list);
  return `${head}
    ${list.length ? `<div class="list">${list.map(s => {
      const st = sentoStats(s.id);
      const os = openState(s);
      return `<button class="row sento" data-action="edit-sento" data-id="${s.id}">
        <span class="grow">
          <b>${esc(s.name)}</b>
          <small>${esc(weekSummary(s))}</small>
          <small>${st.count ? `${st.count} visit${st.count > 1 ? 's' : ''} · last ${esc(lastWord(st.last))}` : 'Not visited yet'}${st.avg ? ` · ★ ${st.avg.toFixed(1)}` : ''}</small>
        </span>
        ${os ? `<span class="status ${os.cls}">${esc(os.text)}</span>` : ''}
      </button>`;
    }).join('')}</div>`
    : `<p class="empty-note">No sento yet. Add the ones you love (or want to try).</p>`}`;
}

function viewCalendar(list) {
  const only = list.length === 1 ? list[0] : sentoOf(calFilter);
  const shown = only ? [only] : list;
  const [y, m] = calMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const daysIn = new Date(y, m, 0).getDate();
  const lead = (first.getDay() + 6) % 7; // Monday first
  const now = today();
  const went = new Set(S.visits.filter(v => shown.some(s => s.id === v.sentoId)).map(v => v.date));

  let cells = '<span class="cal-blank"></span>'.repeat(lead);
  for (let d = 1; d <= daysIn; d++) {
    const date = ymd(new Date(y, m - 1, d));
    const dow = new Date(y, m - 1, d).getDay();
    const open = shown.filter(s => hoursOn(s, dow));
    const main = open.flatMap(s => specialsOn(s, date)).sort((a, b) => span(a) - span(b))[0]; // only if it's open that day
    const cls = ['cal-day'];
    if (!open.length) cls.push('closed');
    if (date === now) cls.push('today');
    if (date < now) cls.push('past');
    let info;
    if (only) {
      const h = hoursOn(only, dow);
      info = h ? `<span class="cal-time">${hhmm(h.open)}</span>` : weekOf(only) ? '<span class="cal-time">休み</span>' : '';
    } else {
      info = `<span class="cal-dots">${open.map(s => `<i style="--dot:${sentoColor(s)}"></i>`).join('')}</span>`;
    }
    cells += `<button class="${cls.join(' ')}" ${main ? `style="--c:${main.color}"` : ''} data-action="cal-day" data-date="${date}" aria-label="${esc(dayWord(date))}${main ? `, ${esc(main.name)}` : ''}${open.length ? '' : ', closed'}">
      <span class="cal-num">${d}</span>
      ${main ? `<span class="cal-emoji">${main.emoji}</span>` : !open.length ? '<span class="cal-emoji sleepy">💤</span>' : ''}
      ${info}
      ${went.has(date) ? '<span class="hanko" aria-label="visited">湯</span>' : ''}
    </button>`;
  }

  // This month's specials, like the poster's colourful blocks
  const monthStart = ymd(first), monthEnd = ymd(new Date(y, m, 0));
  const specials = shown.flatMap(s => (s.specials || [])
    .filter(sp => sp.from <= monthEnd && sp.to >= monthStart)
    .map(sp => ({ sp, s })))
    .sort((a, b) => a.sp.from.localeCompare(b.sp.from));
  const everyDay = specials.filter(x => span(x.sp) > 27);
  const ranged = specials.filter(x => span(x.sp) <= 27);
  const card = ({ sp, s }) => `<button class="special-card" style="--c:${sp.color}" data-action="edit-special" data-id="${esc(sp.id)}">
      <span class="sp-emoji">${sp.emoji}</span>
      <span class="sp-when">${span(sp) > 27 ? '毎日' : esc(rangeText(sp))}</span>
      <span class="sp-name">${esc(sp.name)}</span>
      ${only ? '' : `<span class="sp-sento"><i style="--dot:${sentoColor(s)}"></i>${esc(s.name)}</span>`}
    </button>`;

  const monthName = first.toLocaleDateString(undefined, { month: 'long' });
  return `
    ${list.length > 1 ? `<div class="chips cal-filter">
      <button class="chip" aria-pressed="${!only}" data-action="cal-filter" data-id="all">All</button>
      ${list.map(s => `<button class="chip" aria-pressed="${only?.id === s.id}" data-action="cal-filter" data-id="${s.id}"><i class="dot" style="--dot:${sentoColor(s)}"></i>${esc(s.name)}</button>`).join('')}
    </div>` : ''}
    <section class="cal cute">
      <header class="cal-head">
        <button class="cal-nav" data-action="cal-month" data-d="-1" aria-label="Previous month">‹</button>
        <div class="cal-title">
          <span class="cal-year">${y}</span>
          <span class="cal-month">${m}<small>月</small></span>
          <span class="cal-name">${esc(monthName)} ♨</span>
        </div>
        <button class="cal-nav" data-action="cal-month" data-d="1" aria-label="Next month">›</button>
      </header>
      ${only ? `<p class="cal-hours">🕒 ${esc(weekSummary(only))}</p>` : ''}
      <div class="cal-week">${WEEK_ORDER.map(d => `<span class="${d === 0 || d === 6 ? 'we' : ''}">${'日月火水木金土'[d]}</span>`).join('')}</div>
      <div class="cal-grid">${cells}</div>
      ${calMonth !== now.slice(0, 7) ? '<button class="link cal-today" data-action="cal-month" data-d="0">Back to this month</button>' : ''}
    </section>
    <div class="toolbar"><h3 class="section">Special baths ${specials.length ? `<span class="count">${specials.length}</span>` : ''}</h3>
      <button class="btn small" data-action="add-specials">+ Add</button></div>
    ${specials.length ? `${everyDay.map(card).join('')}<div class="special-grid">${ranged.map(card).join('')}</div>`
      : `<p class="empty-note cute">No special baths this month yet 🫧<br><small>Got a sento’s monthly bath calendar? Tap <b>+ Add</b> and type it in.</small></p>`}`;
}

function viewHistory() {
  const visits = pastVisits();
  const month = today().slice(0, 7);
  const thisMonth = visits.filter(v => v.date.startsWith(month)).length;
  const { longest, current } = streaks();
  const wk = n => `${n} week${n === 1 ? '' : 's'}`;

  let h = `
    <h2 class="page-title">History</h2>
    <div class="stats">
      <div class="stat"><b>${thisMonth}</b><span>this month</span></div>
      <div class="stat"><b>${longest}</b><span>longest streak (weeks)</span></div>
      <div class="stat"><b>${visits.length}</b><span>visits in all</span></div>
    </div>
    <p class="hint">${current ? `Current streak: ${wk(current)} in a row with at least one soak.` : 'A streak counts weeks in a row with at least one soak.'}</p>
    <button class="btn primary wide" data-action="log">+ Log a visit</button>`;

  if (!visits.length) return h + `<p class="empty-note">No visits yet.</p>`;

  let lastMonth = '';
  h += `<div class="list history">`;
  for (const v of visits) {
    const m = v.date.slice(0, 7);
    if (m !== lastMonth) {
      lastMonth = m;
      h += `<h3 class="section month">${esc(parseDay(v.date).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))}</h3>`;
    }
    const d = parseDay(v.date);
    h += `<button class="row" data-action="edit-visit" data-id="${v.id}">
      <span class="date"><small>${DAYS[d.getDay()]}</small><b>${d.getDate()}</b></span>
      <span class="grow"><b>${esc(sentoOf(v.sentoId)?.name || 'Unknown sento')}</b>${v.note ? `<small class="note">${esc(v.note)}</small>` : ''}${v.photos?.length ? `<small>📷 ${v.photos.length}</small>` : ''}</span>
      ${stars(v.rating)}
    </button>`;
  }
  return h + `</div>`;
}

// ---------------------------------------------------------------------------
// Sheets (bottom-sheet forms)
// ---------------------------------------------------------------------------

const sheet = $('#sheet');
const sheetForm = $('#sheet-form');
let onSheetSubmit = null;

function openSheet(title, body, onSubmit) {
  if (sheet.open) sheet.close();
  discardPhotoDraft();
  onSheetSubmit = onSubmit;
  sheetForm.innerHTML = `
    <header class="sheet-head">
      <h2>${esc(title)}</h2>
      <button type="button" class="icon-btn" data-close aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </header>
    <div class="sheet-body">${body}</div>`;
  sheet.showModal();
  hydratePhotos(sheetForm);
}

// Save is first in the DOM so Enter submits it; CSS shows Delete on the left.
const footer = (label, extra = '') => `<div class="sheet-foot"><button class="btn primary grow" value="save">${label}</button>${extra}</div>`;
const deleteBtn = '<button class="btn danger" value="delete">Delete</button>';

sheetForm.addEventListener('submit', e => {
  e.preventDefault();
  if (!onSheetSubmit) return;
  if (onSheetSubmit(new FormData(sheetForm), e.submitter?.value || 'save') === false) return;
  sheet.close();
  commit();
});
sheet.addEventListener('click', e => {
  if (e.target === sheet || e.target.closest('[data-close]')) sheet.close();
  if (e.target.closest('[data-clear-rating]')) sheetForm.querySelectorAll('[name=rating]').forEach(r => (r.checked = false));
  if (e.target.closest('[data-copy-hours]')) copyMondayHours();
  const rm = e.target.closest('[data-remove-photo]');
  if (rm) removePhotoFromForm(rm.dataset.removePhoto);
});
sheetForm.addEventListener('change', e => {
  if (e.target.matches('[data-photo-input]')) addPhotosToForm(e.target);
  if (e.target.name === 'sentoId') $('#new-sento').hidden = e.target.value !== '__new';
  if (/^closed\d$/.test(e.target.name)) setDayClosed(e.target.closest('.day-row'), e.target.checked);
});

function weekRows(s) {
  const week = weekOf(s) || DAYS.map(() => ({ open: '15:00', close: '00:00' }));
  return `<div class="week">${WEEK_ORDER.map(d => {
    const day = week[d];
    const shown = day || week.find(Boolean) || { open: '15:00', close: '00:00' };
    return `<div class="day-row${day ? '' : ' is-closed'}">
      <span class="day-name">${DAYS[d]}</span>
      <input type="time" name="open${d}" value="${esc(shown.open)}" aria-label="${DAYS_LONG[d]} opens" ${day ? '' : 'disabled'}>
      <span class="dash">–</span>
      <input type="time" name="close${d}" value="${esc(shown.close)}" aria-label="${DAYS_LONG[d]} closes" ${day ? '' : 'disabled'}>
      <label class="closed-toggle"><input type="checkbox" name="closed${d}" ${day ? '' : 'checked'}><span>Closed</span></label>
    </div>`;
  }).join('')}</div>`;
}

function setDayClosed(row, closed) {
  row.classList.toggle('is-closed', closed);
  row.querySelectorAll('input[type=time]').forEach(i => (i.disabled = closed));
}

function copyMondayHours() {
  const open = sheetForm.elements.open1.value;
  const close = sheetForm.elements.close1.value;
  for (const d of WEEK_ORDER) {
    if (sheetForm.elements[`closed${d}`].checked) continue;
    sheetForm.elements[`open${d}`].value = open;
    sheetForm.elements[`close${d}`].value = close;
  }
  toast('Copied to every open day');
}

function openSento(s) {
  const isNew = !sentoOf(s.id);
  const st = isNew ? null : sentoStats(s.id);
  openSheet(isNew ? 'Add a sento' : s.name, `
    <label class="field"><span>Name</span><input name="name" value="${esc(s.name)}" placeholder="e.g. Kosugiyu" autocomplete="off"></label>
    <fieldset class="field">
      <legend>Opening hours</legend>
      ${weekRows(s)}
      <button type="button" class="link copy-hours" data-copy-hours>Copy Monday’s hours to every open day</button>
    </fieldset>
    <label class="field"><span>Notes <em>optional</em></span><textarea name="notes" rows="2" placeholder="Address, what you love about it…">${esc(s.notes)}</textarea></label>
    ${st?.count ? `<p class="hint">${st.count} visit${st.count > 1 ? 's' : ''} logged here.</p>` : ''}
    ${footer(isNew ? 'Add' : 'Save', isNew ? '' : deleteBtn)}`,
  (fd, act) => {
    if (act === 'delete') {
      const n = sentoStats(s.id).count;
      if (!confirm(`Delete ${s.name}${n ? ` and its ${n} logged visit${n > 1 ? 's' : ''}` : ''}?`)) return false;
      S.sentos = remove(S.sentos, s.id);
      for (const v of S.visits.filter(v => v.sentoId === s.id)) {
        (v.photos || []).forEach(forgetPhoto);
        S.visits = remove(S.visits, v.id);
      }
      return;
    }
    const name = fd.get('name').trim();
    if (!name) { toast('Give it a name'); return false; }
    const week = DAYS.map((_, d) => fd.get(`closed${d}`) ? null : { open: fd.get(`open${d}`) || '', close: fd.get(`close${d}`) || '' });
    const blank = WEEK_ORDER.find(d => week[d] && (!week[d].open || !week[d].close));
    if (blank !== undefined) { toast(`Fill in ${DAYS_LONG[blank]}’s hours, or mark it closed`); return false; }
    Object.assign(s, { name, week, notes: fd.get('notes').trim() });
    delete s.open; delete s.close; delete s.closed; // replaced by `week`
    touch(s);
    if (isNew) S.sentos.push(s);
  });
}

function openVisit(v) {
  const isNew = !visitOf(v.id);
  const sentos = S.sentos.slice().sort(byName);
  const pickNew = !sentos.length;
  openSheet(isNew ? 'Log a visit' : 'Edit visit', `
    <label class="field"><span>Date</span><input type="date" name="date" value="${esc(v.date)}" max="${today()}"></label>
    <label class="field"><span>Which sento</span>
      <select name="sentoId">
        ${sentos.map(s => `<option value="${s.id}" ${s.id === v.sentoId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
        <option value="__new" ${pickNew ? 'selected' : ''}>+ Somewhere new…</option>
      </select>
    </label>
    <label class="field" id="new-sento" ${pickNew ? '' : 'hidden'}><span>New sento name</span><input name="newSento" autocomplete="off" placeholder="Added to your Sento tab"></label>
    <fieldset class="field"><legend>Rating <em>optional</em> <button type="button" class="link" data-clear-rating>clear</button></legend>
      <div class="stars">${[5, 4, 3, 2, 1].map(n => `
        <input type="radio" id="r${n}" name="rating" value="${n}" ${v.rating === n ? 'checked' : ''}><label for="r${n}" aria-label="${n} star${n > 1 ? 's' : ''}">★</label>`).join('')}
      </div>
    </fieldset>
    <label class="field"><span>Note <em>optional</em></span><textarea name="note" rows="3" placeholder="Hot bath was perfect, coffee milk after…">${esc(v.note)}</textarea></label>
    <fieldset class="field">
      <legend>Photos <em>optional</em></legend>
      <div class="photo-strip" id="photo-strip">${(v.photos || []).map(photoChip).join('')}</div>
      <div class="two">
        <label class="btn file-btn"><input type="file" accept="image/*" capture="user" data-photo-input>🤳 Selfie</label>
        <label class="btn file-btn"><input type="file" accept="image/*" multiple data-photo-input>🖼 Choose</label>
      </div>
      <input type="hidden" name="photos" value="${esc((v.photos || []).join(','))}">
    </fieldset>
    ${footer(isNew ? 'Log it' : 'Save', isNew ? '' : deleteBtn)}`,
  (fd, act) => {
    if (act === 'delete') {
      if (!confirm(`Delete this visit${v.photos?.length ? ' and its photos' : ''}?`)) return false;
      (v.photos || []).forEach(forgetPhoto);
      S.visits = remove(S.visits, v.id);
      return;
    }
    if (photoDraft.busy) { toast('Hang on, still adding your photo…'); return false; }
    const date = fd.get('date');
    if (!date) { toast('Pick a date'); return false; }
    let sentoId = fd.get('sentoId');
    if (sentoId === '__new') {
      const name = (fd.get('newSento') || '').trim();
      if (!name) { toast('Name the new sento'); return false; }
      const s = touch({ id: uid(), name, notes: '' });
      S.sentos.push(s);
      sentoId = s.id;
      toast(`${name} added — set its hours in the Sento tab`);
    }
    const photos = fd.get('photos').split(',').filter(Boolean);
    for (const id of v.photos || []) if (!photos.includes(id)) forgetPhoto(id); // removed with ×
    for (const id of photos) if (photoDraft.added.has(id)) queuePhoto('up', id);
    photoDraft.saved = true;
    Object.assign(v, { date, sentoId, rating: Number(fd.get('rating')) || 0, note: fd.get('note').trim(), photos });
    touch(v);
    if (isNew) S.visits.push(v);
  });
  photoDraft = { added: new Set(), saved: false, busy: 0 };
}

// Photos added in the open visit form. If the form is closed without saving, they're dropped.
let photoDraft = { added: new Set(), saved: true, busy: 0 };

const photoChip = id => `<span class="photo-chip" data-id="${esc(id)}">
  <img data-photo="${esc(id)}" data-size="thumb" alt="" ${photoSrc(id, 'thumb') ? `src="${photoSrc(id, 'thumb')}" data-ready="1"` : ''}>
  <button type="button" data-remove-photo="${esc(id)}" aria-label="Remove photo">×</button>
</span>`;

async function addPhotosToForm(input) {
  const files = [...input.files];
  input.value = '';
  const field = sheetForm.elements.photos;
  const strip = $('#photo-strip');
  for (const file of files) {
    photoDraft.busy++;
    const holder = document.createElement('span');
    holder.className = 'photo-chip adding';
    strip.append(holder);
    try {
      const id = await addPhoto(file);
      photoDraft.added.add(id);
      field.value = [...field.value.split(',').filter(Boolean), id].join(',');
      holder.outerHTML = photoChip(id);
      hydratePhotos(strip);
    } catch (err) {
      holder.remove();
      toast(err.message || 'Couldn’t add that photo');
    } finally {
      photoDraft.busy--;
    }
  }
}

function removePhotoFromForm(id) {
  const field = sheetForm.elements.photos;
  field.value = field.value.split(',').filter(x => x && x !== id).join(',');
  sheetForm.querySelector(`.photo-chip[data-id="${CSS.escape(id)}"]`)?.remove();
}

// Closed without saving: throw away photos added in that form.
function discardPhotoDraft() {
  if (!photoDraft.saved) photoDraft.added.forEach(dropPhotoBlobs);
  photoDraft = { added: new Set(), saved: true, busy: 0 };
}
// The close event arrives a moment later; skip it if another sheet is already open.
sheet.addEventListener('close', () => { if (!sheet.open) discardPhotoDraft(); });

// Tap a calendar day: hours, special baths and visits for that day.
function openDay(date) {
  const dow = parseDay(date).getDay();
  const shown = sentoOf(calFilter) ? [sentoOf(calFilter)] : S.sentos.slice().sort(byName);
  const visits = S.visits.filter(v => v.date === date);
  const title = parseDay(date).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  openSheet(title, `
    ${shown.map(s => {
      const h = hoursOn(s, dow);
      const sps = specialsOn(s, date);
      const vs = visits.filter(v => v.sentoId === s.id);
      return `<section class="day-card cute">
        <h3><i class="dot" style="--dot:${sentoColor(s)}"></i>${esc(s.name)}
          <span class="status ${h ? 'on' : 'off'}">${h ? `${hhmm(h.open)}–${hhmm(h.close)}` : weekOf(s) ? 'Closed 💤' : 'Hours not set'}</span></h3>
        ${sps.map(sp => `<button type="button" class="special-pill" style="--c:${sp.color}" data-action="edit-special" data-id="${esc(sp.id)}">
          <span>${sp.emoji}</span><b>${esc(sp.name)}</b><small>${span(sp) > 27 ? 'every day' : esc(rangeText(sp))}</small></button>`).join('')}
        ${vs.map(v => `<button type="button" class="went" data-action="edit-visit" data-id="${v.id}"><span class="hanko">湯</span> You went! ${stars(v.rating)}${v.photos?.length ? ` 📷 ${v.photos.length}` : ''}</button>`).join('')}
      </section>`;
    }).join('')}
    <div class="two">
      <button type="button" class="btn" data-action="add-special" data-date="${date}">+ Special bath</button>
      ${date <= today() ? `<button type="button" class="btn primary" data-action="log" data-date="${date}" data-sento="${shown.length === 1 ? shown[0].id : ''}">+ Log a visit</button>` : ''}
    </div>`, null);
}

const emojiPicks = ['🥛', '🍵', '🌿', '💜', '🌼', '🫒', '🫧', '🍊', '🌶️', '🫚', '🌸', '🍎', '🍋', '🌹', '🍶', '✨'];
const sentoOptions = selected => S.sentos.slice().sort(byName)
  .map(s => `<option value="${s.id}" ${s.id === selected ? 'selected' : ''}>${esc(s.name)}</option>`).join('');

function openSpecial(sp, sentoId) {
  const isNew = !sp.id;
  openSheet(isNew ? 'Special bath' : `${sp.emoji} ${sp.name}`, `
    <label class="field"><span>Sento</span><select name="sentoId">${sentoOptions(sentoId)}</select></label>
    <label class="field"><span>Bath</span><input name="name" value="${esc(sp.name || '')}" placeholder="e.g. 柚子生姜風呂" autocomplete="off"></label>
    <div class="two">
      <label class="field"><span>From</span><input type="date" name="from" value="${esc(sp.from)}"></label>
      <label class="field"><span>To</span><input type="date" name="to" value="${esc(sp.to)}"></label>
    </div>
    <fieldset class="field"><legend>Emoji <em>picked from the name if you skip this</em></legend>
      <div class="emoji-picks">${emojiPicks.map(e => `<label><input type="radio" name="emoji" value="${e}" ${sp.emoji === e && !isNew ? 'checked' : ''}><span>${e}</span></label>`).join('')}</div>
    </fieldset>
    ${footer(isNew ? 'Add' : 'Save', isNew ? '' : deleteBtn)}`,
  (fd, act) => {
    const owner = S.sentos.find(s => (s.specials || []).some(x => x.id === sp.id));
    if (act === 'delete') {
      owner.specials = owner.specials.filter(x => x.id !== sp.id);
      touch(owner);
      return;
    }
    const name = fd.get('name').trim();
    const from = fd.get('from'), to = fd.get('to') || from;
    if (!name) { toast('Name the bath'); return false; }
    if (!from || to < from) { toast('Check the dates'); return false; }
    const style = specialStyle(name);
    const chosen = fd.get('emoji');
    const updated = { id: sp.id || uid(), name, from, to, emoji: chosen || style.emoji, color: style.color };
    if (owner) { owner.specials = owner.specials.filter(x => x.id !== sp.id); touch(owner); }
    const target = sentoOf(fd.get('sentoId'));
    target.specials = [...(target.specials || []), updated];
    touch(target);
  });
}

// Add a month of specials at once, in the poster's own format.
function openSpecialsBulk(sentoId) {
  openSheet('Add special baths', `
    <div class="two">
      <label class="field"><span>Sento</span><select name="sentoId">${sentoOptions(sentoId)}</select></label>
      <label class="field"><span>Month</span><input type="month" name="month" value="${calMonth}"></label>
    </div>
    <label class="field"><span>One bath per line</span>
      <textarea name="bulk" rows="7" placeholder="毎日 ミルク風呂&#10;2-4 ほうじ茶風呂&#10;9-11 ラベンダー刻み風呂&#10;30-11/1 JIKKO" autocapitalize="off"></textarea>
    </label>
    <div id="bulk-preview" class="bulk-preview"></div>
    ${footer('Add to calendar')}`,
  fd => {
    const { specials, bad } = parseSpecials(fd.get('bulk'), fd.get('month') || calMonth);
    if (!specials.length) { toast(bad.length ? `Couldn’t read: ${bad[0]}` : 'Type at least one bath'); return false; }
    const s = sentoOf(fd.get('sentoId'));
    s.specials = [...(s.specials || []), ...specials.map(sp => ({ id: uid(), ...sp }))];
    touch(s);
    calFilter = s.id;
    calMonth = (fd.get('month') || calMonth);
    toast(`Added ${specials.length} special bath${specials.length > 1 ? 's' : ''} 🎉`);
  });
}

function updateBulkPreview() {
  const box = $('#bulk-preview');
  if (!box) return;
  const { specials, bad } = parseSpecials(sheetForm.elements.bulk.value, sheetForm.elements.month.value || calMonth);
  box.innerHTML = specials.map(sp => `<span class="special-pill" style="--c:${sp.color}"><span>${sp.emoji}</span><b>${esc(sp.name)}</b><small>${span(sp) > 27 ? 'every day' : esc(rangeText(sp))}</small></span>`).join('')
    + bad.map(b => `<p class="hint warn">Can’t read “${esc(b)}”. Try “2-4 name”.</p>`).join('');
}
sheetForm.addEventListener('input', e => {
  if (e.target.name === 'bulk' || e.target.name === 'month') updateBulkPreview();
});

function openSettings() {
  openSheet('Settings', `
    <div class="two">
      <label class="field"><span>Your name</span><input name="a" value="${esc(S.names.a)}" autocomplete="given-name"></label>
      <label class="field"><span>Partner</span><input name="b" value="${esc(S.names.b)}"></label>
    </div>
    <label class="field"><span>🍓 Monthly soak goal <em>fills the strawberry milk</em></span>
      <input type="number" name="goal" min="1" max="31" inputmode="numeric" value="${monthlyGoal()}"></label>
    ${syncSection()}
    ${calendarSection()}
    <section class="sync">
      <h3>Backup</h3>
      <p><b>Export</b> saves everything to a file (AirDrop works). <b>Import</b> merges a file back in: the newer edit wins, and deletions carry over.</p>
      <div class="two">
        <button type="button" class="btn" data-action="export">Export</button>
        <button type="button" class="btn" data-action="import">Import</button>
      </div>
    </section>
    <p class="hint">App version ${VERSION}</p>
    ${footer('Save', '<button class="btn danger" value="reset">Erase all</button>')}`,
  (fd, act) => {
    if (act === 'reset') {
      const msg = sync.state.code
        ? `Erase everything on this phone and stop syncing? The shared copy stays for ${S.names.b || 'Moka'}.`
        : 'Erase all favourites and visits on this phone?';
      if (!confirm(msg)) return false;
      disconnect();
      S = freshState();
      idbDo('readwrite', st => st.clear()).catch(() => {});
      photoQ = { up: [], del: [] };
      savePhotoQ();
      return;
    }
    const names = { a: fd.get('a').trim(), b: fd.get('b').trim() || 'Moka' };
    if (names.a !== S.names.a || names.b !== S.names.b) {
      S.names = names;
      S.namesU = Date.now();
      markDirty('names', S.namesU);
    }
    const goal = Math.round(Number(fd.get('goal')));
    if (goal >= 1 && goal <= 31 && goal !== monthlyGoal()) {
      S.goal = { perMonth: goal };
      S.goalU = Date.now();
      markDirty('goal', S.goalU);
    }
  });
}

function syncSection() {
  if (!SYNC.url) return '';
  const st = sync.state;
  if (!st.code) {
    return `<section class="sync">
      <h3>Live sync</h3>
      <p>Share favourites and visits between both phones automatically. One of you starts, then invites the other.</p>
      <button type="button" class="btn primary" data-action="sync-start">Start sharing</button>
      <div class="join">
        <input name="joinCode" placeholder="Got a code? Paste it here" autocomplete="off" autocapitalize="off" spellcheck="false">
        <button type="button" class="btn" data-action="sync-join">Join</button>
      </div>
    </section>`;
  }
  return `<section class="sync">
    <h3>Live sync <span class="sync-state" id="sync-line" data-s="${sync.status}">${esc(syncStatusText())}</span></h3>
    <p>Shared code: <code>${esc(st.code)}</code><br>Both phones must show the same code.</p>
    <div class="two">
      <button type="button" class="btn primary" data-action="sync-invite">Invite ${esc(S.names.b || 'Moka')}</button>
      <button type="button" class="btn" data-action="sync-leave">Stop syncing</button>
    </div>
    <p>Different code on the other phone? Paste theirs here to join it. Your data comes along.</p>
    <div class="join">
      <input name="joinCode" placeholder="Partner’s code" autocomplete="off" autocapitalize="off" spellcheck="false">
      <button type="button" class="btn" data-action="sync-join">Join</button>
    </div>
  </section>`;
}

function lastSynced(at) {
  const m = Math.round((Date.now() - at) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : new Date(at).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// Export / import (manual sync)
// ---------------------------------------------------------------------------

async function exportData() {
  const name = `sento-${today()}.json`;
  const file = new File([JSON.stringify(S, null, 2)], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Sento data' }); } catch {}
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function merge(inc) {
  if (!inc || inc.v !== 1 || !Array.isArray(inc.visits)) throw new Error('That isn’t a Sento export');
  const dead = new Set([...S.deleted, ...(inc.deleted || [])]);
  for (const id of inc.deleted || []) if (!S.deleted.includes(id)) markDirty(id, Date.now());
  const mergeList = (mine, theirs = []) => {
    const map = new Map(mine.map(r => [r.id, r]));
    for (const r of theirs) {
      const cur = map.get(r.id);
      if (!cur || (r.u || 0) > (cur.u || 0)) {
        map.set(r.id, r);
        markDirty(r.id, r.u || 1);
      }
    }
    return [...map.values()].filter(r => !dead.has(r.id));
  };
  S.sentos = mergeList(S.sentos, inc.sentos);
  S.visits = mergeList(S.visits, inc.visits);
  S.deleted = [...dead];
  if (!S.names.a && inc.names?.a) S.names = { ...inc.names };
}

$('#import-file').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const before = S.visits.length + S.sentos.length;
    merge(JSON.parse(await f.text()));
    const added = S.visits.length + S.sentos.length - before;
    if (sheet.open) sheet.close();
    commit();
    toast(added > 0 ? `Merged — ${added} new item${added > 1 ? 's' : ''}` : 'Merged — already up to date');
  } catch (err) {
    toast(err.message.includes('Sento') ? err.message : 'That file couldn’t be read');
  }
});

// ---------------------------------------------------------------------------
// Live sync (Supabase, see supabase.sql)
// Each favourite, visit and the names are one record; the newest edit wins.
// `dirty` maps record id → edit time of local changes not yet pushed.
// ---------------------------------------------------------------------------

const SYNC = window.SENTO_SYNC || {};
const SYNC_KEY = 'sento:sync';
const sync = { state: loadSync(), status: 'off', busy: null, again: false, timer: 0 };

function loadSync() {
  const blank = { code: '', dirty: {}, at: 0 };
  try { return { ...blank, ...JSON.parse(localStorage.getItem(SYNC_KEY)) }; } catch { return blank; }
}
function saveSync() {
  try { localStorage.setItem(SYNC_KEY, JSON.stringify(sync.state)); } catch {}
}
function markDirty(id, u) {
  if (!sync.state.code) return;
  sync.state.dirty[id] = u;
  saveSync();
}

const normCode = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const prettyCode = s => normCode(s).match(/.{1,5}/g)?.join('-') || '';
function newCode() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  return prettyCode([...crypto.getRandomValues(new Uint8Array(20))].map(b => abc[b % abc.length]).join(''));
}
const inviteLink = code => `${location.origin}${location.pathname}#join=${normCode(code)}`;

function recordFor(id) {
  const u = sync.state.dirty[id];
  if (SINGLETONS.includes(id)) return { id, kind: id, data: S[id], u };
  const s = sentoOf(id);
  if (s) return { id, kind: 'sento', data: s, u };
  const v = visitOf(id);
  if (v) return { id, kind: 'visit', data: v, u };
  return { id, deleted: true, u };
}

function connect(code) {
  const dirty = {};
  for (const r of [...S.sentos, ...S.visits]) dirty[r.id] = r.u || 1;
  for (const id of S.deleted) dirty[id] = Date.now();
  for (const id of SINGLETONS) if (S[id + 'U']) dirty[id] = S[id + 'U'];
  sync.state = { code: prettyCode(code), dirty, at: 0 };
  sync.status = 'pending';
  saveSync();
  // Upload photos taken on this phone (ones that only exist on the other phone are skipped).
  for (const v of S.visits) for (const id of v.photos || []) queuePhoto('up', id);
  return runSync();
}

function disconnect() {
  sync.state = { code: '', dirty: {}, at: 0 };
  sync.status = 'off';
  saveSync();
  updateSyncDot();
}

// Merge server records in place, so a sheet that's open keeps editing the live object.
function applyRemote(records) {
  let changed = false;
  for (const r of records) {
    if (sync.state.dirty[r.id]) continue; // our newer local edit is still on its way up
    if (SINGLETONS.includes(r.id)) {
      const uKey = r.id + 'U';
      if (!r.deleted && r.u > (S[uKey] || 0)) { S[r.id] = { ...S[r.id], ...r.data }; S[uKey] = r.u; changed = true; }
      continue;
    }
    const key = r.kind === 'sento' ? 'sentos' : r.kind === 'visit' ? 'visits' : null;
    if (!key) continue;
    const local = S[key].find(x => x.id === r.id);
    if (r.deleted) {
      if (local) { S[key] = S[key].filter(x => x.id !== r.id); changed = true; }
      if (!S.deleted.includes(r.id)) S.deleted.push(r.id);
    } else if (!local) {
      S[key].push(r.data); changed = true;
    } else if (r.u > (local.u || 0)) {
      // Replace contents (not merge) so removed fields go too, but keep the same object.
      for (const k of Object.keys(local)) if (!(k in r.data)) delete local[k];
      Object.assign(local, r.data);
      changed = true;
    }
  }
  return changed;
}

// Call one of the Supabase functions from supabase.sql / supabase-photos.sql.
async function rpc(fn, body) {
  const headers = { 'Content-Type': 'application/json', apikey: SYNC.key };
  if (SYNC.key.startsWith('eyJ')) headers.Authorization = `Bearer ${SYNC.key}`; // legacy anon key
  const res = await fetch(`${SYNC.url.replace(/\/$/, '')}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`error ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function runSync() {
  if (!SYNC.url || !sync.state.code) return Promise.resolve();
  if (sync.busy) { sync.again = true; return sync.busy; }
  sync.busy = (async () => {
    const code = sync.state.code;
    const changes = Object.keys(sync.state.dirty).map(recordFor);
    sync.status = 'pending';
    updateSyncDot();
    try {
      const records = await rpc('sento_sync', { p_household: normCode(code), p_changes: changes });
      if (sync.state.code !== code) return; // disconnected meanwhile
      // Only clear what we sent; anything edited during the request stays dirty.
      for (const c of changes) if (sync.state.dirty[c.id] === c.u) delete sync.state.dirty[c.id];
      sync.state.at = Date.now();
      sync.status = 'ok';
      sync.error = '';
      saveSync();
      if (applyRemote(records)) {
        store.save(S);
        if (!sheet.open) render();
        fetchCalendar(); // picks up a calendar link added on the other phone
      }
      pushPhotos();
    } catch (err) {
      sync.status = 'error';
      sync.error = err.message;
      console.warn(err);
    } finally {
      sync.busy = null;
      updateSyncDot();
      if (sync.again) { sync.again = false; runSync(); }
    }
  })();
  return sync.busy;
}

function scheduleSync() {
  if (!sync.state.code) return;
  clearTimeout(sync.timer);
  sync.timer = setTimeout(runSync, 600);
}

function updateSyncDot() {
  const dot = $('#sync-dot');
  const waiting = Object.keys(sync.state.dirty).length || photoQ.up.length || photoQ.del.length;
  dot.dataset.s = sync.state.code ? (sync.status === 'ok' && waiting ? 'pending' : sync.status) : 'off';
  const line = $('#sync-line');
  if (line) { line.dataset.s = sync.status; line.textContent = syncStatusText(); }
}

function syncStatusText() {
  return {
    ok: `Synced ${sync.state.at ? lastSynced(sync.state.at) : ''}`,
    pending: 'Syncing…',
    error: navigator.onLine === false
      ? 'Offline — changes will sync when you’re back online'
      : `Can’t reach the sync server${sync.error ? ` (${sync.error})` : ''}`,
  }[sync.status] || 'Connecting…';
}

async function joinWith(code) {
  code = normCode(code);
  if (code.length < 16) { toast('That code looks too short'); return; }
  if (sync.state.code && normCode(sync.state.code) !== code &&
      !confirm('This phone is already syncing with another code. Switch?')) return;
  await connect(code);
  if (isIOS && !standalone) {
    toast('Joined in Safari. In the home-screen app, paste the code in Settings too', 6000);
  } else {
    toast(sync.status === 'ok' ? 'Connected — you’re in sync' : 'Joined — will sync when online');
  }
}

// iPhone keeps Safari and the home-screen app apart, so a link opened in Safari
// doesn't connect the installed app.
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

function invite() {
  const code = sync.state.code;
  const text = `Join our Sento app 🛁\n\n1. Open ${location.origin}${location.pathname} in Safari, then Share → Add to Home Screen.\n2. Open the app from your home screen → Settings → Live sync → paste this code → Join:\n\n${code}`;
  // Must run straight from the tap: iOS blocks the share sheet after an await.
  if (navigator.share) {
    navigator.share({ title: 'Sento invite', text }).catch(() => {});
    return;
  }
  if (!navigator.clipboard) { prompt('Copy this invite:', text); return; }
  navigator.clipboard.writeText(text).then(() => toast('Invite copied'), () => prompt('Copy this invite:', text));
}

// ---------------------------------------------------------------------------
// Photos (the さっぱり diary)
// Visits list photo ids in `photos`. Each photo is a small grid thumbnail and a
// larger image, kept on this phone in IndexedDB and uploaded to the shared space
// (supabase-photos.sql) so the other phone can download it.
// ---------------------------------------------------------------------------

const PHOTO_SIZES = { thumb: [360, 0.72], full: [1280, 0.8] }; // max px, JPEG quality
const PHOTOQ_KEY = 'sento:photoq';
let photoDb = null;

function idb() {
  photoDb ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('sento-photos', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('photos');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return photoDb;
}
async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', mode);
    const req = fn(tx.objectStore('photos'));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}
const photoBlob = (id, size) => idbDo('readonly', st => st.get(`${id}:${size}`)).catch(() => null);
const savePhotoBlob = (id, size, blob) => idbDo('readwrite', st => st.put(blob, `${id}:${size}`));
const dropPhotoBlobs = id => idbDo('readwrite', st => { st.delete(`${id}:thumb`); st.delete(`${id}:full`); }).catch(() => {});

// Shrink a picked/taken photo into both sizes and keep it on this phone.
async function addPhoto(file) {
  const src = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    const id = uid();
    for (const [size, [max, quality]] of Object.entries(PHOTO_SIZES)) {
      const r = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * r);
      canvas.height = Math.round(img.naturalHeight * r);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
      if (!blob) throw new Error('Couldn’t read that photo');
      await savePhotoBlob(id, size, blob);
    }
    return id;
  } finally {
    URL.revokeObjectURL(src);
  }
}

// Object URLs for <img>, cached so re-renders don't flicker.
const photoUrls = new Map();    // "id:size" → url
const photoLoading = new Map(); // "id:size" → promise
const photoSrc = (id, size) => photoUrls.get(`${id}:${size}`) || '';

function photoUrl(id, size) {
  const key = `${id}:${size}`;
  if (photoUrls.has(key)) return Promise.resolve(photoUrls.get(key));
  if (!photoLoading.has(key)) {
    photoLoading.set(key, (async () => {
      let blob = await photoBlob(id, size);
      if (!blob && SYNC.url && sync.state.code) {
        try {
          const b64 = await rpc('sento_photo_get', { p_household: normCode(sync.state.code), p_id: id, p_full: size === 'full' });
          if (b64) {
            blob = fromBase64(b64);
            savePhotoBlob(id, size, blob).catch(() => {});
          }
        } catch {}
      }
      photoLoading.delete(key); // allow a retry later if it failed
      if (!blob) return '';
      const url = URL.createObjectURL(blob);
      photoUrls.set(key, url);
      return url;
    })());
  }
  return photoLoading.get(key);
}

// Fill in <img data-photo="id" data-size="thumb|full"> once their images are ready.
function hydratePhotos(root) {
  root.querySelectorAll('img[data-photo]:not([data-ready])').forEach(img => {
    const { photo, size } = img.dataset;
    photoUrl(photo, size).then(url => {
      if (url) { img.src = url; img.dataset.ready = '1'; }
      else if (!img.getAttribute('src')) img.closest('.tile, .photo-chip, .viewer')?.classList.add('missing');
    });
  });
}

const toBase64 = blob => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});
function fromBase64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'image/jpeg' });
}

// Uploads and deletions waiting for the shared space: { up: [ids], del: [ids] }
let photoQ = (() => { try { return { up: [], del: [], ...JSON.parse(localStorage.getItem(PHOTOQ_KEY)) }; } catch { return { up: [], del: [] }; } })();
let photoErr = '';
let photoPushing = false;
const savePhotoQ = () => { try { localStorage.setItem(PHOTOQ_KEY, JSON.stringify(photoQ)); } catch {} };

function queuePhoto(kind, id) {
  const other = kind === 'up' ? 'del' : 'up';
  photoQ[other] = photoQ[other].filter(x => x !== id);
  if (!photoQ[kind].includes(id)) photoQ[kind].push(id);
  savePhotoQ();
}

async function pushPhotos() {
  if (!SYNC.url || !sync.state.code || photoPushing || !(photoQ.up.length || photoQ.del.length)) return;
  photoPushing = true;
  const household = normCode(sync.state.code);
  const done = (kind, id) => { photoQ[kind] = photoQ[kind].filter(x => x !== id); savePhotoQ(); };
  try {
    for (const id of [...photoQ.up]) {
      const [thumb, full] = await Promise.all([photoBlob(id, 'thumb'), photoBlob(id, 'full')]);
      if (thumb && full) {
        await rpc('sento_photo_put', { p_household: household, p_id: id, p_thumb: await toBase64(thumb), p_image: await toBase64(full) });
      }
      done('up', id); // photos only on the other phone have nothing to upload
    }
    for (const id of [...photoQ.del]) {
      await rpc('sento_photo_delete', { p_household: household, p_id: id });
      done('del', id);
    }
    photoErr = '';
  } catch (err) {
    photoErr = /404/.test(err.message) ? 'photo sharing isn’t set up in Supabase yet' : 'couldn’t upload, will retry';
    console.warn(err);
  } finally {
    photoPushing = false;
    updateSyncDot();
    if (tab === 'diary' && !sheet.open) render();
  }
}

// Remove a photo everywhere: this phone, the shared space and any open <img>.
function forgetPhoto(id) {
  dropPhotoBlobs(id);
  for (const size of Object.keys(PHOTO_SIZES)) {
    const url = photoUrls.get(`${id}:${size}`);
    if (url) { URL.revokeObjectURL(url); photoUrls.delete(`${id}:${size}`); }
  }
  if (sync.state.code) queuePhoto('del', id);
  else { photoQ.up = photoQ.up.filter(x => x !== id); savePhotoQ(); }
}

// Every diary photo, newest visit first.
const diaryPhotos = () => pastVisits().flatMap(v => (v.photos || []).map(id => ({ id, v })));

// ---------------------------------------------------------------------------
// Google Calendar (via the Apps Script in google-apps-script/Code.gs)
// The script returns only merged busy ranges [[startMs, endMs], …].
// The link + key live in S.calendar, so live sync hands them to the other phone.
// ---------------------------------------------------------------------------

const CAL_KEY = 'sento:cal';
const CAL_FRESH = 15 * 60000;     // refetch after 15 min
const CAL_RETRY = 2 * 60000;      // after an error, wait before retrying
const CAL_USABLE = 12 * 3600000;  // offline: trust busy times this old at most
let cal = (() => { try { return JSON.parse(localStorage.getItem(CAL_KEY)) || {}; } catch { return {}; } })();
let calBusy = null;

function calSrc() {
  const { url = '', key = '' } = S.calendar || {};
  if (!url.trim() || !key.trim()) return '';
  return `${url.trim()}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(key.trim())}`;
}
const calReady = () => !!calSrc() && cal.src === calSrc() && Array.isArray(cal.busy) && Date.now() - (cal.fetchedAt || 0) < CAL_USABLE;

function fetchCalendar(force = false) {
  const src = calSrc();
  if (!src) return Promise.resolve();
  if (calBusy) return calBusy;
  if (!force && cal.src === src) {
    if (!cal.error && Date.now() - (cal.fetchedAt || 0) < CAL_FRESH) return Promise.resolve();
    if (cal.error && Date.now() - (cal.triedAt || 0) < CAL_RETRY) return Promise.resolve();
  }
  calBusy = (async () => {
    const triedAt = Date.now();
    try {
      let data;
      try {
        const res = await fetch(src);
        data = await res.json();
      } catch {
        throw new Error(navigator.onLine === false
          ? 'offline'
          : 'couldn’t read the link. Check the deployment is set to “Anyone”');
      }
      if (data.error) throw new Error(data.error === 'unauthorized' ? 'the key doesn’t match. Run setup again and copy the key' : data.error);
      cal = { src, busy: data.busy || [], problems: data.problems || [], fetchedAt: Date.now(), triedAt };
    } catch (err) {
      // Keep the last good busy times for this link, if any
      cal = cal.src === src ? { ...cal, error: err.message, triedAt } : { src, error: err.message, triedAt };
    } finally {
      try { localStorage.setItem(CAL_KEY, JSON.stringify(cal)); } catch {}
      calBusy = null;
      if (!sheet.open) render();
      const line = $('#cal-line');
      if (line) { line.dataset.s = calState(); line.textContent = calStatusText(); }
    }
  })();
  return calBusy;
}

const calState = () => calBusy ? 'pending' : cal.error ? 'error' : cal.fetchedAt ? 'ok' : 'pending';
function calStatusText() {
  if (calBusy) return 'Checking…';
  if (cal.error) return `Problem: ${cal.error}`;
  if (cal.problems?.length) return 'Partly working';
  return cal.fetchedAt ? `Checked ${lastSynced(cal.fetchedAt)}` : 'Not checked yet';
}

function calendarSection() {
  if (!calSrc()) {
    return `<section class="sync">
      <h3>Google Calendar</h3>
      <p>Only suggest times when you’re both free for 2 hours. Set up the helper script first (README → “Google Calendar suggestions”), then paste its web app URL and key here.</p>
      <label class="field"><span>Web app URL</span><input name="calUrl" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="url"></label>
      <label class="field"><span>Key</span><input name="calKey" placeholder="From the setup log" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <button type="button" class="btn primary" data-action="cal-connect">Connect calendars</button>
    </section>`;
  }
  return `<section class="sync">
    <h3>Google Calendar <span class="sync-state" id="cal-line" data-s="${calState()}">${esc(calStatusText())}</span></h3>
    <p>Suggestions only show 2-hour windows when you’re both free.</p>
    ${(cal.problems || []).map(p => `<p class="hint warn">${esc(p)}</p>`).join('')}
    <div class="two">
      <button type="button" class="btn" data-action="cal-check">Check now</button>
      <button type="button" class="btn" data-action="cal-off">Disconnect</button>
    </div>
  </section>`;
}

function setCalendar(url, key) {
  S.calendar = { url, key };
  S.calendarU = Date.now();
  markDirty('calendar', S.calendarU);
  cal = {};
  try { localStorage.removeItem(CAL_KEY); } catch {}
  store.save(S);
  scheduleSync();
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

const actions = {
  settings: openSettings,
  log: (_, el) => openVisit({ id: uid(), date: el?.dataset.date || today(), sentoId: el?.dataset.sento || pastVisits()[0]?.sentoId, rating: 0, note: '' }),
  'sento-view': (_, el) => { sentoView = el.dataset.v; render(); },
  'milk-info': (_, el) => milkInfo(el.dataset.kind),
  'cal-filter': id => { calFilter = id; render(); },
  'cal-month': (_, el) => {
    const d = Number(el.dataset.d);
    if (!d) calMonth = today().slice(0, 7);
    else { const [y, m] = calMonth.split('-').map(Number); calMonth = ymd(new Date(y, m - 1 + d, 1)).slice(0, 7); }
    render();
  },
  'cal-day': (_, el) => openDay(el.dataset.date),
  'edit-special': id => {
    const s = S.sentos.find(x => (x.specials || []).some(sp => sp.id === id));
    if (s) openSpecial(s.specials.find(sp => sp.id === id), s.id);
  },
  'add-special': (_, el) => {
    if (!S.sentos.length) { toast('Add a sento first'); return; }
    const date = el.dataset.date || today();
    openSpecial({ from: date, to: date }, sentoOf(calFilter)?.id || S.sentos.slice().sort(byName)[0].id);
  },
  'add-specials': () => openSpecialsBulk(sentoOf(calFilter)?.id || S.sentos.slice().sort(byName)[0]?.id),
  'edit-visit': id => openVisit(visitOf(id)),
  'new-sento': () => openSento({ id: uid(), name: '', closed: [] }),
  'edit-sento': id => openSento(sentoOf(id)),
  export: exportData,
  import: () => $('#import-file').click(),
  'sync-start': () => {
    connect(newCode());
    openSettings();
    invite();
  },
  'sync-join': () => joinWith($('[name=joinCode]').value).then(() => sync.state.code && openSettings()),
  'sync-invite': invite,
  'view-photo': id => id && openPhoto(id),
  'delete-photo': id => {
    const v = S.visits.find(x => x.photos?.includes(id));
    if (!v || !confirm('Delete this photo from your diary on both phones?')) return;
    v.photos = v.photos.filter(x => x !== id);
    forgetPhoto(id);
    touch(v);
    sheet.close();
    commit();
  },
  'cal-connect': async () => {
    const url = $('[name=calUrl]').value.trim();
    const key = $('[name=calKey]').value.trim();
    if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) { toast('That URL should start with https://script.google.com/'); return; }
    if (!key) { toast('Paste the key from the setup log too'); return; }
    setCalendar(url, key);
    openSettings();
    await fetchCalendar(true);
    if (sheet.open) openSettings();
    toast(cal.error ? `Calendar: ${cal.error}` : cal.problems?.length ? cal.problems[0] : 'Calendars connected 🎉', 5000);
  },
  'cal-check': async () => {
    await fetchCalendar(true);
    if (sheet.open) openSettings();
    if (!cal.error && !cal.problems?.length) toast('Calendars look good');
  },
  'cal-off': () => {
    if (!confirm('Stop using Google Calendar for suggestions on both phones?')) return;
    setCalendar('', '');
    openSettings();
  },
  'sync-leave': () => {
    if (!confirm('Stop syncing on this phone? Your data stays here, and the shared copy stays online.')) return;
    disconnect();
    openSettings();
  },
};

document.addEventListener('click', e => {
  const t = e.target.closest('[data-action],[data-tab]');
  if (!t) return;
  if (t.dataset.tab) {
    tab = t.dataset.tab;
    render();
    window.scrollTo(0, 0);
    return;
  }
  actions[t.dataset.action]?.(t.dataset.id, t);
});

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), ms);
}

// Keep "today" and open/closed status fresh, and pull your partner's changes.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (!sheet.open) render();
  runSync();
  fetchCalendar();
});
setInterval(() => { if (!document.hidden && !sheet.open) render(); }, 60000);
setInterval(() => { if (!document.hidden) { runSync(); fetchCalendar(); } }, 20000);
addEventListener('online', () => runSync());

if ('serviceWorker' in navigator) {
  // When a new version takes over, reload once so it's used straight away.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !sheet.open) location.reload();
  });
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').then(r => r.update()).catch(() => {}));
}

render();
updateSyncDot();

// Invite links look like …/sento/#join=<code>
const joinHash = location.hash.match(/^#join=([a-z0-9-]+)/i);
if (joinHash) {
  history.replaceState(null, '', location.pathname);
  if (normCode(joinHash[1]) !== normCode(sync.state.code)) joinWith(joinHash[1]);
}
runSync();
fetchCalendar();
