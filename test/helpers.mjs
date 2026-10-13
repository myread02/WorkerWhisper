import { Script } from 'node:vm';
import { AUDIO_JS } from '../src/audio.ts';
import { DailyBudget } from '../src/budget.ts';

export const ownerAccess = { aud: 'test-access', async getIdentity() { return { email: 'owner@example.test' }; } };
export function wav(seconds = 1) {
  const { encodeWav } = new Script(AUDIO_JS + ';({ encodeWav })').runInNewContext();
  return Buffer.from(encodeWav({ sampleRate: 16000, numberOfChannels: 1,
    getChannelData: () => new Float32Array(16000 * seconds) }, 0, 16000 * seconds));
}
export function budgetBinding(kv = { async put() {} }, cap = '10000') {
  const data = new Map();
  let queue = Promise.resolve();
  const state = {
    storage: { async get(key) { return structuredClone(data.get(key)); },
      async put(key, value) { data.set(key, structuredClone(value)); } },
    blockConcurrencyWhile(callback) {
      const result = queue.then(callback);
      queue = result.catch(() => {});
      return result;
    },
  };
  const object = new DailyBudget(state, { TRANSCRIPTS: kv, DAILY_NEURON_CAP: cap });
  return { getByName() { return { fetch(url, init) { return object.fetch(new Request(url, init)); } }; } };
}
