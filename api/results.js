import { handle, send } from '../lib/handler.js';

export default async function handler(req, res) {
  const q = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  send(res, await handle('results', q));
}
