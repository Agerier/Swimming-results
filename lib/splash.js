// Fetches data from live.swimrankings.net with a small cache and conditional requests,
// so the source site is asked as rarely as possible.
import { parseMeetIndex, parseResults, parseStartlist } from './parse.js';
import { pdfToLines } from './pdf.js';

const BASE = 'https://live.swimrankings.net';
const TTL_MS = 20_000;
const UA = 'swim-live/1.0 (results viewer)';
const cache = new Map();

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const inflight = new Map();

// One download per address at a time, however many visitors ask for it.
function cached(url, build) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.data);
  if (!inflight.has(url)) inflight.set(url, load(url, build, hit).finally(() => inflight.delete(url)));
  return inflight.get(url);
}

async function load(url, build, hit) {
  const headers = { 'User-Agent': UA };
  if (hit?.etag) headers['If-None-Match'] = hit.etag;
  if (hit?.lastModified) headers['If-Modified-Since'] = hit.lastModified;
  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    if (hit) return hit.data; // source is unreachable: serve what we have
    throw new HttpError(502, 'Source site is not responding');
  }
  if (res.status === 304 && hit) { hit.at = Date.now(); return hit.data; }
  if (res.status === 404 || res.status === 403) throw new HttpError(404, 'Not found on the source site');
  if (!res.ok) {
    if (hit) return hit.data;
    throw new HttpError(502, `Source site answered ${res.status}`);
  }
  let data;
  try {
    data = await build(Buffer.from(await res.arrayBuffer()), res);
  } catch (e) {
    if (hit) return hit.data;
    throw new HttpError(502, 'Could not read the file from the source site');
  }
  cache.set(url, {
    at: Date.now(), data,
    etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified'),
  });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return data;
}

function decodeHtml(buf, res) {
  const head = buf.subarray(0, 2048).toString('latin1');
  const m = (res.headers.get('content-type') || '').match(/charset=([\w-]+)/i)
    || head.match(/charset=["']?([\w-]+)/i);
  try { return new TextDecoder(m ? m[1] : 'utf-8').decode(buf); }
  catch { return buf.toString('utf8'); }
}

export function getMeet(id) {
  return cached(`${BASE}/${id}/`, (buf, res) => parseMeetIndex(decodeHtml(buf, res), id));
}

export function getResults(id, n) {
  const url = `${BASE}/${id}/ResultList_${n}.pdf`;
  return cached(url, async (buf) => ({ ...parseResults(await pdfToLines(buf)), pdf: url }));
}

export function getStartlist(id, n) {
  const url = `${BASE}/${id}/StartList_${n}.pdf`;
  return cached(url, async (buf) => ({ ...parseStartlist(await pdfToLines(buf)), pdf: url }));
}
