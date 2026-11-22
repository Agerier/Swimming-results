// Pure parsers: text lines / HTML in, JSON out. No network here, so it is easy to test.
//
// PDF lines come from lib/pdf.js: cells separated by TAB, a leading TAB when the line is
// indented, "\f" between pages. Plain lines without any TAB (copied text) also work,
// with simpler guessing of where the name and the club end.
import * as cheerio from 'cheerio';

const TIME_RE = /^(?:\d{1,2}:)?(?:\d{1,2}:)?\d{1,2}\.\d{2}$/;
const YB_RE = /^(?:\d{2}|(?:19|20)\d{2})$/;
const RANK_RE = /^\d+\.$/;
const STATUSES = new Set(['DSQ', 'DNS', 'DNF', 'EXH', 'WDR', 'DNC', 'DQ', 'NS', 'SCR']);
const FOOTER_RE = /^Splash Meet Manager/i;
const EVENT_CELL_RE = /^\p{L}+\.? \d+$/u;            // "Event 26", "Epreuve 3", "Prova 8"
const EVENT_PLAIN_RE = /^\p{L}+\.? \d+,? \S/u;        // "Event 3, Boys, 50m Freestyle, ..."
const DATE_LINE_RE = /^\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}\s*-\s*\d{1,2}:\d{2}/;
const STAMP_RE = /(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}\s+\d{1,2}:\d{2})/;
const SPLIT_KEY_RE = /^(\d+)m:$/;
const HEAT_RE = /^\D+ (\d+)(?: \D+ (\d+))?$/;             // "Heat 1 of 5", "Série 1 de 2"
const RELAY_RE = /\d+\s*x\s*\d+\s*m/i;

const clean = (s) => String(s || '').replace(/[  ]+/g, ' ').trim();

/* ---------- meet index page (HTML) ---------- */

export function parseMeetIndex(html, id) {
  const $ = cheerio.load(html);
  const base = `https://live.swimrankings.net/${id}/`;
  const meet = {
    id: String(id),
    title: clean($('title').first().text()).replace(/\s*-\s*SPLASH Meet Manager.*$/i, ''),
    city: null, course: null, date: null, lastUpdated: null,
    sourceUrl: base, events: [], docs: [],
  };

  // Header: a 2x2 table — title | course, city | date.
  const head = $('#header table').first().find('tr');
  const hc = (r, c) => clean(head.eq(r).children('td').eq(c).text()) || null;
  if (head.length >= 2) {
    meet.title = hc(0, 0) || meet.title;
    meet.course = hc(0, 1); meet.city = hc(1, 0); meet.date = hc(1, 1);
  } else {
    $('td').each((_, td) => {
      if ($(td).find('td').length) return;
      const t = clean($(td).text());
      if (!meet.city && /^[^()]{2,40}\([A-Z]{3}\)$/.test(t)) meet.city = t;
      if (!meet.course && /\(\d+\s*m\)/i.test(t) && t.length < 40) meet.course = t;
      if (!meet.date && /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(t)) meet.date = t;
    });
  }
  const upd = clean($('#lastupdate').text() || $('body').text()).match(STAMP_RE);
  if (upd) meet.lastUpdated = upd[1];

  const pdfNo = (href, kind) => {
    const m = String(href || '').match(new RegExp(kind + '_(\\d+)\\.pdf', 'i'));
    return m ? Number(m[1]) : null;
  };

  let session = null;
  const seen = new Map();
  $('tr').each((_, tr) => {
    const tds = $(tr).children('td,th');
    const cells = tds.map((__, c) => clean($(c).text())).get();
    // Session heading: "1 - Sunday, November 22, 2026 - 22.11.2026 - 12:45"
    if (cells.length === 1 && /^\d+\s*-\s.*\d{1,2}:\d{2}$/.test(cells[0]) && cells[0].length < 160) {
      session = cells[0];
      return;
    }
    if (cells.length !== 8 || !RANK_RE.test(cells[0])) return;
    let startlist = null, results = null;
    $(tr).find('a').each((__, a) => {
      const href = $(a).attr('href');
      startlist = startlist ?? pdfNo(href, 'StartList');
      results = results ?? pdfNo(href, 'ResultList');
    });
    // Unpublished lists are shown as dots; a ceremony or a break has two empty cells.
    const noLists = !startlist && !results && cells[5] === '' && cells[6] === '';
    const ev = {
      number: Number(cells[0].replace('.', '')),
      gender: cells[1], name: cells[2], round: cells[3], age: cells[4],
      time: /^\d{1,2}:\d{2}$/.test(cells[7]) ? cells[7] : null,
      session, startlist, results,
      kind: noLists || /ceremony|c[ée]r[ée]moni|siegerehrung|apbalvo/i.test(cells[3]) ? 'ceremony' : 'race',
    };
    // The same event is listed in the "by event" tab (no session) and in a day tab.
    const key = `${ev.number}|${ev.round}|${ev.startlist}|${ev.results}`;
    const prev = seen.get(key);
    if (!prev) { seen.set(key, ev); meet.events.push(ev); }
    else if (!prev.session && ev.session) Object.assign(prev, ev);
  });

  // Day tabs are already in running order. Events seen only outside a session go last.
  const order = new Map(meet.events.map((e, i) => [e, i]));
  meet.events.sort((a, b) => (a.session ? 0 : 1) - (b.session ? 0 : 1) || order.get(a) - order.get(b));

  const docSeen = new Set();
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href');
    if (!/\.(pdf|lxf)$/i.test(href) || /(StartList|ResultList)_\d+\.pdf/i.test(href)) return;
    let url;
    try { url = new URL(href, base).href; } catch { return; }
    if (docSeen.has(url)) return;
    docSeen.add(url);
    meet.docs.push({ title: clean($(a).text()), url });
  });
  return meet;
}

/* ---------- shared helpers for PDF text ---------- */

// Splits lines into pages and strips the page header. Calls onLine({ cells, indented })
// for every content line or onLine({ group }) for an age group named in an event line;
// fills out.title / generated / points / relay.
function walk(lines, out, isRow, onLine, { hasCaption }) {
  const tabbed = lines.some((l) => l.replace(/^\t/, '').includes('\t'));
  const ctx = { tabbed, lapCols: [] };
  let pageLine = 0;      // index of the line within the page
  let preEvent = true;   // meet title, city and date come before the event line
  let header = false;    // between the event line and the column captions
  for (const raw of lines) {
    if (raw === '\f') continue;
    const indented = raw.startsWith('\t');
    const cells = raw.split('\t').map(clean);
    if (indented) cells.shift();
    while (cells.length && !cells[cells.length - 1]) cells.pop();
    if (!cells.length) continue;
    const text = cells.join(' ');

    if (FOOTER_RE.test(text)) {            // printed at the bottom of every page
      const g = text.match(STAMP_RE);
      if (g) out.generated = g[1];
      pageLine = 0; preEvent = true; header = false;
      continue;
    }
    pageLine++;

    const isEvent = tabbed && cells.length > 1
      ? EVENT_CELL_RE.test(cells[0])
      : preEvent && cells.length === 1 && EVENT_PLAIN_RE.test(text);
    if (isEvent) {
      const first = cells.length > 1 || !/^\p{L}+\.? \d+,/u.test(text);
      if (!out.title) {
        out.title = first && cells.length > 1 ? cells.slice(1).join(' ') : text.replace(/^\p{L}+\.? \d+,?\s*/u, '');
        out.relay = RELAY_RE.test(out.title);
      }
      // "Prova 1 | Femin., 100m Estilos | Cadete B": the last cell names the age group.
      if (cells.length > 2) onLine({ group: cells[cells.length - 1] });
      preEvent = false; header = true;
      continue;
    }
    if (preEvent) {
      if (pageLine <= 4) continue;
      preEvent = false;                    // no event line on this page: treat as content
    }
    if (header) {
      if (DATE_LINE_RE.test(text)) continue;
      if (cells.length === 1 && /^\p{L}+: /u.test(text)) {      // "Points: AQUA 2026"
        out.points = clean(text.replace(/^\p{L}+:/u, ''));
        continue;
      }
      header = false;
      if (!isRow(cells, ctx)) {
        // Result lists always print column captions; start lists only sometimes.
        const isHeat = cells.length === 1 && HEAT_RE.test(text);
        if (hasCaption || !isHeat) {
          const laps = cells.filter((c) => /^\d+m$/.test(c));
          if (laps.length) ctx.lapCols = laps;
          continue;
        }
      }
    }
    onLine({ cells, indented, text, ctx });
  }
  return ctx;
}

// Cells after the rank / lane: name, [sex], [licence], [year], club, [time], [points], [laps...]
function personFromCells(cells) {
  const p = { name: cells[0] || '', yb: null, club: '', time: null, points: null, laps: [] };
  let i = 1;
  for (; i < cells.length; i++) {
    const c = cells[i];
    if (TIME_RE.test(c) || c === 'NT' || c === '-') break;
    if (/^\p{L}$/u.test(c)) continue;                       // sex column
    if (!p.yb && !p.club && YB_RE.test(c)) { p.yb = c.slice(-2); continue; }
    if (!p.club && /^\d{5,}$/.test(c)) continue;            // licence number
    if (!p.club) { p.club = c; continue; }
    break;
  }
  if (i < cells.length && (TIME_RE.test(cells[i]) || cells[i] === 'NT' || cells[i] === '-')) {
    p.time = cells[i] === '-' ? null : cells[i];
    i++;
  }
  if (i < cells.length && /^\d+$/.test(cells[i])) p.points = Number(cells[i++]);
  for (; i < cells.length; i++) if (TIME_RE.test(cells[i])) p.laps.push(cells[i]);
  return p;
}

// Plain text without cells: the name runs until the year of birth, the club until the time.
function personFromText(tokens) {
  for (let i = 1; i < tokens.length; i++) {
    if (!YB_RE.test(tokens[i])) continue;
    const rest = tokens.slice(i + 1);
    const ti = rest.findIndex((t) => TIME_RE.test(t) || t === 'NT');
    const p = {
      name: tokens.slice(0, i).join(' '), yb: tokens[i].slice(-2),
      club: (ti >= 0 ? rest.slice(0, ti) : rest).join(' '),
      time: ti >= 0 ? rest[ti] : null, points: null, laps: [],
    };
    const after = ti >= 0 ? rest.slice(ti + 1) : [];
    if (after[0] && /^\d+$/.test(after[0])) p.points = Number(after.shift());
    p.laps = after.filter((t) => TIME_RE.test(t));
    return p.name && p.club ? p : null;
  }
  return null;
}

// "50m: 45.35 45.35 150m: 2:26.35 51.86 ..." -> [{ dist, time, lap }]
function parseSplitCells(tokens) {
  const res = [];
  let cur = null;
  for (const t of tokens) {
    const k = t.match(SPLIT_KEY_RE);
    if (k) { cur = { dist: Number(k[1]), time: null, lap: null }; res.push(cur); }
    else if (cur && TIME_RE.test(t)) { if (!cur.time) cur.time = t; else if (!cur.lap) cur.lap = t; }
  }
  return res;
}

const toSec = (t) => String(t).split(':').reduce((a, v) => a * 60 + Number(v), 0);

function finishSplits(row, lapCols) {
  const s = (row._splits || []).filter((x) => x.time).sort((a, b) => a.dist - b.dist);
  if (s.length) {
    // A single value per distance is either a running time or a lap time.
    const single = s.every((x) => !x.lap);
    const rising = s.every((x, i) => i === 0 || toSec(x.time) > toSec(s[i - 1].time));
    if (single && !rising) for (const x of s) { x.lap = x.time; x.time = null; }
    row.splits = s;
  } else if (row._laps?.length && lapCols.length) {
    // Laps printed in the row itself, under "50m 100m ..." column captions.
    row.splits = row._laps.slice(0, lapCols.length)
      .map((lap, i) => ({ dist: parseInt(lapCols[i], 10), time: null, lap }));
  }
  delete row._laps; delete row._splits;
}

/* ---------- result list ---------- */

function resultRow(cells, ctx) {
  const first = cells[0];
  const isRank = RANK_RE.test(first);
  const isStatus = STATUSES.has(first);
  let p;
  if (ctx.tabbed) {
    if (cells.length < 2) return null;
    if (isRank || isStatus) p = personFromCells(cells.slice(1));
    else if (!ctx.relay && cells.length >= 3 && !SPLIT_KEY_RE.test(first) && cells.slice(1, 4).some((c) => YB_RE.test(c))) {
      p = personFromCells(cells);                          // tie: the rank cell is empty
      if (!p.time) return null;
      p.tie = true;
    } else return null;
    if (!p.name) return null;
  } else {
    if (!isRank && !isStatus) return null;
    p = personFromText((cells[1] || '').split(' '));
    if (!p) return null;
  }
  const row = {
    place: isRank ? Number(first.replace('.', '')) : null,
    status: isRank || p.tie ? 'OK' : first,
    name: p.name, yb: p.yb, club: p.club, time: p.time, points: p.points, note: null,
  };
  if (p.tie) row._tie = true;
  if (p.laps.length) row._laps = p.laps;
  return row;
}

export function parseResultLine(line) {
  const tabbed = line.includes('\t');
  const cells = tabbed ? line.split('\t').map(clean).filter(Boolean) : plainCells(line);
  return resultRow(cells, { tabbed, relay: false });
}

// Plain text line -> [first word, the rest]
const plainCells = (line) => { const t = clean(line).split(' '); return [t[0], t.slice(1).join(' ')]; };

export function parseResults(lines) {
  const out = { title: null, generated: null, points: null, relay: false, groups: [] };
  let group = null, softGroup = null, last = null;
  const all = [];
  const groupFor = (name) => {
    let g = out.groups.find((x) => x.name === name);
    if (!g) { g = { name, rows: [] }; out.groups.push(g); }
    return g;
  };
  const toCells = (cells, ctx) => (ctx.tabbed ? cells : plainCells(cells.join(' ')));
  const isRow = (cells, ctx) => !!resultRow(toCells(cells, ctx), { ...ctx, relay: out.relay });

  const ctx = walk(lines, out, isRow, (ln) => {
    if (ln.group !== undefined) { softGroup = ln.group; group = null; last = null; return; }
    const { cells, indented, text } = ln;
    const c = { ...ln.ctx, relay: out.relay };
    const row = resultRow(toCells(cells, c), c);
    if (row) {
      if (row._tie) { row.place = last ? last.place : null; delete row._tie; }
      const g = row.status === 'EXH' ? groupFor('EXH') : (group || (group = groupFor(softGroup || '')));
      g.rows.push(row); all.push(row); last = row;
      return;
    }
    const tokens = c.tabbed ? cells : text.split(' ');
    if (SPLIT_KEY_RE.test(tokens[0])) {
      if (last) (last._splits ||= []).push(...parseSplitCells(tokens));
      return;
    }
    if (c.tabbed) {
      if (out.relay && last && indented && cells.some((x) => YB_RE.test(x))) {       // relay swimmers, two per line
        const line = (last._memberLines ||= []);
        const cur = [];
        for (const cell of cells) {
          if (YB_RE.test(cell) && cur.length && !cur[cur.length - 1].yb && !cur[cur.length - 1].time) cur[cur.length - 1].yb = cell.slice(-2);
          else if (TIME_RE.test(cell) && cur.length) cur[cur.length - 1].time = cell;
          else if (/\p{L}{2}/u.test(cell)) cur.push({ name: cell, yb: null, time: null });
        }
        line.push(cur);
        return;
      }
      if (indented || cells.length > 1) {
        if (last && indented) last.note = last.note ? `${last.note} ${text}` : text;   // DSQ reason
        return;
      }
      group = groupFor(text); last = null;
      return;
    }
    // plain text: a DSQ reason follows the DSQ line, often in brackets
    if (last && (text.startsWith('(') || (last.status === 'DSQ' && !last.note))) {
      last.note = last.note ? `${last.note} ${text}` : text;
    } else { group = groupFor(text); last = null; }
  }, { hasCaption: true });

  for (const row of all) {
    finishSplits(row, ctx.lapCols);
    if (row._memberLines) {
      // Swimmers are printed column by column: 1 3 / 2 4.
      const width = Math.max(...row._memberLines.map((l) => l.length));
      row.members = [];
      for (let col = 0; col < width; col++) for (const l of row._memberLines) if (l[col]) row.members.push(l[col]);
      delete row._memberLines;
    }
  }
  out.groups = out.groups.filter((g) => g.rows.length);
  return out;
}

/* ---------- start list ---------- */

function entryRow(cells, ctx) {
  if (!/^\d{1,2}$/.test(cells[0])) return null;
  let p;
  if (ctx.tabbed) {
    if (cells.length < 2 || !/\p{L}/u.test(cells[1])) return null;
    p = personFromCells(cells.slice(1));
  } else {
    p = personFromText(cells[1] ? cells[1].split(' ') : []);
    if (!p) return null;
  }
  return { lane: Number(cells[0]), name: p.name, yb: p.yb, club: p.club, time: p.time };
}

export function parseEntryLine(line) {
  const tabbed = line.includes('\t');
  return entryRow(tabbed ? line.split('\t').map(clean).filter(Boolean) : plainCells(line), { tabbed });
}

export function parseStartlist(lines) {
  const out = { title: null, generated: null, relay: false, heats: [] };
  let heat = null, last = null;
  const toCells = (cells, ctx) => (ctx.tabbed ? cells : plainCells(cells.join(' ')));
  walk(lines, out, (cells, ctx) => !!entryRow(toCells(cells, ctx), ctx), (ln) => {
    if (ln.group !== undefined) return;
    const { cells, indented, text, ctx } = ln;
    const entry = entryRow(toCells(cells, ctx), ctx);
    if (entry) {
      if (!heat) { heat = { name: '', number: null, of: null, entries: [] }; out.heats.push(heat); }
      heat.entries.push(entry); last = entry;
      return;
    }
    if (ctx.tabbed && (indented || cells.length > 1)) {
      if (last && cells.length === 1 && out.relay) last.swimmers = text;   // relay line-up
      return;
    }
    const m = text.match(HEAT_RE);
    if (!m && ctx.tabbed && !/\p{L}/u.test(text)) return;
    heat = { name: text, number: m ? Number(m[1]) : null, of: m && m[2] ? Number(m[2]) : null, entries: [] };
    out.heats.push(heat); last = null;
  }, { hasCaption: false });
  out.heats = out.heats.filter((h) => h.entries.length);
  delete out.points;
  return out;
}
