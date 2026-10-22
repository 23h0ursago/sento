/**
 * Sento ⇄ Google Calendar helper.
 *
 * Tells the Sento app when either of you is busy over the next few days, so it
 * can suggest times you're both free. Only busy time ranges leave Google —
 * no event titles, details, or which of you is busy.
 *
 * Setup: see README → "Google Calendar suggestions".
 */

// 1. Put Moka's Google Calendar address here (usually their Gmail address).
const CALENDARS = [
  'primary',                 // your own main calendar
  'MOKA_EMAIL@gmail.com',    // Moka's calendar, shared with you
];

const DAYS_AHEAD = 8;

function doGet(e) {
  const key = PropertiesService.getScriptProperties().getProperty('KEY');
  if (!key || !e || !e.parameter || e.parameter.key !== key) return json_({ error: 'unauthorized' });

  const now = new Date();
  const end = new Date(now.getTime() + DAYS_AHEAD * 864e5);
  const result = freeBusy_(now, end);
  return json_({ busy: result.busy, problems: result.problems, from: now.getTime(), to: end.getTime() });
}

/** Run once after deploying: creates your private key and checks both calendars. */
function setup() {
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('KEY');
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '');
    props.setProperty('KEY', key);
  }

  const now = new Date();
  const result = freeBusy_(now, new Date(now.getTime() + 864e5));
  CALENDARS.forEach(id => {
    const problem = result.problems.find(p => p.indexOf(label_(id)) === 0);
    Logger.log(problem ? '✗ ' + problem : '✓ ' + label_(id) + ' calendar works');
  });
  Logger.log('Your key for the Sento app (keep it private):');
  Logger.log(key);
}

/** Run this if your key ever leaks. You'll need to paste the new key into the app. */
function newKey() {
  PropertiesService.getScriptProperties().deleteProperty('KEY');
  setup();
}

function freeBusy_(start, end) {
  if (CALENDARS.some(id => id.indexOf('MOKA_EMAIL') === 0)) {
    return { busy: [], problems: ["Moka's calendar address isn't filled in yet (top of Code.gs)"] };
  }
  const ids = CALENDARS.map(id => id === 'primary' ? CalendarApp.getDefaultCalendar().getId() : id.trim());
  const res = Calendar.Freebusy.query({
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    items: ids.map(id => ({ id: id })),
  });

  const busy = [];
  const problems = [];
  ids.forEach((realId, i) => {
    const id = CALENDARS[i];
    const cal = res.calendars[realId];
    if (!cal || (cal.errors && cal.errors.length)) {
      const reason = cal && cal.errors && cal.errors[0] && cal.errors[0].reason;
      problems.push(label_(id) + ' calendar: ' + (reason === 'notFound'
        ? "can't see it yet. Is it shared with you?"
        : 'error (' + (reason || 'unknown') + ')'));
      return;
    }
    (cal.busy || []).forEach(b => busy.push([Date.parse(b.start), Date.parse(b.end)]));
  });

  // Merge overlaps, so nothing reveals whose event is whose.
  busy.sort((a, b) => a[0] - b[0]);
  const merged = [];
  busy.forEach(b => {
    const last = merged[merged.length - 1];
    if (last && b[0] <= last[1]) last[1] = Math.max(last[1], b[1]);
    else merged.push(b.slice());
  });
  return { busy: merged, problems: problems };
}

function label_(id) {
  return id === 'primary' ? 'Your' : "Moka's";
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
