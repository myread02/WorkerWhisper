import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/index.ts';
import { wavDuration } from '../src/budget.ts';
import { ownerAccess, wav, budgetBinding } from './helpers.mjs';

test('WAV duration is verified from bytes; malformed and overlong audio cannot reserve budget', () => {
  assert.equal(wavDuration(wav(60)), 60);
  assert.equal(wavDuration(wav(0.5)), 0.5);
  assert.equal(wavDuration(wav(61)), null);
  assert.equal(wavDuration(Buffer.from('OggS')), null);
  assert.equal(wavDuration(wav(0)), null);
  for (const offset of [0, 4, 8, 12, 16, 20, 22, 24, 28, 32, 34, 36, 40]) {
    const invalid = wav(); invalid[offset] ^= 1;
    assert.equal(wavDuration(invalid), null);
  }
});

test('parallel reservations cannot exceed the cap; snapshots persist in KV; budget resets at UTC midnight', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-08T23:59:59Z') });
  const snapshots = new Map();
  const budget = budgetBinding({ async put(key, value) { snapshots.set(key, JSON.parse(value)); } }, '94').getByName();
  const responses = await Promise.all(Array.from({ length: 10 }, () => budget.fetch('https://budget/', { method: 'POST' })));
  assert.equal(responses.filter(r => r.status === 200).length, 2);
  assert.equal(responses.filter(r => r.status === 429).length, 8);
  const used = await (await budget.fetch('https://budget/')).json();
  assert.equal(used.reservedNeurons, 94);
  assert.equal(used.remainingNeurons, 0);
  assert.equal(snapshots.size, 2);
  assert.deepEqual(snapshots.get('budget:2026-10-08:000002'), used);
  t.mock.timers.tick(1000);
  const reset = await (await budget.fetch('https://budget/')).json();
  assert.equal(reset.day, '2026-10-09');
  assert.equal(reset.reservedNeurons, 0);
  assert.equal(reset.remainingNeurons, 94);
  assert.equal(reset.resetsAt, '2026-10-10T00:00:00.000Z');
});

test('owner and explicitly allowed service identity are required; identity failures deny access', async () => {
  const env = { ACCESS_AUD: 'test-access', OWNER_EMAIL: 'owner@example.test', ALLOWED_SERVICE_TOKEN_ID: 'owner-cli' };
  const request = new Request('https://example.test/');
  const identity = value => ({ access: { aud: 'test-access', async getIdentity() { return value; } } });
  assert.equal((await worker.fetch(request, env, identity({ email: 'someone@example.test' }))).status, 403);
  assert.equal((await worker.fetch(request, env, identity(undefined))).status, 403);
  assert.equal((await worker.fetch(request, env, identity({ email: 'OWNER@example.test' }))).status, 200);
  assert.equal((await worker.fetch(request, env, identity({ service_token_id: 'owner-cli', service_token_status: true }))).status, 200);
  assert.equal((await worker.fetch(request, env, identity({ service_token_id: 'other', service_token_status: true }))).status, 403);
  assert.equal((await worker.fetch(request, env, identity({ service_token_id: 'owner-cli' }))).status, 403);
  assert.equal((await worker.fetch(request, { ...env, ALLOWED_SERVICE_TOKEN_ID: undefined }, identity({ service_token_id: 'owner-cli', service_token_status: true }))).status, 403);
  assert.equal((await worker.fetch(request, env, { access: { aud: 'test-access', async getIdentity() { throw new Error('unavailable'); } } })).status, 503);
});

test('inference is blocked at the cap and on storage failure; failed AI calls keep their reservations', async () => {
  let calls = 0;
  const env = { ACCESS_AUD: 'test-access', OWNER_EMAIL: 'owner@example.test',
    BUDGET: budgetBinding(undefined, '47'), AI: { async run() { calls++; throw new Error('AI failed'); } } };
  const upload = body => worker.fetch(new Request('https://example.test/api/transcribe?chunk=1', { method: 'POST', body }), env, { access: ownerAccess });
  assert.equal((await upload('OggS')).status, 400);
  assert.equal(calls, 0);
  const originalError = console.error; console.error = () => {};
  try {
    assert.equal((await upload(wav())).status, 500);
    assert.equal((await upload(wav())).status, 429);
    assert.equal(calls, 1);
    env.BUDGET = budgetBinding({ async put() { throw new Error('KV failed'); } });
    assert.equal((await upload(wav())).status, 500);
    assert.equal(calls, 1);
  } finally { console.error = originalError; }
});

test('usage responses from a binding can have immutable headers', async () => {
  const env = { ACCESS_AUD: 'test-access', OWNER_EMAIL: 'owner@example.test',
    BUDGET: { getByName() { return { fetch() { return fetch('data:application/json,%7B%22remainingNeurons%22%3A10000%7D'); } }; } } };
  const response = await worker.fetch(new Request('https://example.test/api/usage'), env, { access: ownerAccess });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal((await response.json()).remainingNeurons, 10000);
});
