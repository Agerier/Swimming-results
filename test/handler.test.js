import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../lib/handler.js';

test('id and n must be digits only', async () => {
  for (const q of [{}, { id: '' }, { id: '11609/../x' }, { id: '1e3' }, { id: ' 11609' }, { id: ['1', '2'] }]) {
    assert.equal((await handle('meet', q)).status, 400);
  }
  for (const n of [undefined, '2.pdf', '-1', 'a']) {
    assert.equal((await handle('results', { id: '11609', n })).status, 400);
    assert.equal((await handle('startlist', { id: '11609', n })).status, 400);
  }
});
