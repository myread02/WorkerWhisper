import { spawnSync } from 'node:child_process';
import { open, mkdir, readFile, writeFile, rename, stat, unlink } from 'node:fs/promises';
import { basename, resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { AUDIO_JS } from '../src/audio.ts';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  url: { type: 'string', default: 'http://localhost:8787' },
  out: { type: 'string' }, help: { type: 'boolean' },
  'recording-start': { type: 'string' },
} });
if (values.help || positionals.length !== 1) {
  console.log('Usage: npm run demo -- recording.opus [--url http://localhost:8787] [--out directory] [--recording-start 2026-10-07T16:41:00+08:00]');
  process.exit(values.help ? 0 : 1);
}

async function atomicJSON(path, data) {
  await writeFile(path + '.tmp', JSON.stringify(data, null, 2), { mode: 0o600 });
  await rename(path + '.tmp', path);
}

async function post(url, type, body) {
  const headers = { 'Content-Type': type };
  if (url.protocol === 'https:' && process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
    headers['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID;
    headers['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET;
  }
  const response = await fetch(url, { method: 'POST', headers, body, redirect: 'error' });
  let data;
  try { data = await response.json(); }
  catch { throw new Error(`HTTP ${response.status}: expected JSON. Check the Worker URL and authentication.`); }
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${data.error || 'Request failed'}`);
  return data;
}

async function demo() {
  const start = values['recording-start'];
  if (start !== undefined && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})$/.test(start)
    || !Number.isFinite(Date.parse(start)))) {
    throw new Error('--recording-start requires an ISO timestamp with a timezone, such as 2026-10-07T16:41:00+08:00');
  }
  const recordingStart = start === undefined ? undefined : new Date(start).toISOString();
  const source = resolve(positionals[0]);
  if (/[\r\n\x00]/.test(source) || Buffer.byteLength(source) > 4096) throw new Error('Source path must be under 4096 bytes without line breaks.');
  const filename = basename(source);
  if (!/\.(ogg|opus)$/i.test(filename) || Buffer.byteLength(filename) > 512) {
    throw new Error('Choose an .ogg or .opus file with a filename under 512 bytes.');
  }
  const endpoint = new URL(values.url);
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) {
    throw new Error('--url must be a Worker origin, such as http://localhost:8787');
  }
  if (endpoint.username || endpoint.password) throw new Error('Do not put credentials in the Worker URL.');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
  if (!local && endpoint.protocol !== 'https:') throw new Error('Remote Worker URLs require HTTPS.');
  const clientId = process.env.CF_ACCESS_CLIENT_ID;
  const clientSecret = process.env.CF_ACCESS_CLIENT_SECRET;
  if (Boolean(clientId) !== Boolean(clientSecret)) throw new Error('Set both CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET.');
  if (!local && (!clientId || !clientSecret)) throw new Error('Remote uploads require CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET.');
  process.umask(0o077);
  const info = await stat(source);
  if (!info.isFile() || !info.size) throw new Error('Choose a nonempty audio file.');
  const out = resolve(values.out || source + '.workerwhisper-demo');
  await mkdir(out, { recursive: true, mode: 0o700 });
  const lockPath = join(out, 'running.lock');
  const lock = await open(lockPath, 'wx').catch(() => {
    throw new Error(`Output directory is locked. If an earlier run was killed, remove ${lockPath} before resuming.`);
  });
  await lock.close();
  try {
    const statePath = join(out, 'job.json');
    const pcmPath = join(out, 'audio.pcm');
    let job;
    try { job = JSON.parse(await readFile(statePath, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (job) {
      if (job.source !== source || job.audioBytes !== info.size || job.mtimeMs !== info.mtimeMs || job.url !== endpoint.origin) {
        throw new Error('Source file or Worker URL changed. Use a new --out directory.');
      }
      if (start !== undefined && job.recordingStart !== recordingStart) {
        throw new Error('Recording start changed. Use a new --out directory.');
      }
    } else {
      console.log('Decoding with FFmpeg to 16 kHz mono PCM…');
      const conversion = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
        '-i', source, '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', '-f', 's16le', pcmPath], { stdio: 'inherit' });
      if (conversion.error || conversion.status !== 0) throw new Error('FFmpeg failed. Install ffmpeg and verify the recording.');
      const pcmBytes = (await stat(pcmPath)).size;
      if (!pcmBytes || pcmBytes % 2 || Math.ceil(pcmBytes / 1920000) > 1000) {
        throw new Error('Choose audio between 1 sample and 1,000 minutes long.');
      }
      job = { source, filename, audioBytes: info.size, mtimeMs: info.mtimeMs, url: endpoint.origin,
        createdAt: new Date().toISOString(), recordingStart, audioDuration: pcmBytes / 32000, pcmBytes, chunks: [] };
      await atomicJSON(statePath, job);
    }
    if (job.result) {
      await writeFile(join(out, 'transcript.txt'), job.result.exportText);
      console.log(`Already complete: ${join(out, 'transcript.txt')}`);
      return;
    }
    if ((await stat(pcmPath)).size !== job.pcmBytes) throw new Error('Decoded audio changed. Use a new --out directory.');
    const total = Math.ceil(job.pcmBytes / 1920000);
    console.log(`${job.audioDuration.toFixed(1)} seconds, ${total} clips; ${job.chunks.length} already complete.`);
    // Reuse the browser WAV header; copy PCM bytes directly without decoding them again.
    const { encodeWav, estimateTimeLeft } = new Function(AUDIO_JS + '; return { encodeWav, estimateTimeLeft };')();
    const header = Buffer.from(encodeWav({ sampleRate: 16000, numberOfChannels: 0 }, 0, 0));
    const pcm = await open(pcmPath, 'r');
    const first = job.chunks.length;
    const startedAt = Date.now();
    try {
      while (job.chunks.length < total) {
        const index = job.chunks.length;
        const length = Math.min(1920000, job.pcmBytes - index * 1920000);
        const wav = Buffer.alloc(44 + length);
        header.copy(wav);
        wav.writeUInt32LE(36 + length, 4); wav.writeUInt32LE(length, 40);
        let read = 0;
        while (read < length) {
          const { bytesRead } = await pcm.read(wav, 44 + read, length - read, index * 1920000 + read);
          if (!bytesRead) throw new Error('Decoded audio is incomplete. Use a new --out directory.');
          read += bytesRead;
        }
        console.log(`Uploading / transcribing clip ${index + 1} / ${total}…`);
        const url = new URL('/api/transcribe', endpoint);
        url.search = new URLSearchParams({ name: filename, chunk: '1' }).toString();
        const result = await post(url, 'audio/wav', wav);
        if (typeof result?.text !== 'string' || !Number.isFinite(result.transcribeSeconds) || result.transcribeSeconds < 0
          || (result.wordCount !== undefined && (!Number.isSafeInteger(result.wordCount) || result.wordCount < 0))) {
          throw new Error('Worker returned an invalid clip result.');
        }
        job.chunks.push(result);
        await atomicJSON(statePath, job);
        await writeFile(join(out, 'partial.txt'), job.chunks.map(chunk => chunk.text.trim()).join('\n\n'));
        console.log(`${job.chunks.length} / ${total} clips complete · ` + estimateTimeLeft(job.audioDuration - first * 60,
          Math.min(job.chunks.length * 60, job.audioDuration) - first * 60, (Date.now() - startedAt) / 1000));
      }
    } finally { await pcm.close(); }
    console.log('Saving combined transcript…');
    const result = await post(new URL('/api/transcripts', endpoint), 'application/json', JSON.stringify({
      filename, createdAt: job.createdAt, audioBytes: job.audioBytes, audioDuration: job.audioDuration, chunks: job.chunks,
      sourceLocation: source, recordingStart: job.recordingStart,
    }));
    if (typeof result?.exportText !== 'string') throw new Error('Worker returned an invalid saved transcript.');
    job.result = result;
    await atomicJSON(statePath, job);
    await writeFile(join(out, 'transcript.txt'), result.exportText);
    console.log(`Done: ${join(out, 'transcript.txt')}`);
  } finally { await unlink(lockPath); }
}

demo().catch(error => {
  console.error(error.message);
  console.error('Rerun the same command to resume. Completed clips are saved in job.json.');
  process.exitCode = 1;
});
