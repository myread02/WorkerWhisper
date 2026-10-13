import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Script, createContext } from 'node:vm';
import worker, { formatTranscript } from '../src/index.ts';
import { ownerAccess, wav, budgetBinding } from './helpers.mjs';
import { HTML_CONTENT } from '../src/ui.ts';

test('page refresh shows the budget and reports unavailable usage without inventing a balance', async () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { children: [], replaceChildren() { this.children = []; } });
    return elements.get(id);
  };
  let available = true;
  const context = createContext({
    document: { getElementById: element },
    fetch: async url => {
      if (url === '/api/transcripts') return Response.json({ items: [], cursor: null });
      return available ? Response.json({ capNeurons: 10000, reservedNeurons: 47, remainingNeurons: 9953, remainingClips: 211 })
        : new Response('Unavailable', { status: 503 });
    },
  });
  new Script(HTML_CONTENT.match(/<script>([\s\S]*?)<\/script>/)[1]).runInContext(context);
  await new Script('refreshUsage()').runInContext(context);
  assert.equal(element('budgetLeft').textContent, '9,953');
  assert.equal(element('budgetBar').value, 9953);
  assert.match(element('budgetDetail').textContent, /211 more clips/);
  available = false;
  await new Script('refreshUsage()').runInContext(context);
  assert.equal(element('budgetLeft').textContent, '—');
  assert.match(element('budgetDetail').textContent, /Budget unavailable/);
  assert.equal(element('refreshUsage').disabled, false);
});

test('Access rejects missing, forged and wrong-app authentication before touching AI or history', async () => {
  const env = { ACCESS_AUD: 'private-app', OWNER_EMAIL: 'owner@example.test' };
  for (const path of ['/', '/api/transcripts', '/api/transcripts/rec_example', '/api/transcribe']) {
    const options = path === '/api/transcribe' ? { method: 'POST', body: wav() } : {};
    const request = new Request('https://example.test' + path, {
      ...options, headers: { 'Cf-Access-Jwt-Assertion': 'forged', 'Cf-Access-Authenticated-User-Email': 'owner@example.test' },
    });
    for (const ctx of [{}, { access: { aud: 'another-app' } }]) {
      const response = await worker.fetch(request.clone(), env, ctx);
      assert.equal(response.status, 403);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
    }
  }
  assert.equal((await worker.fetch(new Request('https://example.test/'), {}, {})).status, 503);
  for (const headers of [{ Origin: 'https://evil.test' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal((await worker.fetch(new Request('https://example.test/api/transcribe', {
      method: 'POST', headers, body: wav(),
    }), env, { access: { ...ownerAccess, aud: 'private-app' } })).status, 403);
  }
  const response = await worker.fetch(new Request('https://example.test/'), env, { access: { ...ownerAccess, aud: 'private-app' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
});

test('upload, AI input, KV persistence, history and request limits', async () => {
  const records = new Map();
  let calls = 0;
  const env = {
    ACCESS_AUD: 'test-access', OWNER_EMAIL: 'owner@example.test', BUDGET: budgetBinding(),
    AI: { async run(model, input) {
      calls++;
      assert.equal(model, '@cf/openai/whisper-large-v3-turbo');
      assert.equal(input.audio, wav().toString('base64'));
      assert.equal(input.task, 'transcribe');
      assert.ok(input.initial_prompt.includes('繁體中文'));
      assert.ok(!('language' in input));
      return { text: '你好 Hello', vtt: 'WEBVTT', word_count: 2 };
    } },
    TRANSCRIPTS: {
      async put(id, value, options) { records.set(id, { value, metadata: options.metadata }); },
      async get(id) { return records.get(id)?.value ?? null; },
      async list(options) {
        assert.equal(options.prefix, 'rec_');
        assert.equal(options.limit, 20);
        assert.equal(options.cursor, 'next');
        return { keys: [...records].map(([name, record]) => ({ name, metadata: record.metadata })), list_complete: false, cursor: 'page2' };
      },
    },
  };
  const request = (path, options) => worker.fetch(new Request('https://example.test' + path, options), env, { access: ownerAccess });
  const html = await (await request('/')).text();
  assert.ok(html.includes('WorkerWhisper'));
  new Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
  assert.ok(!html.includes('innerHTML'));
  const upload = await request('/api/transcribe?name=meeting.opus', { method: 'POST', body: wav() });
  assert.equal(upload.status, 200);
  const record = await upload.json();
  assert.equal(record.text, '你好 Hello');
  assert.equal(record.filename, 'meeting.opus');
  assert.deepEqual(await (await request('/api/transcripts/' + record.id)).json(), record);
  const list = await (await request('/api/transcripts?cursor=next')).json();
  assert.equal(list.items[0].id, record.id);
  assert.equal(list.cursor, 'page2');
  assert.equal((await request('/api/transcripts/rec_0000000000000_00000000-0000-0000-0000-000000000000')).status, 404);
  assert.equal((await request('/api/transcripts/invalid')).status, 400);
  assert.equal((await request('/api/transcribe', { method: 'POST' })).status, 400);
  assert.equal((await request('/api/transcribe?name=file.exe', { method: 'POST', body: wav() })).status, 400);
  assert.equal((await request('/api/transcribe', { method: 'POST', body: new Uint8Array(10 * 1024 * 1024 + 1) })).status, 413);
  assert.equal(calls, 1);
  const originalPut = env.TRANSCRIPTS.put;
  env.TRANSCRIPTS.put = async () => { throw new Error('storage failed'); };
  const originalError = console.error;
  console.error = () => {};
  try { assert.equal((await request('/api/transcribe', { method: 'POST', body: wav() })).status, 500); }
  finally { console.error = originalError; env.TRANSCRIPTS.put = originalPut; }
});

test('transcript filename and metadata use Taiwan timestamps and measured values', () => {
  const record = {
    id: 'example', filename: '260929_153328_demo.opus',
    createdAt: '2026-09-29T00:21:10.000Z', recordingStart: '2026-09-29T00:21:00.000Z',
    audioBytes: 50310000, audioDuration: 1648.8, transcribeSeconds: 183,
    text: '你好 Hello',
  };
  const output = formatTranscript(record);
  assert.equal(output.outputFilename, 'cloud-260929-082110_260929_153328_demo.opus.txt');
  assert.equal(output.exportText, `Voice Memo Transcript - 20260929

## Metadata
Recording Start Time: 2026-09-29 08:21
Recording End Time: 2026-09-29 08:48
Source File: 260929_153328_demo.opus
Source Location: Unknown (browser uploads do not expose the local path)
Converted Audio: Not converted (original audio sent to Workers AI)
Audio Size: 50.31 MB
Audio Length: 27.48 min
Transcribe Backend: Cloudflare Workers AI
Transcribe Device: Cloudflare-managed
Transcribe Model: @cf/openai/whisper-large-v3-turbo
Transcribe Time: 3m 3s
Recording Timezone: Asia/Taipei

## Transcript
你好 Hello
`);
  const legacy = formatTranscript({ id: 'old', filename: 'old.opus', createdAt: record.createdAt, text: 'Old transcript' });
  assert.ok(legacy.exportText.includes('Recording Start Time: Unknown'));
  assert.ok(legacy.exportText.includes('Audio Length: Unknown'));
  assert.ok(legacy.exportText.endsWith('Old transcript\n'));
  assert.ok(!formatTranscript({ ...record, filename: '../bad\nname.opus' }).outputFilename.includes('/'));
  const located = formatTranscript({ ...record, sourceLocation: '/recordings/meeting.opus',
    recordingStart: '2026-10-07T08:41:00.000Z', audioDuration: 2302.2 });
  assert.ok(located.exportText.startsWith('Voice Memo Transcript - 20261007'));
  assert.ok(located.exportText.includes('Recording Start Time: 2026-10-07 16:41'));
  assert.ok(located.exportText.includes('Recording End Time: 2026-10-07 17:19'));
  assert.ok(located.exportText.includes('Source Location: /recordings/meeting.opus'));
});

test('valid WAV clips cover every sample and resume from the failed clip', async () => {
  const { AUDIO_JS } = await import('../src/audio.ts');
  const { encodeWav, processChunks } = new Script(AUDIO_JS + ';({ encodeWav, processChunks })').runInNewContext();
  const left = new Float32Array(16000 * 61 + 1).fill(1);
  const right = new Float32Array(left.length).fill(-0.5);
  const audio = { sampleRate: 16000, numberOfChannels: 2, length: left.length,
    getChannelData: index => [left, right][index] };
  const sample = new DataView(encodeWav(audio, 0, 1));
  assert.equal(sample.getUint32(24, true), 16000);
  assert.equal(sample.getUint16(22, true), 1);
  assert.equal(sample.getUint32(40, true), 2);
  assert.equal(sample.getInt16(44, true), 8192);
  const job = { audio, chunks: [] };
  let attempts = 0;
  const sizes = [];
  const transcribe = async wav => {
    attempts++;
    const bytes = new Uint8Array(wav);
    assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'RIFF');
    assert.equal(String.fromCharCode(...bytes.slice(8, 12)), 'WAVE');
    assert.equal(new DataView(wav).getUint32(4, true), wav.byteLength - 8);
    assert.ok(wav.byteLength < 10 * 1024 * 1024);
    if (attempts === 2) throw new Error('temporary failure');
    sizes.push((wav.byteLength - 44) / 2);
    return { text: 'clip ' + attempts, transcribeSeconds: 1 };
  };
  await assert.rejects(processChunks(job, transcribe, () => {}), /temporary failure/);
  assert.equal(job.chunks.length, 1);
  await processChunks(job, transcribe, () => {});
  assert.equal(attempts, 3);
  assert.equal(job.chunks.length, 2);
  assert.deepEqual(sizes, [16000 * 60, 16001]);
  assert.equal(sizes.reduce((sum, size) => sum + size), audio.length);
});

test('remaining time uses observed speed and resets its baseline on resume', async () => {
  const { AUDIO_JS } = await import('../src/audio.ts');
  const { estimateTimeLeft, processChunks } = new Script(AUDIO_JS + ';({ estimateTimeLeft, processChunks })').runInNewContext();
  assert.equal(estimateTimeLeft(130, 0, 0), 'estimating…');
  assert.equal(estimateTimeLeft(130, 60, 12), '~0m 14s remaining (excluding final save)');
  assert.equal(estimateTimeLeft(130, 130, 26), '~0m 0s remaining (excluding final save)');
  const progress = [];
  const audio = { sampleRate: 1, length: 130, numberOfChannels: 1, getChannelData: () => new Float32Array(130) };
  await processChunks({ audio, chunks: [{ text: 'already done' }] }, async () => ({ text: 'new clip' }),
    (completed, total, estimate) => progress.push({ completed, total, estimate }));
  assert.equal(progress[0].completed, 1);
  assert.equal(progress[0].estimate, 'estimating…');
  assert.equal(progress.at(-1).completed, 3);
});

test('chunk processing saves one ordered transcript only after all clips succeed', async () => {
  const records = new Map();
  let inferenceCalls = 0;
  const env = {
    ACCESS_AUD: 'test-access', OWNER_EMAIL: 'owner@example.test', BUDGET: budgetBinding(),
    AI: { async run() { inferenceCalls++; return { text: 'Part ' + inferenceCalls, word_count: 1 }; } },
    TRANSCRIPTS: {
      async put(id, value) { records.set(id, value); },
      async get(id) { return records.get(id) ?? null; },
    },
  };
  const request = (path, body) => worker.fetch(new Request('https://example.test' + path, { method: 'POST', body }), env, { access: ownerAccess });
  const first = await (await request('/api/transcribe?name=large.opus&chunk=1', wav())).json();
  const second = await (await request('/api/transcribe?name=large.opus&chunk=1', wav())).json();
  assert.equal(records.size, 0);
  const payload = { filename: 'large.opus', audioBytes: 50310000, audioDuration: 61,
    sourceLocation: '/recordings/large.opus',
    createdAt: '2026-09-29T00:21:10.000Z', recordingStart: '2026-09-29T00:21:00.000Z', chunks: [first, second] };
  assert.equal((await request('/api/transcripts', JSON.stringify({ ...payload, chunks: [first] }))).status, 400);
  assert.equal(records.size, 0);
  const response = await request('/api/transcripts', JSON.stringify(payload));
  assert.equal(response.status, 200);
  const record = await response.json();
  assert.equal(records.size, 1);
  assert.equal(record.text, 'Part 1\n\nPart 2');
  assert.equal(record.wordCount, 2);
  assert.equal(record.transcribeSeconds, first.transcribeSeconds + second.transcribeSeconds);
  assert.equal(record.audioBytes, 50310000);
  assert.equal(record.audioDuration, 61);
  assert.equal(record.sourceLocation, payload.sourceLocation);
  assert.equal(record.outputFilename, 'cloud-260929-082110_large.opus.txt');
  assert.ok(record.exportText.includes('60-second WAV chunks'));
  for (const changes of [ { audioDuration: -1 }, { audioDuration: 121 }, { audioBytes: 1.5 },
    { createdAt: 'invalid' }, { recordingStart: 'invalid' }, { sourceLocation: 123 },
    { sourceLocation: '/file\nInjected: value' }, { sourceLocation: 'x'.repeat(4097) },
    { chunks: [{ text: 42, transcribeSeconds: 1 }, second] },
    { chunks: [{ text: 'bad', transcribeSeconds: -1 }, second] } ]) {
    assert.equal((await request('/api/transcripts', JSON.stringify({ ...payload, ...changes }))).status, 400);
  }
  assert.equal((await request('/api/transcripts', 'bad json')).status, 400);
  assert.equal((await request('/api/transcripts', ' '.repeat(2 * 1024 * 1024 + 1))).status, 413);
  assert.equal(records.size, 1);
});
