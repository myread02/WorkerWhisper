import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import worker from '../src/index.ts';
import { ownerAccess, budgetBinding } from './helpers.mjs';

const exec = promisify(execFile);
test('CLI splits Ogg/Opus, checkpoints failed uploads, and resumes without repeating completed clips', {
  skip: spawnSync('ffmpeg', ['-version']).status !== 0 ? 'FFmpeg is required for the CLI integration check' : false,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workerwhisper-demo-'));
  let server;
  try {
    const source = join(directory, 'meeting.opus');
    await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
      'sine=frequency=440:duration=61.25', '-c:a', 'libopus', source]);
    let calls = 0;
    const sampleCounts = [];
    const records = new Map();
    const env = {
    ACCESS_AUD: 'test-access', OWNER_EMAIL: 'owner@example.test', BUDGET: budgetBinding(),
      AI: { async run(model, input) {
        calls++;
        const wav = Buffer.from(input.audio, 'base64');
        assert.equal(model, '@cf/openai/whisper-large-v3-turbo');
        assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
        assert.equal(wav.readUInt32LE(4), wav.length - 8);
        assert.equal(wav.readUInt32LE(24), 16000);
        assert.equal(wav.readUInt16LE(22), 1);
        assert.equal(wav.readUInt16LE(34), 16);
        if (calls === 2) throw new Error('simulated interruption');
        sampleCounts.push(wav.readUInt32LE(40) / 2);
        return { text: 'Clip ' + calls, word_count: 2 };
      } },
      TRANSCRIPTS: { async put(id, value) { records.set(id, JSON.parse(value)); } },
    };
    server = createServer(async (req, res) => {
      assert.equal(req.headers['cf-access-client-id'], undefined);
      assert.equal(req.headers['cf-access-client-secret'], undefined);
      const parts = [];
      for await (const part of req) parts.push(part);
      const response = await worker.fetch(new Request('http://localhost' + req.url, {
        method: req.method, headers: req.headers, body: Buffer.concat(parts),
      }), env, { access: ownerAccess });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const out = source + '.workerwhisper-demo';
    const args = ['--experimental-strip-types', 'scripts/demo.mjs', source,
      '--url', `http://127.0.0.1:${server.address().port}`, '--recording-start', '2026-10-07T16:41:00+08:00'];
    const originalError = console.error;
    console.error = () => {};
    try { await assert.rejects(exec(process.execPath, args), error => error.stderr.includes('Rerun the same command')); }
    finally { console.error = originalError; }
    assert.equal(JSON.parse(await readFile(join(out, 'job.json'), 'utf8')).chunks.length, 1);
    assert.equal(await readFile(join(out, 'partial.txt'), 'utf8'), 'Clip 1');
    assert.equal(records.size, 0);
    const resumed = await exec(process.execPath, args);
    assert.match(resumed.stdout, /remaining \(excluding final save\)/);
    assert.equal(calls, 3);
    assert.deepEqual(sampleCounts, [960000, 20000]);
    assert.equal(records.size, 1);
    assert.match(await readFile(join(out, 'transcript.txt'), 'utf8'), /Clip 1\n\nClip 3/);
    const transcript = await readFile(join(out, 'transcript.txt'), 'utf8');
    assert.ok(transcript.startsWith('Voice Memo Transcript - 20261007'));
    assert.ok(transcript.includes('Source Location: ' + source));
    assert.ok(transcript.includes('Recording Start Time: 2026-10-07 16:41'));
    assert.ok(transcript.includes('Recording End Time: 2026-10-07 16:42'));
    assert.ok(transcript.includes('Recording Timezone: Asia/Taipei'));
    if (process.platform !== 'win32') {
      const { stat } = await import('node:fs/promises');
      assert.equal((await stat(out)).mode & 0o077, 0);
      for (const name of ['audio.pcm', 'job.json', 'transcript.txt', 'partial.txt']) {
        assert.equal((await stat(join(out, name))).mode & 0o077, 0);
      }
    }
    await exec(process.execPath, args);
    assert.equal(calls, 3);
    assert.equal(records.size, 1);
    // The same Ogg/Opus container also works with an .ogg filename.
    const ogg = join(directory, 'meeting.ogg');
    await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', source, '-c:a', 'copy', ogg]);
    await exec(process.execPath, [...args.slice(0, 2), ogg, ...args.slice(3)]);
    assert.equal(records.size, 2);
    await assert.rejects(exec(process.execPath, [...args.slice(0, 2), source, ...args.slice(3), '--out', ogg + '.workerwhisper-demo']),
      error => error.stderr.includes('Source file or Worker URL changed'));
    await assert.rejects(exec(process.execPath, [...args, '--recording-start', '2026-10-07T16:41:00']),
      error => error.stderr.includes('requires an ISO timestamp with a timezone'));
    await assert.rejects(exec(process.execPath, [...args, '--url', 'http://example.test']),
      error => error.stderr.includes('Remote Worker URLs require HTTPS'));
    await assert.rejects(exec(process.execPath, [...args, '--url', 'https://example.test'], {
      env: { ...process.env, CF_ACCESS_CLIENT_ID: '', CF_ACCESS_CLIENT_SECRET: '' },
    }), error => error.stderr.includes('Remote uploads require'));
    await assert.rejects(exec(process.execPath, args, {
      env: { ...process.env, CF_ACCESS_CLIENT_ID: 'id', CF_ACCESS_CLIENT_SECRET: '' },
    }), error => error.stderr.includes('Set both'));
    await exec(process.execPath, [...args, '--out', join(directory, 'local-auth')], {
      env: { ...process.env, CF_ACCESS_CLIENT_ID: 'id', CF_ACCESS_CLIENT_SECRET: 'secret' },
    });
    const transport = join(directory, 'secure-transport.mjs');
    await writeFile(transport, `
      import assert from 'node:assert/strict';
      import worker from ${JSON.stringify(new URL('../src/index.ts', import.meta.url).href)};
      import { ownerAccess, budgetBinding } from ${JSON.stringify(new URL('./helpers.mjs', import.meta.url).href)};
      globalThis.fetch = async (url, options) => {
        assert.equal(new URL(url).origin, 'https://example.test');
        assert.equal(options.headers['CF-Access-Client-Id'], 'id');
        assert.equal(options.headers['CF-Access-Client-Secret'], 'secret');
        assert.equal(options.redirect, 'error');
        console.log('Secure transport checked');
        return worker.fetch(new Request(url, options), {
          ACCESS_AUD: 'test-access', OWNER_EMAIL: 'owner@example.test', BUDGET: budgetBinding(), AI: { async run() { return { text: 'Secure clip' }; } },
          TRANSCRIPTS: { async put() {} },
        }, { access: ownerAccess });
      };
    `);
    const secured = await exec(process.execPath, [
      '--experimental-strip-types', '--import', transport, 'scripts/demo.mjs', source,
      '--url', 'https://example.test', '--out', join(directory, 'remote-auth'),
    ], { env: { ...process.env, CF_ACCESS_CLIENT_ID: 'id', CF_ACCESS_CLIENT_SECRET: 'secret' } });
    assert.equal(secured.stdout.match(/Secure transport checked/g).length, 3);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
