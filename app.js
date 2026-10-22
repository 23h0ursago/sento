'use strict';

// ---------------------------------------------------------------------------
// Data
// Everything lives in one object, saved by `store`. To share live between two
// phones later, swap store.load/save for a backend (see README).
// ---------------------------------------------------------------------------

const VERSION = 4; // shown in Settings; keep in step with CACHE in sw.js
const KEY = 'sento:v1';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const $ = (s, el = document) => el.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const freshState = () => ({ v: 1, names: { a: '', b: 'Moka' }, calendar: { url: '', key: '' }, sentos: [], visits: [], deleted: [] });

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

// Opening/closing in minutes since midnight; a close at or before opening means after midnight.
function hoursOf(s) {
  if (!s.open || !s.close) return null;
  const open = mins(s.open);
  let close = mins(s.close);
  if (close <= open) close += 1440;
  return { open, close };
}

function openState(s) {
  const now = new Date();
  const h = hoursOf(s);
  if (s.closed?.includes(now.getDay())) return { cls: 'off', text: 'Closed today' };
  if (!h) return null;
  let t = now.getHours() * 60 + now.getMinutes();
  // Still inside yesterday's after-midnight hours?
  if (t < h.open && t + 1440 < h.close) t += 1440;
  if (t >= h.open && t < h.close) return { cls: 'on', text: `Open till ${s.close}` };
  if (t < h.open) return { cls: '', text: `Opens ${s.open}` };
  return { cls: '', text: 'Closed now' };
}

// ---------------------------------------------------------------------------
// "Should we go?" — nudge + suggested slots for the coming 7 days
// ---------------------------------------------------------------------------

function daysSinceLast() {
  const last = pastVisits().find(v => v.date <= today());
  return last ? daysBetween(last.date, today()) : null;
}

function nudge(days) {
  if (days === null) return { level: 1, head: 'Your first soak awaits', text: 'Nothing logged yet. Pick a time below and make it a habit.' };
  if (days === 0) return { level: 0, head: 'Fresh from the bath', text: 'You went today. Enjoy the afterglow ♨' };
  if (days <= 3) return { level: 0.2 + days * 0.05, head: 'No rush', text: `Last soak was ${days} day${days > 1 ? 's' : ''} ago. Maybe later this week?` };
  if (days <= 6) return { level: 0.5, head: 'A soak would be nice', text: `It’s been ${days} days. Here are some quiet times this week.` };
  if (days <= 13) return { level: 0.8, head: 'Time to go!', text: `${days} days without a proper bath. The sooner slots are at the top.` };
  return { level: 1, head: 'Seriously overdue', text: `${days} days?! Your shoulders are filing a complaint. Go as soon as you can.` };
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
      const h = hoursOf(s);
      if (!h || s.closed?.includes(dow)) continue;
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
        slots.push({ s, date, d, start: o.start, end: o.end, label: o.label, weekend, score });
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
const weekOf = date => Math.floor((dayNum(date) + 3) / 7);

function streaks() {
  const weeks = [...new Set(S.visits.filter(v => v.date <= today()).map(v => weekOf(v.date)))].sort((a, b) => a - b);
  let longest = 0, run = 0;
  weeks.forEach((w, i) => {
    run = i && w === weeks[i - 1] + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  });
  // Current streak stays alive through this week even before you’ve gone.
  const thisWeek = weekOf(today());
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
  view.innerHTML = tab === 'go' ? viewGo() : tab === 'sentos' ? viewSentos() : viewHistory();
}

function viewGo() {
  const since = daysSinceLast();
  const n = nudge(since);
  let h = `
    <section class="card nudge" style="--level:${n.level}">
      <div class="steam" aria-hidden="true"><i></i><i></i><i></i></div>
      <p class="eyebrow">${since === null ? 'Welcome' : since === 0 ? 'Last soak: today' : `Last soak: ${since} day${since > 1 ? 's' : ''} ago`}</p>
      <h2>${esc(n.head)}</h2>
      <p>${esc(n.text)}</p>
      <div class="meter" role="img" aria-label="Bath urge ${Math.round(n.level * 100)}%"><span></span></div>
      <button class="btn primary wide" data-action="log">+ Log a visit</button>
    </section>`;

  if (!S.sentos.length) {
    return h + `<section class="empty-note">
      <p>Add your favourite sento with their hours and closing day, and we’ll suggest quiet times to go.</p>
      <button class="btn" data-action="new-sento">Add a favourite</button></section>`;
  }

  const list = suggestions();
  const withCal = calReady();
  const missingHours = S.sentos.filter(s => !hoursOf(s));
  h += `<h3 class="section">Good times this week</h3>`;
  if (calSrc() && !withCal) {
    h += `<p class="hint warn">${cal.error ? `Couldn’t check your calendars (${esc(cal.error)}).` : 'Checking your calendars…'} Showing the usual quiet times for now.</p>`;
  } else if (withCal && cal.problems?.length) {
    h += `<p class="hint warn">${cal.problems.map(esc).join(' ')}</p>`;
  }
  if (!list.length) {
    h += `<p class="empty-note">${withCal
      ? `No 2-hour window in the next 7 days when you’re both free and a favourite is open.`
      : `No open slots in the next 7 days${missingHours.length ? ' — add opening hours to your favourites' : ''}.`}</p>`;
  } else {
    h += `<div class="list">${list.map((sl, i) => `
      <div class="row slot${i === 0 ? ' best' : ''}">
        <span class="when"><b>${esc(dayWord(sl.date))}</b><small>${hhmm(sl.start)}–${hhmm(sl.end)}</small></span>
        <span class="grow"><b>${esc(sl.s.name)}</b><small>${esc(sl.label)}${sl.weekend ? ' · weekend, may be busier' : ''}</small></span>
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

function viewSentos() {
  const list = S.sentos.slice().sort(byName);
  return `
    <div class="toolbar"><h2 class="page-title">Our favourites</h2><button class="btn primary small" data-action="new-sento">+ Add</button></div>
    ${list.length ? `<div class="list">${list.map(s => {
      const st = sentoStats(s.id);
      const os = openState(s);
      return `<button class="row sento" data-action="edit-sento" data-id="${s.id}">
        <span class="grow">
          <b>${esc(s.name)}</b>
          <small>${s.open && s.close ? `${esc(s.open)}–${esc(s.close)}` : 'Hours not set'}${s.closed?.length ? ` · Closed ${s.closed.slice().sort().map(d => DAYS[d]).join(', ')}` : ''}</small>
          <small>${st.count ? `${st.count} visit${st.count > 1 ? 's' : ''} · last ${esc(lastWord(st.last))}` : 'Not visited yet'}${st.avg ? ` · ★ ${st.avg.toFixed(1)}` : ''}</small>
        </span>
        ${os ? `<span class="status ${os.cls}">${esc(os.text)}</span>` : ''}
      </button>`;
    }).join('')}</div>`
    : `<p class="empty-note">No favourites yet. Add the sento you love (or want to try).</p>`}`;
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
      <span class="grow"><b>${esc(sentoOf(v.sentoId)?.name || 'Unknown sento')}</b>${v.note ? `<small class="note">${esc(v.note)}</small>` : ''}</span>
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
  onSheetSubmit = onSubmit;
  sheetForm.innerHTML = `
    <header class="sheet-head">
      <h2>${esc(title)}</h2>
      <button type="button" class="icon-btn" data-close aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </header>
    <div class="sheet-body">${body}</div>`;
  sheet.showModal();
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
});
sheetForm.addEventListener('change', e => {
  if (e.target.name === 'sentoId') $('#new-sento').hidden = e.target.value !== '__new';
});

function dayChips(selected = []) {
  return `<div class="chips">${[1, 2, 3, 4, 5, 6, 0].map(d => `
    <label class="chip-check"><input type="checkbox" name="closed" value="${d}" ${selected.includes(d) ? 'checked' : ''}><span>${DAYS[d]}</span></label>`).join('')}</div>`;
}

function openSento(s) {
  const isNew = !sentoOf(s.id);
  const st = isNew ? null : sentoStats(s.id);
  openSheet(isNew ? 'Add a favourite' : s.name, `
    <label class="field"><span>Name</span><input name="name" value="${esc(s.name)}" placeholder="e.g. Kosugiyu" autocomplete="off"></label>
    <div class="two">
      <label class="field"><span>Opens</span><input type="time" name="open" value="${esc(s.open || '15:00')}"></label>
      <label class="field"><span>Closes</span><input type="time" name="close" value="${esc(s.close || '00:00')}"></label>
    </div>
    <fieldset class="field"><legend>Regular closing day</legend>${dayChips(s.closed)}</fieldset>
    <label class="field"><span>Notes <em>optional</em></span><textarea name="notes" rows="2" placeholder="Address, what you love about it…">${esc(s.notes)}</textarea></label>
    ${st?.count ? `<p class="hint">${st.count} visit${st.count > 1 ? 's' : ''} logged here.</p>` : ''}
    ${footer(isNew ? 'Add' : 'Save', isNew ? '' : deleteBtn)}`,
  (fd, act) => {
    if (act === 'delete') {
      const n = sentoStats(s.id).count;
      if (!confirm(`Delete ${s.name}${n ? ` and its ${n} logged visit${n > 1 ? 's' : ''}` : ''}?`)) return false;
      S.sentos = remove(S.sentos, s.id);
      for (const v of S.visits.filter(v => v.sentoId === s.id)) S.visits = remove(S.visits, v.id);
      return;
    }
    const name = fd.get('name').trim();
    if (!name) { toast('Give it a name'); return false; }
    Object.assign(s, {
      name,
      open: fd.get('open'),
      close: fd.get('close'),
      closed: fd.getAll('closed').map(Number),
      notes: fd.get('notes').trim(),
    });
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
    <label class="field" id="new-sento" ${pickNew ? '' : 'hidden'}><span>New sento name</span><input name="newSento" autocomplete="off" placeholder="Added to your favourites"></label>
    <fieldset class="field"><legend>Rating <em>optional</em> <button type="button" class="link" data-clear-rating>clear</button></legend>
      <div class="stars">${[5, 4, 3, 2, 1].map(n => `
        <input type="radio" id="r${n}" name="rating" value="${n}" ${v.rating === n ? 'checked' : ''}><label for="r${n}" aria-label="${n} star${n > 1 ? 's' : ''}">★</label>`).join('')}
      </div>
    </fieldset>
    <label class="field"><span>Note <em>optional</em></span><textarea name="note" rows="3" placeholder="Hot bath was perfect, coffee milk after…">${esc(v.note)}</textarea></label>
    ${footer(isNew ? 'Log it' : 'Save', isNew ? '' : deleteBtn)}`,
  (fd, act) => {
    if (act === 'delete') {
      if (!confirm('Delete this visit?')) return false;
      S.visits = remove(S.visits, v.id);
      return;
    }
    const date = fd.get('date');
    if (!date) { toast('Pick a date'); return false; }
    let sentoId = fd.get('sentoId');
    if (sentoId === '__new') {
      const name = (fd.get('newSento') || '').trim();
      if (!name) { toast('Name the new sento'); return false; }
      const s = touch({ id: uid(), name, open: '', close: '', closed: [], notes: '' });
      S.sentos.push(s);
      sentoId = s.id;
      toast(`${name} added — set its hours in Favourites`);
    }
    Object.assign(v, { date, sentoId, rating: Number(fd.get('rating')) || 0, note: fd.get('note').trim() });
    touch(v);
    if (isNew) S.visits.push(v);
  });
}

function openSettings() {
  openSheet('Settings', `
    <div class="two">
      <label class="field"><span>Your name</span><input name="a" value="${esc(S.names.a)}" autocomplete="given-name"></label>
      <label class="field"><span>Partner</span><input name="b" value="${esc(S.names.b)}"></label>
    </div>
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
      return;
    }
    const names = { a: fd.get('a').trim(), b: fd.get('b').trim() || 'Moka' };
    if (names.a !== S.names.a || names.b !== S.names.b) {
      S.names = names;
      S.namesU = Date.now();
      markDirty('names', S.namesU);
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
  if (id === 'names' || id === 'calendar') return { id, kind: id, data: S[id], u };
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
  if (S.namesU) dirty.names = S.namesU;
  if (S.calendarU) dirty.calendar = S.calendarU;
  sync.state = { code: prettyCode(code), dirty, at: 0 };
  sync.status = 'pending';
  saveSync();
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
    if (r.id === 'names' || r.id === 'calendar') {
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
      Object.assign(local, r.data); changed = true;
    }
  }
  return changed;
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
      const headers = { 'Content-Type': 'application/json', apikey: SYNC.key };
      if (SYNC.key.startsWith('eyJ')) headers.Authorization = `Bearer ${SYNC.key}`; // legacy anon key
      const res = await fetch(`${SYNC.url.replace(/\/$/, '')}/rest/v1/rpc/sento_sync`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ p_household: normCode(code), p_changes: changes }),
      });
      if (!res.ok) throw new Error(`error ${res.status}`);
      const records = await res.json();
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
  dot.dataset.s = sync.state.code ? (sync.status === 'ok' && Object.keys(sync.state.dirty).length ? 'pending' : sync.status) : 'off';
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
  log: () => openVisit({ id: uid(), date: today(), sentoId: pastVisits()[0]?.sentoId, rating: 0, note: '' }),
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
