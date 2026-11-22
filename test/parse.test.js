// Parser tests on saved copies of real pages and real PDF text.
// *.tsv fixtures are what lib/pdf.js returns for the real PDF (cells separated by TAB);
// *.txt fixtures are the same lists as plain text, to check that pasted text also works.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMeetIndex, parseResults, parseStartlist } from '../lib/parse.js';

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const lines = (n) => fx(n).split('\n');
const rowsOf = (r) => r.groups.flatMap((g) => g.rows);

test('meet page 11609: header, programme, links, no duplicates', () => {
  const m = parseMeetIndex(fx('meet_11609.html'), 11609);
  assert.equal(m.title, '3. Olimpiskais gars VIII');
  assert.equal(m.city, 'Ogre (LAT)');
  assert.equal(m.course, 'Short Course (25m)');
  assert.equal(m.date, '22.11.2026');
  assert.equal(m.lastUpdated, '22.11.2026 14:48');
  assert.equal(m.sourceUrl, 'https://live.swimrankings.net/11609/');
  assert.equal(m.events.length, 25);
  assert.equal(m.events.filter((e) => e.kind === 'race').length, 13);
  assert.equal(m.events.filter((e) => e.kind === 'ceremony').length, 12);
  assert.deepEqual(m.events[0], {
    number: 1, gender: 'All', name: '25m Freestyle', round: 'Timed Final', age: 'Open', time: '12:45',
    session: '1 - Sunday, November 22, 2026 - 22.11.2026 - 12:45', startlist: 1, results: 1, kind: 'race',
  });
  assert.deepEqual(m.events.slice(0, 3).map((e) => e.time), ['12:45', '12:46', '13:00']);
  const cer = m.events.find((e) => e.kind === 'ceremony');
  assert.equal(cer.startlist, null); assert.equal(cer.results, null);
  assert.ok(m.events.every((e) => e.session));
  assert.ok(m.docs.some((d) => d.url === 'https://live.swimrankings.net/11609/Medals.pdf'));
  assert.ok(!m.docs.some((d) => /StartList|ResultList/.test(d.url)));
});

test('meet page 11615: unpublished lists, events repeated in two tabs', () => {
  const m = parseMeetIndex(fx('meet_11615.html'), 11615);
  assert.equal(m.events.length, 14);
  assert.equal(new Set(m.events.map((e) => e.number)).size, 14);
  const e1 = m.events.find((e) => e.number === 1);
  assert.equal(e1.kind, 'race'); assert.equal(e1.startlist, null); assert.equal(e1.results, null);
  assert.equal(m.events.find((e) => e.number === 26).name, '10 x 25m Freestyle');
});

test('meet page 11601: date range, two sessions', () => {
  const m = parseMeetIndex(fx('meet_11601.html'), 11601);
  assert.equal(m.date, '14. - 15.11.2026');
  assert.equal(m.course, 'Long Course (50m)');
  assert.equal(new Set(m.events.map((e) => e.session)).size, 2);
});

test('results 11609/2: sub-groups, DSQ reason, EXH on the second page', () => {
  const r = parseResults(lines('11609_results_2.tsv'));
  assert.equal(r.title, 'Girls, 50m Freestyle YOB 2012 - 2017');
  assert.equal(r.generated, '22.11.2026 14:43');
  assert.equal(r.points, 'AQUA 2026');
  assert.deepEqual(r.groups.map((g) => [g.name, g.rows.length]),
    [['YOB 2016 - 2017', 12], ['YOB 2014 - 2015', 19], ['YOB 2012 - 2013', 8], ['EXH', 1]]);
  assert.deepEqual(r.groups[0].rows[0], {
    place: 1, status: 'OK', name: 'NEIBERGA Enija Beatrise', yb: '17', club: 'PK Ogre', time: '37.87', points: 219, note: null,
  });
  const dsq = r.groups[0].rows.at(-1);
  assert.deepEqual([dsq.status, dsq.place, dsq.name, dsq.time, dsq.points], ['DSQ', null, 'BRAUNA Tija', '40.04', null]);
  assert.equal(dsq.note, '(Time: 13:01), Starts pirms starta signāla');
  const last = r.groups[1].rows.at(-1);
  assert.deepEqual([last.place, last.name, last.club, last.time, last.points], [19, 'RULUKA Patricija', 'Augsdaugavas NSS', '1:00.16', 54]);
  assert.deepEqual(r.groups[3].rows[0], {
    place: null, status: 'EXH', name: 'LEISKINA Linda', yb: '15', club: 'PK Ogre', time: '33.65', points: 312, note: null,
  });
});

test('results 11609/3: a sub-group continues on the next page', () => {
  const r = parseResults(lines('11609_results_3.tsv'));
  assert.deepEqual(r.groups.map((g) => [g.name, g.rows.length]),
    [['YOB 2016 - 2017', 17], ['YOB 2014 - 2015', 11], ['YOB 2012 - 2013', 13]]);
  assert.equal(r.groups[2].rows.at(-1).name, 'MUCINIEKS Toms');
  assert.equal(r.groups[2].rows.at(-1).place, 13);
});

test('results 11615/23 (400m): split lines with running and lap times', () => {
  const r = parseResults(lines('11615_results_23_400free.tsv'));
  assert.equal(rowsOf(r).length, 8);
  const a = r.groups[0].rows[0];
  assert.deepEqual([a.name, a.club, a.time, a.points], ['BLUDENS Igors', 'Ventspils PK Octopus', '6:55.46', 200]);
  assert.equal(a.splits.length, 8);
  assert.deepEqual(a.splits[1], { dist: 100, time: '1:34.49', lap: '49.14' });
  assert.deepEqual(a.splits[7], { dist: 400, time: '6:55.46', lap: '53.36' });
  assert.equal(rowsOf(r).at(-1).time, '11:51.76');
});

test('results 11615/7 (200m): lap times in the row do not replace the result', () => {
  const r = parseResults(lines('11615_results_7_200back.tsv'));
  const a = r.groups[0].rows[0];
  assert.deepEqual([a.name, a.time, a.points], ['ARE Atis', '2:35.21', 417]);
  assert.deepEqual(a.splits.map((s) => [s.dist, s.lap]), [[50, '34.83'], [100, '37.90'], [150, '40.63'], [200, '41.85']]);
  assert.equal(r.groups.at(-1).name, 'EXH'); assert.equal(r.groups.at(-1).rows.length, 10);
});

test('results 11597/3 (1500m): long club name ending with a number, partial splits', () => {
  const r = parseResults(lines('11597_results_3_1500free.tsv'));
  const a = rowsOf(r)[0];
  assert.deepEqual([a.name, a.yb, a.club, a.time, a.points],
    ['DORMAL Elise', '12', 'Flipper club natation Saint-Georges 99', '18:56.65', 526]);
  assert.deepEqual(a.splits.at(-1), { dist: 1500, time: '18:56.65', lap: null });
  assert.equal(r.title, 'Dames, 1500m Libre 2015 et plus agés');
});

test('relay results: team rows, swimmers in swimming order, DSQ reason', () => {
  const a = parseResults(lines('11615_results_26_relay.tsv'));
  assert.equal(a.relay, true);
  assert.deepEqual(rowsOf(a).map((x) => [x.place, x.name, x.club, x.time]), [
    [1, 'ROZA PROSECCO', 'PK Champions', '3:24.89'], [2, 'VĀRĪTAS GARNELES', 'PK Champions', '3:44.22'],
    [3, 'SARKANIE PLUDIŅI', 'PK Champions', '3:58.88'], [4, 'SARKANIE TOMĀTI', 'PK Champions', '4:21.21']]);
  const b = parseResults(lines('11601_results_15_relay.tsv'));
  const first = rowsOf(b)[0];
  assert.deepEqual([first.name, first.club, first.time, first.yb], ['Spordiklubi Fortuna 1', 'Spordiklubi Fortuna', '1:18.46', null]);
  assert.deepEqual(first.members.map((m) => m.name), ['MAALUST, Krete', 'KUKK, Johanna', 'JOHANSON, Minna-Lii', 'TRAKS, Grete']);
  assert.deepEqual(first.members[0], { name: 'MAALUST, Krete', yb: '09', time: '18.67' });
  assert.ok(rowsOf(b).every((x) => x.status !== 'OK' || x.members.length === 4));
});

test('results 11601/1: a tie has no rank of its own and takes the rank above', () => {
  const r = parseResults(lines('11601_results_1_tie.tsv'));
  const open = r.groups[0].rows;
  const i = open.findIndex((x) => x.name === 'TAMMEVESKI, Miia-Ly');
  assert.deepEqual([open[i - 1].place, open[i].place, open[i].time, open[i + 1].place], [24, 24, '27.22', 26]);
  assert.deepEqual(r.groups.map((g) => g.name), ['Open', '17 years and younger']);
});

test('results 11580/1 (Portuguese): extra columns, two age groups, DSQ without time', () => {
  const r = parseResults(lines('11580_results_1_por.tsv'));
  assert.deepEqual(r.groups.map((g) => [g.name, g.rows.length]), [['Cadete A', 20], ['Cadete B', 25]]);
  const a = r.groups[0].rows[0];
  assert.deepEqual([a.name, a.yb, a.club, a.time, a.points], ['Margarida Cachulo Melao', '15', 'Clube Nautico de Salvaterra de', '1:22.25', 300]);
  assert.deepEqual(a.splits, [{ dist: 50, time: '36.85', lap: null }, { dist: 100, time: '1:22.25', lap: null }]);
  const dsq = rowsOf(r).find((x) => x.status === 'DSQ');
  assert.equal(dsq.time, null); assert.match(dsq.note, /^SW /);
  assert.ok(rowsOf(r).some((x) => x.status === 'DNS'));
});

test('start list 11609/4: heats and lanes', () => {
  const s = parseStartlist(lines('11609_startlist_4.tsv'));
  assert.equal(s.title, 'Girls, 50m Breaststroke YOB 2012 - 2017');
  assert.deepEqual(s.heats.map((h) => [h.number, h.of, h.entries.length]), [[1, 5, 3], [2, 5, 3], [3, 5, 3], [4, 5, 4], [5, 5, 4]]);
  assert.deepEqual(s.heats[0].entries[0], { lane: 1, name: 'VEINBERGA Elza Katrina', yb: '13', club: 'Bauskas novada BJSS', time: 'NT' });
  assert.deepEqual(s.heats[0].entries[1], { lane: 2, name: 'DOMBROVSKA Adele', yb: '17', club: 'Kekavas novada SS', time: '1:12.74' });
});

test('relay start lists: teams, entry times, line-up', () => {
  const a = parseStartlist(lines('11601_startlist_15_relay.tsv'));
  assert.equal(a.heats.length, 1); assert.equal(a.heats[0].entries.length, 7);
  assert.deepEqual(a.heats[0].entries[3], { lane: 4, name: 'Mfc 1', yb: null, club: 'Mfc', time: '1:29.00' });
  const b = parseStartlist(lines('11580_startlist_8_relay.tsv'));
  assert.deepEqual(b.heats.map((h) => h.entries.length), [6, 6, 6, 6]);
  assert.equal(b.heats[0].name, 'Série 1 de 4');
  assert.match(b.heats[0].entries[0].swimmers, /^Luana Maria Francisco, /);
});

test('plain text without cells (as pasted from a PDF viewer) is parsed too', () => {
  const r = parseResults(lines('results_2.txt'));
  assert.equal(r.title, 'Girls, 50m Freestyle YOB 2012 - 2017');
  assert.deepEqual(r.groups.map((g) => [g.name, g.rows.length]),
    [['YOB 2016 - 2017', 12], ['YOB 2014 - 2015', 19], ['YOB 2012 - 2013', 8], ['EXH', 1]]);
  const first = r.groups[0].rows[0];
  assert.deepEqual([first.place, first.name, first.yb, first.club, first.time, first.points],
    [1, 'NEIBERGA Enija Beatrise', '17', 'PK Ogre', '37.87', 219]);
  assert.match(r.groups[0].rows.at(-1).note, /Starts pirms/);
  assert.equal(r.groups[1].rows.at(-1).club, 'Augsdaugavas NSS');
  const s = parseStartlist(lines('startlist_4.txt'));
  assert.deepEqual(s.heats.map((h) => h.entries.length), [3, 3, 3, 4, 4]);
  assert.deepEqual(s.heats[0].entries[0], { lane: 1, name: 'VEINBERGA Elza Katrina', yb: '13', club: 'Bauskas novada BJSS', time: 'NT' });
});
