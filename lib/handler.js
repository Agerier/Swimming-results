// One request handler shared by the standalone server and the Vercel functions.
import { getMeet, getResults, getStartlist, HttpError } from './splash.js';

const isNum = (v) => typeof v === 'string' && /^\d{1,9}$/.test(v);

export async function handle(kind, query) {
  try {
    if (!isNum(query.id)) throw new HttpError(400, 'Parameter "id" must be a number');
    let data;
    if (kind === 'meet') data = await getMeet(query.id);
    else {
      if (!isNum(query.n)) throw new HttpError(400, 'Parameter "n" must be a number');
      data = kind === 'results' ? await getResults(query.id, query.n) : await getStartlist(query.id, query.n);
    }
    return { status: 200, body: data };
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    return { status, body: { error: e.message || 'Internal error' } };
  }
}

export function send(res, { status, body }) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', status === 200 ? 'public, s-maxage=20, stale-while-revalidate=60' : 'no-store');
  res.end(JSON.stringify(body));
}
