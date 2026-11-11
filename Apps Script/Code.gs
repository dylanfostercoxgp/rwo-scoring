/* RWO Scoring v3 - Google Apps Script backend.
 * Files in this Apps Script project:
 *   Code.gs    (this file)
 *   Engine.gs  (exact copy of engine.js from the iPad app)
 *   Viewer.html (public Results / Standings / Qualifying page)
 *
 * The iPads send events here (doPost) and read everyone's events back (doGet?action=pull).
 * The EVENTS tab is the permanent record. Every other tab is rebuilt from it.
 */

var TAB = {
  SETTINGS: 'SETTINGS', ENTRIES: 'ENTRIES', STARTS: 'RACE_STARTS', EVENTS: 'EVENTS',
  STANDINGS: 'STANDINGS', WEB_RESULTS: 'WEB_RESULTS', WEB_POINTS: 'WEB_POINTS',
  QUAL: 'QUALIFYING', LOG: 'CHANGE_LOG', SEASON_LOG: 'SEASON_LOG', SEASON: 'SEASON_STANDINGS'
};
var RENDER_EVERY_MS = 8000;

/* ================= menu ================= */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('RWO Scoring')
    .addItem('1. Set up tabs (first time, safe to re-run)', 'setupSheets')
    .addItem('2. Turn on auto-refresh (once)', 'installTrigger')
    .addSeparator()
    .addItem('Refresh all result tabs now', 'renderAllNow')
    .addItem('Show web app links', 'showLinks')
    .addSeparator()
    .addItem('Save this event to season standings', 'saveToSeason')
    .addItem('Start a new event (archives this one)', 'startNewEvent')
    .addToUi();
}

/* ================= setup ================= */
function setupSheets() {
  var ss = SpreadsheetApp.getActive();
  var s = sheet_(ss, TAB.SETTINGS, '#5f6368');
  if (s.getLastRow() < 2) {
    s.getRange(1, 1, 4, 2).setValues([
      ['Setting', 'Value'],
      ['Event Name', 'New Event'],
      ['PINs (comma separated)', 'Dylan, Brittany, Holly, Jules, rwo2026ts, rwoscoring-2026'],
      ['Public pages show', 'Working results while racing']
    ]);
    s.getRange('A1:B1').setFontWeight('bold');
    s.setColumnWidth(1, 220); s.setColumnWidth(2, 460);
  }
  var en = sheet_(ss, TAB.ENTRIES, '#0f9d58');
  if (en.getLastRow() < 1) en.getRange(1, 1, 1, 3).setValues([['Class', 'Boat #', 'Team Name']]).setFontWeight('bold');
  en.getRange('B:B').setNumberFormat('@'); // keep "03" as 03
  en.setColumnWidth(1, 160); en.setColumnWidth(3, 320); en.setFrozenRows(1);
  var st = sheet_(ss, TAB.STARTS, '#c0392b');
  if (st.getLastRow() < 1) st.getRange(1, 1, 1, 5).setValues([['Day', 'Race #', 'Start #', 'Laps', 'Class(es)']]).setFontWeight('bold');
  st.setColumnWidth(5, 400); st.setFrozenRows(1);
  var ev = sheet_(ss, TAB.EVENTS, '#202124');
  if (ev.getLastRow() < 1) ev.getRange(1, 1, 1, 7).setValues([['Received', 'ID', 'Type', 'Race', 'Device', 'Who', 'Data (do not edit)']]).setFontWeight('bold');
  ev.setFrozenRows(1);
  var sl = sheet_(ss, TAB.SEASON_LOG, '#8e24aa');
  if (sl.getLastRow() < 1) sl.getRange(1, 1, 1, 8).setValues([['Event', 'Class', 'Boat #', 'Team', 'APBA Race Pts', 'Bonus', 'Weekend Total', 'UIM']]).setFontWeight('bold');
  sl.getRange('C:C').setNumberFormat('@');
  [TAB.STANDINGS, TAB.WEB_RESULTS, TAB.WEB_POINTS, TAB.QUAL, TAB.SEASON, TAB.LOG].forEach(function (n) { sheet_(ss, n, '#1a73e8'); });
  ['Sheet1'].forEach(function (n) { var x = ss.getSheetByName(n); if (x && ss.getSheets().length > 1 && x.getLastRow() === 0) ss.deleteSheet(x); });
  renderAll_(true);
  SpreadsheetApp.getUi().alert('Tabs are ready.\n\nNext: paste your entry list into ENTRIES and your schedule into RACE_STARTS, then follow the setup guide to deploy the web app.');
}

function sheet_(ss, name, color) {
  var s = ss.getSheetByName(name);
  if (!s) { s = ss.insertSheet(name); if (color) s.setTabColor(color); }
  return s;
}

function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'renderTick') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('renderTick').timeBased().everyMinutes(1).create();
  SpreadsheetApp.getUi().alert('Auto-refresh is on. Result tabs rebuild every minute even if no iPad is sending.');
}

function showLinks() {
  var url = ScriptApp.getService().getUrl() || '(not deployed yet: Deploy > New deployment > Web app)';
  SpreadsheetApp.getUi().alert('Web app URL (paste this into each iPad app):\n' + url +
    '\n\nPublic pages:\n' + url + '?view=results\n' + url + '?view=standings\n' + url + '?view=qualifying');
}

/* ================= config + events ================= */
function readConfig_(ss) {
  var entries = [], starts = [];
  var en = ss.getSheetByName(TAB.ENTRIES);
  if (en && en.getLastRow() > 1) {
    en.getRange(2, 1, en.getLastRow() - 1, 3).getDisplayValues().forEach(function (r) {
      var cls = String(r[0]).trim(), num = String(r[1]).trim();
      if (cls && num) entries.push({ cls: cls, num: num, team: String(r[2]).trim() });
    });
  }
  var st = ss.getSheetByName(TAB.STARTS);
  if (st && st.getLastRow() > 1) {
    st.getRange(2, 1, st.getLastRow() - 1, 5).getDisplayValues().forEach(function (r) {
      var race = parseInt(r[1], 10);
      if (!race) return;
      starts.push({ day: String(r[0]).trim(), race: race, start: parseInt(r[2], 10) || 1, laps: parseInt(r[3], 10) || 0,
        classes: String(r[4]).split(',').map(function (c) { return c.trim(); }).filter(String) });
    });
  }
  return { entries: entries, starts: starts };
}

function settings_(ss) {
  var s = ss.getSheetByName(TAB.SETTINGS), out = { eventName: 'Event', pins: [], publicOfficialOnly: false };
  if (!s || s.getLastRow() < 2) return out;
  s.getRange(2, 1, s.getLastRow() - 1, 2).getDisplayValues().forEach(function (r) {
    var k = String(r[0]).toLowerCase();
    if (k.indexOf('event name') === 0) out.eventName = r[1];
    if (k.indexOf('pin') === 0) out.pins = String(r[1]).split(',').map(function (p) { return p.trim(); }).filter(String);
    if (k.indexOf('public') === 0) out.publicOfficialOnly = /official only/i.test(r[1]);
  });
  return out;
}

function readEvents_(ss, since) {
  var s = ss.getSheetByName(TAB.EVENTS), last = s.getLastRow(), out = [];
  since = Math.max(0, since || 0);
  var count = last - 1;
  if (count > since) {
    s.getRange(2 + since, 7, count - since, 1).getValues().forEach(function (r) {
      try { out.push(JSON.parse(r[0])); } catch (err) { /* skip a damaged row */ }
    });
  }
  return { events: out, next: Math.max(count, since) };
}

function checkPin_(ss, pin) {
  var pins = settings_(ss).pins;
  for (var i = 0; i < pins.length; i++) if (pins[i] === String(pin || '').trim()) return pins[i];
  return null;
}

/* ================= web API ================= */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.view) {
    var t = HtmlService.createTemplateFromFile('Viewer');
    t.view = p.view;
    return t.evaluate().setTitle('RWO Live Results').addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  var ss = SpreadsheetApp.getActive();
  if (p.action === 'pull') {
    var who = checkPin_(ss, p.pin);
    if (!who) return json_({ ok: false, error: 'Wrong PIN' });
    var r = readEvents_(ss, parseInt(p.since, 10) || 0);
    return json_({ ok: true, who: who, events: r.events, next: r.next, cfg: readConfig_(ss), eventName: settings_(ss).eventName, eventId: eventId_(), serverTime: Date.now() });
  }
  if (p.action === 'ping') return json_({ ok: true, serverTime: Date.now() });
  return json_({ ok: true, app: 'RWO Scoring v3', hint: 'Add ?view=results or ?view=standings for public pages' });
}

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Bad request' }); }
  var ss = SpreadsheetApp.getActive();
  var who = checkPin_(ss, body.pin);
  if (!who) return json_({ ok: false, error: 'Wrong PIN' });
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return json_({ ok: false, retry: true, error: 'Busy, will retry' });
  var saved = [];
  try {
    var s = ss.getSheetByName(TAB.EVENTS), last = s.getLastRow(), have = {};
    if (last > 1) s.getRange(2, 2, last - 1, 1).getValues().forEach(function (r) { have[r[0]] = 1; });
    var rows = [], now = new Date();
    (body.events || []).forEach(function (ev) {
      if (!ev || !ev.id || !ev.type) return;
      if (!have[ev.id]) {
        ev.who = ev.who || who;
        rows.push([now, ev.id, ev.type, ev.race || '', ev.devName || ev.dev || '', ev.who, JSON.stringify(ev)]);
        have[ev.id] = 1;
      }
      saved.push(ev.id);
    });
    if (rows.length) {
      s.getRange(last + 1, 1, rows.length, 7).setValues(rows);
      SpreadsheetApp.flush();
      CacheService.getScriptCache().remove('public');
    }
  } finally {
    lock.releaseLock();
  }
  try { maybeRender_(); } catch (err) { /* results tabs can wait; the taps are saved */ }
  return json_({ ok: true, saved: saved });
}

function eventId_() {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('eventId');
  if (!id) { id = Utilities.getUuid(); props.setProperty('eventId', id); }
  return id;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ================= rendering result tabs ================= */
function maybeRender_() {
  var props = PropertiesService.getScriptProperties();
  var last = Number(props.getProperty('lastRender') || 0);
  if (Date.now() - last < RENDER_EVERY_MS) return;
  renderAll_(false);
}
function renderTick() { renderAll_(false); }
function renderAllNow() { renderAll_(true); SpreadsheetApp.getActive().toast('All result tabs rebuilt.'); }

function renderAll_(force) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    var ss = SpreadsheetApp.getActive(), props = PropertiesService.getScriptProperties();
    var evTab = ss.getSheetByName(TAB.EVENTS);
    if (!evTab) return;
    var count = evTab.getLastRow();
    if (!force && String(count) === props.getProperty('renderedCount')) { props.setProperty('lastRender', String(Date.now())); return; }
    props.setProperty('lastRender', String(Date.now()));
    var cfg = readConfig_(ss), events = readEvents_(ss, 0).events, set = settings_(ss);
    var voided = RWO.isVoided(events), races = RWO.raceNumbers(cfg), cache = {};
    races.forEach(function (r) { cache[r] = RWO.computeRace(cfg, events, r, voided); });

    // RESULTS_n (working) per race
    races.forEach(function (r) { writeTab_(ss, 'RESULTS_' + r, raceRows_(cache[r], set.eventName, false), force); });
    // WEB_RESULTS: official races only, simple fixed layout for the website
    var web = [[set.eventName + ' - Official Results', '', '', '', '', '', '', '']];
    var anyOfficial = false;
    races.forEach(function (r) {
      if (!cache[r].official) return;
      anyOfficial = true;
      cache[r].classes.forEach(function (C) {
        web.push(['']);
        web.push(['#H#Race ' + r + ' (' + cache[r].day + ') - ' + C.cls + ' - ' + C.laps + ' laps']);
        web.push(['#C#Pos', 'Boat #', 'Team', 'Laps', 'Time', 'Gap', 'APBA Pts', C.uim ? 'UIM Pts' : '', 'Penalty']);
        C.rows.forEach(function (x) {
          web.push([x.posLabel || x.status, x.num, x.team, x.laps, statusOrTime_(x), x.gap, x.apba, C.uim ? x.uim : '', penText_(x)]);
        });
      });
    });
    if (!anyOfficial) web.push(['No races are official yet.']);
    writeTab_(ss, TAB.WEB_RESULTS, web, force);

    var working = RWO.computeStandings(cfg, events, false, cache);
    var official = RWO.computeStandings(cfg, events, true, cache);
    writeTab_(ss, TAB.STANDINGS, standingsRows_(working, set.eventName + ' - Points (WORKING, includes unofficial races)', true), force);
    writeTab_(ss, TAB.WEB_POINTS, standingsRows_(official, set.eventName + ' - Points (Official)', false), force);
    writeTab_(ss, TAB.QUAL, qualRows_(RWO.computeQual(cfg, events), set.eventName), force);
    var log = [['When', 'Race', 'Who', 'What']];
    RWO.changeLog(events).slice(0, 1000).forEach(function (l) { log.push([new Date(l.at), l.race, l.who, l.what]); });
    writeTab_(ss, TAB.LOG, log, force);
    writeSeason_(ss, force);
    props.setProperty('renderedCount', String(count));
  } finally {
    lock.releaseLock();
  }
}

function statusOrTime_(x) {
  if (x.status === 'FINISHED' || x.status === 'RACING') return x.adjStr;
  if (x.status === 'LAPS DOWN') return x.adjStr;
  return x.status;
}
function penText_(x) {
  return (x.penalties || []).map(function (p) {
    var name = p.ptype === 'custom' ? (p.label || 'Other') : RWO.PEN_TYPES[p.ptype];
    return name + (p.amount ? ' ' + p.amount : '') + (p.reason ? ' (' + p.reason + ')' : '');
  }).join('; ');
}

function raceRows_(R, eventName, x) {
  var maxLaps = 0;
  R.classes.forEach(function (C) { if (C.laps > maxLaps) maxLaps = C.laps; C.rows.forEach(function (r) { if (r.laps > maxLaps) maxLaps = r.laps; }); });
  var rows = [[eventName + ' - Race ' + R.race + ' (' + R.day + ') - ' + R.status + (R.official ? ' - OFFICIAL' : ' - WORKING')]];
  R.classes.forEach(function (C) {
    rows.push(['']);
    rows.push(['#H#' + C.cls + ' - ' + C.laps + ' laps' + (C.uim ? ' - UIM + APBA' : '')]);
    var head = ['#C#Pos', 'Boat #', 'Team', 'Laps', 'Status', 'Total Time', 'Penalty Secs', 'Adj Time', 'Gap', 'APBA Pts', 'UIM Pts', 'Penalty Notes'];
    for (var i = 1; i <= maxLaps; i++) head.push('Lap ' + i);
    rows.push(head);
    C.rows.forEach(function (r) {
      var row = [r.posLabel, r.num, r.team, r.laps, r.status, r.totalStr, r.penSecs || '', r.adjStr, r.gap, r.apba, C.uim ? r.uim : '', penText_(r)];
      for (var j = 0; j < maxLaps; j++) row.push(r.times[j] != null ? RWO.fmt(r.times[j]) : '');
      rows.push(row);
    });
  });
  return rows;
}

function standingsRows_(list, title, showWorkingNote) {
  var rows = [[title]];
  list.forEach(function (C) {
    rows.push(['']);
    rows.push(['#H#' + C.cls + (C.uim ? ' - UIM + APBA' : '') + (C.complete ? '' : ' - bonus added after last race')]);
    var head = ['#C#Pos', 'Boat #', 'Team'];
    C.races.forEach(function (r) { head.push('Race ' + r + ' APBA'); if (C.uim) head.push('Race ' + r + ' UIM'); });
    head.push('Bonus', 'APBA Total');
    if (C.uim) head.push('UIM Total');
    head.push('Note');
    rows.push(head);
    if (!C.rows.length) { rows.push(['No boats entered']); return; }
    C.rows.forEach(function (b) {
      var row = [b.pos, b.num, b.team];
      C.races.forEach(function (r) {
        var x = b.races[r];
        row.push(x ? x.apba : '');
        if (C.uim) row.push(x ? x.uim : '');
      });
      row.push(b.bonus, b.total);
      if (C.uim) row.push(b.uim);
      row.push(b.tie ? 'TIE: set order in the iPad Points screen' : '');
      rows.push(row);
    });
  });
  return rows;
}

function qualRows_(list, eventName) {
  var rows = [[eventName + ' - Qualifying']];
  list.forEach(function (C) {
    rows.push(['']); rows.push(['#H#' + C.cls]);
    rows.push(['#C#Pos', 'Boat #', 'Team', 'Time', 'Status']);
    C.rows.forEach(function (r) { rows.push([r.pos, r.num, r.team, r.timeStr, r.status]); });
  });
  return rows;
}

function writeSeason_(ss, force) {
  var sl = ss.getSheetByName(TAB.SEASON_LOG);
  var rows = [['Season Standings (from SEASON_LOG)']];
  if (sl && sl.getLastRow() > 1) {
    var data = sl.getRange(2, 1, sl.getLastRow() - 1, 8).getDisplayValues(), byCls = {}, events = [];
    data.forEach(function (r) {
      var ev = r[0], cls = r[1], num = r[2];
      if (!cls) return;
      if (events.indexOf(ev) < 0) events.push(ev);
      var c = byCls[cls] = byCls[cls] || {};
      var b = c[num] = c[num] || { num: num, team: r[3], per: {}, total: 0, uim: 0 };
      b.team = r[3] || b.team;
      b.per[ev] = Number(r[6]) || 0;
      b.total += Number(r[6]) || 0; b.uim += Number(r[7]) || 0;
    });
    Object.keys(byCls).forEach(function (cls) {
      rows.push(['']); rows.push(['#H#' + cls]);
      var uim = RWO.isUim(cls), head = ['#C#Pos', 'Boat #', 'Team'].concat(events).concat(['Season Total']);
      if (uim) head.push('UIM Total');
      rows.push(head);
      var list = Object.keys(byCls[cls]).map(function (k) { return byCls[cls][k]; }).sort(function (a, b) { return b.total - a.total; });
      list.forEach(function (b, i) {
        var row = [i + 1, b.num, b.team];
        events.forEach(function (ev) { row.push(b.per[ev] != null ? b.per[ev] : ''); });
        row.push(b.total);
        if (uim) row.push(b.uim);
        rows.push(row);
      });
    });
  } else rows.push(['Nothing saved yet. Use RWO Scoring > Save this event to season standings.']);
  writeTab_(ss, TAB.SEASON, rows, force);
}

/* Writes a tab only when its content changed. '#H#' marks a class header row, '#C#' a column header row. */
function writeTab_(ss, name, rows, force) {
  var width = 1;
  rows.forEach(function (r) { if (r.length > width) width = r.length; });
  var heads = [], cols = [];
  var vals = rows.map(function (r, i) {
    var out = r.slice();
    if (typeof out[0] === 'string' && out[0].indexOf('#H#') === 0) { out[0] = out[0].slice(3); heads.push(i + 1); }
    if (typeof out[0] === 'string' && out[0].indexOf('#C#') === 0) { out[0] = out[0].slice(3); cols.push(i + 1); }
    while (out.length < width) out.push('');
    return out.map(function (v) { return v == null ? '' : v; });
  });
  var hash = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(vals)));
  var props = PropertiesService.getScriptProperties(), pk = 'h_' + name;
  var sh = ss.getSheetByName(name);
  if (!force && sh && props.getProperty(pk) === hash) return;
  if (!sh) { sh = ss.insertSheet(name); sh.setTabColor('#1a73e8'); }
  sh.clear();
  if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
  if (sh.getMaxRows() < vals.length) sh.insertRowsAfter(sh.getMaxRows(), vals.length - sh.getMaxRows());
  var rng = sh.getRange(1, 1, vals.length, width);
  rng.setNumberFormat('@').setValues(vals.map(function (r) { return r.map(function (v) { return (v instanceof Date || typeof v === 'number') ? v : String(v); }); }));
  if (name === TAB.LOG && vals.length > 1) sh.getRange(2, 1, vals.length - 1, 1).setNumberFormat('ddd h:mm:ss am/pm');
  sh.getRange(1, 1).setFontWeight('bold').setFontSize(13);
  if (heads.length) sh.getRangeList(heads.map(function (r) { return 'A' + r + ':' + col_(width) + r; })).setBackground('#111111').setFontColor('#ffffff').setFontWeight('bold');
  if (cols.length) sh.getRangeList(cols.map(function (r) { return 'A' + r + ':' + col_(width) + r; })).setBackground('#e8eaed').setFontWeight('bold');
  props.setProperty(pk, hash);
}
function col_(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

/* ================= public pages ================= */
function getPublicData() {
  var c = CacheService.getScriptCache(), hit = c.get('public');
  if (hit) return hit;
  var ss = SpreadsheetApp.getActive(), cfg = readConfig_(ss), events = readEvents_(ss, 0).events, set = settings_(ss);
  var voided = RWO.isVoided(events), cache = {};
  var races = RWO.raceNumbers(cfg).map(function (r) {
    var R = cache[r] = RWO.computeRace(cfg, events, r, voided);
    var hide = set.publicOfficialOnly && !R.official;
    return { race: r, day: R.day, status: R.status, official: R.official, hidden: hide,
      classes: hide ? [] : R.classes.map(function (C) {
        return { cls: C.cls, laps: C.laps, uim: C.uim, rows: C.rows.map(function (x) {
          return { pos: x.posLabel, num: x.num, team: x.team, laps: x.laps, status: x.status, time: statusOrTime_(x), last: x.lastLapStr, gap: x.gap, apba: x.apba, uim: x.uim, pen: penText_(x) };
        }) };
      }) };
  });
  var st = RWO.computeStandings(cfg, events, set.publicOfficialOnly, cache).map(function (C) {
    return { cls: C.cls, uim: C.uim, races: C.races, complete: C.complete, rows: C.rows.map(function (b) {
      return { pos: b.pos, num: b.num, team: b.team, races: b.races, bonus: b.bonus, total: b.total, uim: b.uim };
    }) };
  });
  var out = JSON.stringify({ eventName: set.eventName, races: races, standings: st, qual: RWO.computeQual(cfg, events), updated: Date.now(), officialOnly: set.publicOfficialOnly });
  if (out.length < 90000) c.put('public', out, 4);
  return out;
}

/* ================= season + new event ================= */
function saveToSeason() {
  var ss = SpreadsheetApp.getActive(), set = settings_(ss), cfg = readConfig_(ss), events = readEvents_(ss, 0).events;
  var st = RWO.computeStandings(cfg, events, true);
  var sl = sheet_(ss, TAB.SEASON_LOG, '#8e24aa');
  var keep = [];
  if (sl.getLastRow() > 1) keep = sl.getRange(2, 1, sl.getLastRow() - 1, 8).getValues().filter(function (r) { return r[0] !== set.eventName; });
  var add = [];
  st.forEach(function (C) {
    if (!C.counted.length) return;
    C.rows.forEach(function (b) { add.push([set.eventName, C.cls, b.num, b.team, b.apba, b.bonus, b.total, C.uim ? b.uim : '']); });
  });
  var all = keep.concat(add);
  if (sl.getLastRow() > 1) sl.getRange(2, 1, sl.getLastRow() - 1, 8).clearContent();
  if (all.length) sl.getRange(2, 1, all.length, 8).setValues(all);
  renderAll_(true);
  SpreadsheetApp.getUi().alert('Saved ' + add.length + ' boat totals for "' + set.eventName + '" (official races only).');
}

function startNewEvent() {
  var ui = SpreadsheetApp.getUi();
  var ok = ui.alert('Start a new event?', 'This saves the current event to season standings, copies EVENTS into an archive tab, then clears EVENTS, ENTRIES and RACE_STARTS. Nothing is deleted from the archive.', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  saveToSeason();
  var ss = SpreadsheetApp.getActive(), set = settings_(ss);
  var name = ('ARCHIVE ' + set.eventName).slice(0, 90);
  var ev = ss.getSheetByName(TAB.EVENTS);
  var copy = ev.copyTo(ss).setName(ss.getSheetByName(name) ? name + ' ' + Date.now() : name);
  copy.hideSheet();
  [TAB.EVENTS, TAB.ENTRIES, TAB.STARTS].forEach(function (n) { var s = ss.getSheetByName(n); if (s.getLastRow() > 1) s.getRange(2, 1, s.getLastRow() - 1, s.getLastColumn()).clearContent(); });
  ss.getSheets().forEach(function (s) { if (/^RESULTS_\d+$/.test(s.getName())) ss.deleteSheet(s); });
  PropertiesService.getScriptProperties().deleteAllProperties();
  ss.getSheetByName(TAB.SETTINGS).getRange('B2').setValue('New Event');
  renderAll_(true);
  ui.alert('Done. Update the Event Name in SETTINGS, then paste the new ENTRIES and RACE_STARTS. On each iPad, tap Settings > Reload from Sheet.');
}
