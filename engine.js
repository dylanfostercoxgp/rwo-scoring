/* RWO Scoring v3 - shared scoring engine.
 * The SAME file runs on the iPads (engine.js) and inside Apps Script (Engine.gs).
 * Every result is worked out from the list of events. Nothing is ever overwritten.
 */
var RWO = (function () {
  'use strict';

  var APBA = [1200, 900, 675, 506, 380, 285, 214, 160, 120, 90, 68, 51, 38, 29, 21, 16, 12, 9, 7, 5];
  var UIM = [20, 15, 12, 9, 7, 5, 4, 3, 2, 1];
  var UIM_CLASSES = ['Class 1', 'Class 2 (500)', 'Super Cat', 'Super Stock'];
  var CLUSTER_MS = 20000;   // taps from different iPads within 20 s = the same line crossing
  var MIN_LAP_MS = 30000;   // nothing shorter than 30 s counts as a lap
  var DISAGREE_MS = 1000;   // iPads more than 1 s apart get flagged

  var PEN_TYPES = {
    time: 'Time (seconds)', laps: 'Laps', lastplace: 'Last place points', drop: 'Drop positions',
    points: 'Points deduction', dq: 'Disqualified (DQ)', warning: 'Warning', custom: 'Other'
  };

  function key(cls, num) { return String(cls).trim() + '|' + String(num).trim(); }
  function splitKey(k) { var i = k.indexOf('|'); return { cls: k.slice(0, i), num: k.slice(i + 1) }; }
  function isUim(cls) { return UIM_CLASSES.indexOf(cls) >= 0; }
  function byT(a, b) { return (a.t || a.at || 0) - (b.t || b.at || 0) || String(a.id).localeCompare(String(b.id)); }
  function byAt(a, b) { return (a.at || 0) - (b.at || 0) || String(a.id).localeCompare(String(b.id)); }

  function numSort(a, b) {
    var na = parseFloat(String(a).replace(/[^0-9.]/g, '')), nb = parseFloat(String(b).replace(/[^0-9.]/g, ''));
    if (isNaN(na)) na = 1e9; if (isNaN(nb)) nb = 1e9;
    return na - nb || String(a).localeCompare(String(b));
  }

  function fmt(ms) {
    if (ms == null || !isFinite(ms)) return '';
    var neg = ms < 0; ms = Math.abs(Math.round(ms / 10)) * 10;
    var h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60, cs = Math.floor(ms / 10) % 100;
    var out = (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s + '.' + (cs < 10 ? '0' : '') + cs;
    return (neg ? '-' : '') + out;
  }

  /* ---------- config ---------- */
  // cfg = { entries:[{cls,num,team}], starts:[{day,race,start,laps,classes:[]}] }
  function raceNumbers(cfg) {
    var s = {};
    (cfg.starts || []).forEach(function (r) { s[r.race] = 1; });
    return Object.keys(s).map(Number).sort(function (a, b) { return a - b; });
  }

  function raceInfo(cfg, race) {
    // Rows with the same race + start merge into one start, so classes in one start can have different lap counts.
    var groups = [];
    (cfg.starts || []).filter(function (r) { return Number(r.race) === Number(race); })
      .sort(function (a, b) { return a.start - b.start; })
      .forEach(function (r) {
        var g = groups.filter(function (x) { return x.group === Number(r.start); })[0];
        if (!g) { g = { group: Number(r.start), laps: Number(r.laps) || 0, classes: [], classLaps: {}, day: r.day }; groups.push(g); }
        r.classes.forEach(function (c) { if (g.classes.indexOf(c) < 0) g.classes.push(c); g.classLaps[c] = Number(r.laps) || 0; });
      });
    var classes = [];
    groups.forEach(function (g) { g.classes.forEach(function (c) { if (classes.indexOf(c) < 0) classes.push(c); }); });
    return { race: Number(race), day: groups.length ? groups[0].day : '', groups: groups, classes: classes };
  }

  function isVoided(events) {
    var v = {};
    events.forEach(function (e) { if (e.type === 'void' && e.target) v[e.target] = true; });
    return v;
  }

  /* ---------- one race ---------- */
  function computeRace(cfg, allEvents, race, voided) {
    race = Number(race);
    voided = voided || isVoided(allEvents);
    var info = raceInfo(cfg, race);
    var ev = allEvents.filter(function (e) { return Number(e.race) === race && !voided[e.id] && e.type !== 'void'; });

    // --- boats in this race ---
    var boats = {}, alias = {};
    info.classes.forEach(function (c) {
      (cfg.entries || []).forEach(function (en) {
        if (en.cls === c) boats[key(c, en.num)] = { key: key(c, en.num), cls: c, num: String(en.num), team: en.team || '' };
      });
    });
    ev.filter(function (e) { return e.type === 'boatadd' || e.type === 'boatdel' || e.type === 'boatmove'; }).sort(byAt).forEach(function (e) {
      if (e.type === 'boatadd') {
        var k = key(e.cls, e.num);
        boats[k] = { key: k, cls: e.cls, num: String(e.num).trim(), team: e.team || '' };
        if (info.classes.indexOf(e.cls) < 0) {
          info.classes.push(e.cls);
          var g = info.groups.filter(function (x) { return Number(x.group) === Number(e.group || 1); })[0] || info.groups[0];
          if (g) g.classes.push(e.cls);
        }
      } else if (e.type === 'boatdel') {
        delete boats[e.boat];
      } else if (e.type === 'boatmove' && boats[e.boat]) {
        var b = boats[e.boat], nk = key(e.toCls, b.num);
        delete boats[e.boat];
        boats[nk] = { key: nk, cls: e.toCls, num: b.num, team: b.team };
        alias[e.boat] = nk;
      }
    });
    function real(k) { var n = 0; while (alias[k] && n++ < 10) k = alias[k]; return k; }

    var groupOf = {};
    info.groups.forEach(function (g) { g.classes.forEach(function (c) { groupOf[c] = g.group; }); });

    // --- class lap counts (start from RACE_STARTS, then manual changes) ---
    var classLaps = {};
    info.groups.forEach(function (g) { g.classes.forEach(function (c) { classLaps[c] = g.classLaps[c] != null ? g.classLaps[c] : g.laps; }); });

    // --- devices and the main iPad ---
    var taps = ev.filter(function (e) { return e.type === 'tap'; });
    var latestRole = {};
    ev.filter(function (e) { return e.type === 'role'; }).sort(byAt).forEach(function (e) { latestRole[e.dev] = e; });
    var main = null, mainAt = -1;
    Object.keys(latestRole).forEach(function (d) {
      if (latestRole[d].role === 'main' && latestRole[d].at > mainAt) { main = d; mainAt = latestRole[d].at; }
    });
    var tapDevs = {};
    taps.forEach(function (t) { if (t.dev !== 'EDIT') tapDevs[t.dev] = (tapDevs[t.dev] || 0) + 1; });
    if (!main) {
      var best = 0;
      Object.keys(tapDevs).forEach(function (d) { if (tapDevs[d] > best) { best = tapDevs[d]; main = d; } });
    }
    var activeDevs = Object.keys(tapDevs);
    var multi = activeDevs.length > 1;

    // --- red flags and segments ---
    var starts = ev.filter(function (e) { return e.type === 'start'; }).sort(byT);
    // Red flags pressed twice for the same stoppage (no restart between them) count as ONE.
    // The stoppage time is the first press; the settings come from the last press.
    var rfs = [];
    ev.filter(function (e) { return e.type === 'redflag'; }).sort(byT).forEach(function (r) {
      var p = rfs[rfs.length - 1];
      var restarted = p && starts.some(function (s) { return s.t > p.t && s.t < r.t; });
      if (p && !restarted) {
        var keepSettings = (r.at || 0) >= (p.at || 0) ? r : p;
        rfs[rfs.length - 1] = { id: p.id, type: 'redflag', t: p.t, at: Math.max(r.at || 0, p.at || 0), mode: keepSettings.mode, laps: keepSettings.laps, race: r.race };
      } else rfs.push(r);
    });
    var calledAt = null;
    for (var i = 0; i < rfs.length; i++) { if (rfs[i].mode === 'called') { calledAt = rfs[i].t; rfs = rfs.slice(0, i + 1); break; } }
    // segStart[k][group] = start time of segment k for that start group
    var segStart = [];
    for (var k = 0; k <= rfs.length; k++) {
      var lo = k === 0 ? -Infinity : rfs[k - 1].t, hi = k < rfs.length ? rfs[k].t : Infinity;
      if (k > 0 && rfs[k - 1].mode === 'called') break;
      var m = {};
      info.groups.forEach(function (g) {
        var c = starts.filter(function (s) { return Number(s.group) === g.group && s.t > lo && s.t < hi; });
        var pick = c.filter(function (s) { return s.dev === main; })[0] || c[0];
        if (pick) m[g.group] = pick.t;
      });
      segStart.push(m);
    }

    // apply lap changes in time order (manual changes and red flag totals)
    ev.filter(function (e) { return e.type === 'laps' || e.type === 'redflag'; }).sort(byAt).forEach(function (e) {
      if (e.type === 'laps') classLaps[e.cls] = Number(e.laps);
      else if (e.laps) Object.keys(e.laps).forEach(function (c) { classLaps[c] = Number(e.laps[c]); });
    });

    // --- acknowledged review flags ---
    var acked = {};
    ev.filter(function (e) { return e.type === 'ack'; }).forEach(function (e) { acked[e.flag] = true; });

    // --- line crossings per boat: merge the iPads ---
    var tapsByBoat = {};
    taps.forEach(function (t) { var k = real(t.boat); (tapsByBoat[k] = tapsByBoat[k] || []).push(t); });

    function crossings(k) {
      var list = (tapsByBoat[k] || []).slice().sort(byT), cl = [];
      list.forEach(function (t) {
        var c = cl[cl.length - 1];
        if (c && t.t - c.t0 <= CLUSTER_MS && !c.devs[t.dev]) { c.taps.push(t); c.devs[t.dev] = t; }
        else { var n = { t0: t.t, taps: [t], devs: {} }; n.devs[t.dev] = t; cl.push(n); }
      });
      return cl.map(function (c) {
        var edit = c.devs.EDIT, mt = main ? c.devs[main] : null, others = c.taps.filter(function (t) { return t.dev !== main && t.dev !== 'EDIT'; });
        var time, flag = null;
        if (edit) time = edit.t;
        else if (mt) time = mt.t;
        else time = others.reduce(function (s, t) { return s + t.t; }, 0) / others.length;
        var sig = c.taps.map(function (t) { return t.id; }).sort().join(',');
        if (!edit && multi) {
          var ts = c.taps.map(function (t) { return t.t; });
          var spread = Math.max.apply(null, ts) - Math.min.apply(null, ts);
          if (!mt) flag = 'filled';
          else if (others.length === 0) flag = 'mainonly';
          else if (spread > DISAGREE_MS) flag = 'disagree';
        }
        var fkey = race + '|' + k + '|' + sig;
        if (flag && acked[fkey]) flag = null;
        return { t: Math.round(time), taps: c.taps, flag: flag, fkey: fkey };
      });
    }

    // --- per-boat laps ---
    var statusEv = {}, pens = {};
    ev.filter(function (e) { return e.type === 'status'; }).sort(byAt).forEach(function (e) { statusEv[real(e.boat)] = e.status; });
    ev.filter(function (e) { return e.type === 'penalty'; }).sort(byAt).forEach(function (e) { (pens[real(e.boat)] = pens[real(e.boat)] || []).push(e); });
    var endEv = ev.filter(function (e) { return e.type === 'end'; })[0];
    var ended = !!endEv || calledAt != null;

    var rows = Object.keys(boats).map(function (k) {
      var b = boats[k], g = groupOf[b.cls], laps = [], cls = crossings(k), lastSeg = -1, segT0 = null;
      for (var s = 0; s < segStart.length; s++) {
        var st = segStart[s][g];
        if (st == null) break;
        if (s > 0 && rfs[s - 1].mode === 'original') laps = [];
        var end = s < rfs.length ? rfs[s].t : Infinity, prev = st;
        cls.forEach(function (c) {
          // The first tap after a START always counts as lap 1. After that, a lap must be at least 30 s.
          if (c.t > st && c.t < end && (prev === st || c.t - prev >= MIN_LAP_MS - 1)) {
            laps.push({ t: c.t, dur: c.t - prev, seg: s, segT0: st, flag: c.flag, fkey: c.fkey, taps: c.taps });
            prev = c.t;
          }
        });
      }
      return { key: k, cls: b.cls, num: b.num, team: b.team, group: g, allLaps: laps, crossings: cls };
    });

    // called race: every class stops at the last lap its leader completed
    var classes = info.classes.map(function (c) {
      var cr = rows.filter(function (r) { return r.cls === c; });
      if (calledAt != null) {
        var L = 0;
        cr.forEach(function (r) { var n = r.allLaps.filter(function (l) { return l.t <= calledAt; }).length; if (n > L) L = n; });
        classLaps[c] = L;
      }
      return { cls: c, laps: classLaps[c], rows: cr };
    });

    var raceStarted = segStart.length && Object.keys(segStart[0]).length > 0;
    var lastRf = rfs[rfs.length - 1];
    var underRed = lastRf && lastRf.mode !== 'called' && !(segStart[rfs.length] && Object.keys(segStart[rfs.length]).length);
    var flags = [];

    classes.forEach(function (C) {
      var target = C.laps, reg = C.rows.length, offset = Math.max(0, 3 - reg);
      C.rows.forEach(function (r) {
        var laps = target > 0 ? r.allLaps.slice(0, target) : r.allLaps.slice(); // missing lap count: keep counting, never auto-finish
        r.lapList = laps;
        r.extra = r.allLaps.length - laps.length;
        r.laps = laps.length;
        r.target = target;
        r.times = laps.map(function (l) { return l.dur; });
        r.total = laps.reduce(function (s, l) { return s + l.dur; }, 0);
        var last = laps[laps.length - 1];
        r.rankTime = last ? last.t - last.segT0 : Infinity;
        r.lastT = last ? last.t : null;
        r.lastSeg = last ? last.seg : -1;
        var st = statusEv[r.key];
        var started = segStart[0] && segStart[0][r.group] != null;
        if (st === 'DNS' || st === 'DNF' || st === 'DQ') r.status = st;
        else if (r.laps >= target && target > 0) r.status = 'FINISHED';
        else if (ended) r.status = r.laps > 0 ? 'LAPS DOWN' : (started ? 'DNF' : 'DNS');
        else r.status = started ? 'RACING' : 'NOT STARTED';
        r.penalties = (pens[r.key] || []).map(function (p) { return { id: p.id, ptype: p.ptype, amount: Number(p.amount) || 0, reason: p.reason || '', label: p.label || '', who: p.who || '' }; });
        r.penSecs = 0; r.penLaps = 0; r.drop = 0; r.lastPlace = false; r.ptsDeduct = 0;
        r.penalties.forEach(function (p) {
          var t = p.ptype === 'custom' ? (p.effect || 'warning') : p.ptype;
          if (t === 'time') r.penSecs += p.amount;
          else if (t === 'laps') r.penLaps += p.amount;
          else if (t === 'drop') r.drop += p.amount;
          else if (t === 'lastplace') r.lastPlace = true;
          else if (t === 'points') r.ptsDeduct += p.amount;
          else if (t === 'dq') r.status = 'DQ';
        });
        r.adjLaps = Math.max(0, r.laps - r.penLaps);
        r.adjTotal = r.total + r.penSecs * 1000;
        r.rankAdj = r.rankTime + r.penSecs * 1000;
        r.flags = laps.filter(function (l) { return l.flag; }).map(function (l, i) {
          return { race: race, boat: r.key, num: r.num, cls: r.cls, lap: laps.indexOf(l) + 1, flag: l.flag, fkey: l.fkey, t: l.t, taps: l.taps };
        });
        r.flags.forEach(function (f) { flags.push(f); });
      });

      var grp = function (r) { return r.status === 'DQ' ? 2 : r.status === 'DNS' ? 1 : 0; };
      C.rows.sort(function (a, b) {
        return grp(a) - grp(b) || b.adjLaps - a.adjLaps || a.rankAdj - b.rankAdj || numSort(a.num, b.num);
      });
      // drop-position penalties
      var running = C.rows.filter(function (r) { return grp(r) === 0; });
      running.filter(function (r) { return r.drop > 0; }).forEach(function (r) {
        var i = running.indexOf(r), j = Math.min(running.length - 1, i + r.drop);
        running.splice(i, 1); running.splice(j, 0, r);
      });
      C.rows = running.concat(C.rows.filter(function (r) { return grp(r) > 0; }));

      var leader = C.rows[0];
      C.rows.forEach(function (r, i) {
        var g = grp(r);
        r.pos = g === 0 && (raceStarted || r.laps) ? i + 1 : null;
        r.posLabel = g === 2 ? 'DQ' : g === 1 ? 'DNS' : (r.pos ? String(r.pos) : '');
        if (i === 0 || g > 0 || !leader || !r.laps) r.gap = '';
        else if (r.adjLaps < leader.adjLaps) { var d = leader.adjLaps - r.adjLaps; r.gap = '-' + d + (d === 1 ? ' lap' : ' laps'); }
        else { var gd = r.rankAdj - leader.rankAdj; r.gap = '+' + (gd < 60000 ? (Math.round(gd / 10) / 100).toFixed(2) : fmt(gd)); }
        // points
        var lastIdx = reg - 1 + offset;
        if (r.status === 'DQ') { r.apba = 0; r.uim = isUim(r.cls) ? 0 : null; }
        else if (r.status === 'DNS' || r.lastPlace) { r.apba = APBA[lastIdx] || 0; r.uim = isUim(r.cls) ? (UIM[reg - 1] || 0) : null; }
        else if (r.pos) { r.apba = APBA[r.pos - 1 + offset] || 0; r.uim = isUim(r.cls) ? (UIM[r.pos - 1] || 0) : null; }
        else { r.apba = 0; r.uim = isUim(r.cls) ? 0 : null; }
        if (r.ptsDeduct) r.apba = Math.max(0, r.apba - r.ptsDeduct);
        r.totalStr = r.laps ? fmt(r.total) : ''; r.adjStr = r.laps ? fmt(r.adjTotal) : '';
        r.lastLapStr = r.times.length ? fmt(r.times[r.times.length - 1]) : '';
      });
      C.reg = reg;
    });

    var offEv = ev.filter(function (e) { return e.type === 'official' || e.type === 'unlock'; }).sort(byAt);
    var official = offEv.length ? offEv[offEv.length - 1].type === 'official' : false;
    var status = !raceStarted ? 'NOT STARTED' : ended ? 'ENDED' : underRed ? 'RED FLAG' : 'RUNNING';
    var allDone = raceStarted && classes.every(function (C) {
      return C.rows.every(function (r) { return r.status !== 'RACING'; });
    });

    return {
      race: race, day: info.day, groups: info.groups.map(function (g) {
        return { group: g.group, classes: g.classes, laps: g.classes.map(function (c) { return classLaps[c]; }),
          startT: segStart.length ? (segStart[segStart.length - 1][g.group] != null ? segStart[segStart.length - 1][g.group] : (segStart[0][g.group] != null ? segStart[0][g.group] : null)) : null,
          firstStartT: segStart[0] ? segStart[0][g.group] : null };
      }),
      classes: classes.map(function (C) { return { cls: C.cls, laps: C.laps, reg: C.reg, uim: isUim(C.cls), rows: C.rows }; }),
      status: status, official: official, allDone: allDone, flags: flags, redflags: rfs, main: main, devices: activeDevs,
      segment: rfs.length, calledAt: calledAt
    };
  }

  /* ---------- weekend points ---------- */
  function computeStandings(cfg, events, officialOnly, raceCache) {
    var voided = isVoided(events);
    var races = raceNumbers(cfg), results = {};
    races.forEach(function (r) { results[r] = (raceCache && raceCache[r]) || computeRace(cfg, events, r, voided); });
    var tieEv = {};
    events.filter(function (e) { return e.type === 'tiebreak' && !voided[e.id]; }).sort(byAt).forEach(function (e) { tieEv[e.cls] = e.order; });

    var classList = [];
    (cfg.entries || []).forEach(function (e) { if (classList.indexOf(e.cls) < 0) classList.push(e.cls); });
    UIM_CLASSES.forEach(function (c) { if (classList.indexOf(c) < 0) classList.push(c); });

    return classList.map(function (cls) {
      var clsRaces = races.filter(function (r) { return results[r].classes.some(function (C) { return C.cls === cls; }); });
      var counted = clsRaces.filter(function (r) { return officialOnly ? results[r].official : results[r].status !== 'NOT STARTED'; });
      var complete = clsRaces.length > 0 && clsRaces.every(function (r) { return officialOnly ? results[r].official : results[r].status === 'ENDED'; });
      var boatMap = {};
      (cfg.entries || []).filter(function (e) { return e.cls === cls; }).forEach(function (e) {
        boatMap[key(cls, e.num)] = { key: key(cls, e.num), num: String(e.num), team: e.team || '', races: {}, apba: 0, uim: 0, allDns: true };
      });
      counted.forEach(function (r) {
        var C = results[r].classes.filter(function (x) { return x.cls === cls; })[0];
        C.rows.forEach(function (row) {
          var b = boatMap[row.key] || (boatMap[row.key] = { key: row.key, num: row.num, team: row.team, races: {}, apba: 0, uim: 0, allDns: true });
          b.races[r] = { apba: row.apba, uim: row.uim, pos: row.posLabel, status: row.status };
          b.apba += row.apba || 0; b.uim += row.uim || 0;
          if (row.status !== 'DNS') b.allDns = false;
        });
      });
      var list = Object.keys(boatMap).map(function (k) { return boatMap[k]; });
      var reg = list.length;
      var order = tieEv[cls] || [];
      list.sort(function (a, b) {
        return (a.allDns - b.allDns) || (b.apba - a.apba) || ((order.indexOf(a.key) + 1 || 999) - (order.indexOf(b.key) + 1 || 999)) || numSort(a.num, b.num);
      });
      list.forEach(function (b, i) {
        b.rank = i + 1;
        b.tie = list.some(function (o) { return o !== b && o.apba === b.apba && !o.allDns && !b.allDns && counted.length > 0; }) && order.indexOf(b.key) < 0;
        b.bonus = complete && !b.allDns ? Math.max(0, reg - b.rank) : 0;
        b.total = b.apba + b.bonus;
      });
      list.sort(function (a, b) { return b.total - a.total || a.rank - b.rank; });
      list.forEach(function (b, i) { b.pos = counted.length ? i + 1 : ''; });
      return { cls: cls, uim: isUim(cls), races: clsRaces, counted: counted, complete: complete, reg: reg, rows: list };
    });
  }

  /* ---------- qualifying ---------- */
  function computeQual(cfg, events) {
    var voided = isVoided(events);
    var q = events.filter(function (e) { return (e.type === 'qgo' || e.type === 'qfin' || e.type === 'qdns') && !voided[e.id]; }).sort(byT);
    var classList = [];
    (cfg.entries || []).forEach(function (e) { if (classList.indexOf(e.cls) < 0) classList.push(e.cls); });
    return classList.map(function (cls) {
      var rows = (cfg.entries || []).filter(function (e) { return e.cls === cls; }).map(function (e) {
        var k = key(cls, e.num), mine = q.filter(function (x) { return x.boat === k; });
        var go = null, fin = null, dns = false;
        mine.forEach(function (x) {
          if (x.type === 'qdns') dns = true;
          if (x.type === 'qgo') { go = x; fin = null; }
          if (x.type === 'qfin' && go && !fin && x.t > go.t) fin = x;
        });
        var time = go && fin ? fin.t - go.t : null;
        return { key: k, num: String(e.num), team: e.team || '', goT: go ? go.t : null, time: time, timeStr: fmt(time),
          status: dns ? 'DNS' : time != null ? 'DONE' : go ? 'ON COURSE' : 'WAITING', goId: go && go.id, finId: fin && fin.id };
      });
      rows.sort(function (a, b) {
        var ra = a.status === 'DONE' ? 0 : a.status === 'ON COURSE' ? 1 : a.status === 'WAITING' ? 2 : 3;
        var rb = b.status === 'DONE' ? 0 : b.status === 'ON COURSE' ? 1 : b.status === 'WAITING' ? 2 : 3;
        return ra - rb || (a.time || 0) - (b.time || 0) || numSort(a.num, b.num);
      });
      var p = 0;
      rows.forEach(function (r) { r.pos = r.status === 'DONE' ? ++p : ''; });
      return { cls: cls, rows: rows };
    });
  }

  /* ---------- change log ---------- */
  function describe(e, byId) {
    var b = e.boat ? splitKey(e.boat) : null, boat = b ? '#' + b.num + ' (' + b.cls + ')' : '';
    switch (e.type) {
      case 'tap': return e.dev === 'EDIT' ? 'Lap time set for ' + boat + ' at ' + new Date(e.t).toLocaleTimeString() : null;
      case 'void':
        var t = byId[e.target];
        if (!t) return 'Removed an entry';
        if (t.type === 'tap') return (e.reason || 'Undo') + ': lap tap on ' + (t.boat ? '#' + splitKey(t.boat).num + ' (' + splitKey(t.boat).cls + ')' : '') + (t.dev === 'EDIT' ? ' (edit)' : '');
        return 'Removed: ' + (describe(t, byId) || t.type);
      case 'start': return 'Start ' + e.group + ' started';
      case 'redflag':
        var m = e.mode === 'running' ? 'restart in running order' : e.mode === 'original' ? 'restart in original order' : 'race called';
        var l = e.laps ? Object.keys(e.laps).map(function (c) { return c + ' ' + e.laps[c] + ' laps'; }).join(', ') : '';
        return 'RED FLAG: ' + m + (l ? '. New totals: ' + l : '');
      case 'laps': return 'Lap count for ' + e.cls + ' set to ' + e.laps;
      case 'status': return boat + ' marked ' + e.status;
      case 'end': return 'Race ended';
      case 'penalty':
        return 'Penalty on ' + boat + ': ' + (e.ptype === 'custom' ? (e.label || 'Other') : PEN_TYPES[e.ptype]) + (e.amount ? ' ' + e.amount : '') + (e.reason ? '. Reason: ' + e.reason : '');
      case 'boatadd': return 'Boat added: #' + e.num + ' (' + e.cls + ') ' + (e.team || '');
      case 'boatdel': return 'Boat removed: ' + boat;
      case 'boatmove': return boat + ' moved to ' + e.toCls;
      case 'ack': return 'Review flag accepted for ' + boat;
      case 'official': return 'Race made OFFICIAL';
      case 'unlock': return 'Race UNLOCKED for edits';
      case 'tiebreak': return 'Tie order set for ' + e.cls;
      case 'role': return 'iPad "' + (e.devName || e.dev) + '" set as ' + (e.role === 'main' ? 'Main' : e.role === 'b1' ? 'Backup 1' : 'Backup 2');
      case 'qdns': return 'Qualifying DNS: ' + boat;
      default: return null;
    }
  }

  function changeLog(events) {
    var byId = {};
    events.forEach(function (e) { byId[e.id] = e; });
    return events.slice().sort(byAt).map(function (e) {
      var d = describe(e, byId);
      return d ? { at: e.at, race: e.race || '', who: e.who || '', what: d } : null;
    }).filter(Boolean).reverse();
  }

  return {
    APBA: APBA, UIM: UIM, UIM_CLASSES: UIM_CLASSES, PEN_TYPES: PEN_TYPES, MIN_LAP_MS: MIN_LAP_MS, CLUSTER_MS: CLUSTER_MS,
    key: key, splitKey: splitKey, fmt: fmt, numSort: numSort, isUim: isUim,
    raceNumbers: raceNumbers, raceInfo: raceInfo, isVoided: isVoided,
    computeRace: computeRace, computeStandings: computeStandings, computeQual: computeQual, changeLog: changeLog
  };
})();
if (typeof module !== 'undefined') module.exports = RWO;
