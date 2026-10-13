import { HTML_CONTENT } from './ui.ts';
import { wavDuration } from './budget.ts';
export { DailyBudget } from './budget.ts';

interface Env {
  AI: Ai;
  TRANSCRIPTS: KVNamespace;
  ACCESS_AUD?: string;
  OWNER_EMAIL?: string;
  ALLOWED_SERVICE_TOKEN_ID?: string;
  BUDGET: DurableObjectNamespace;
}

interface TranscriptRecord {
  id: string;
  filename: string;
  createdAt: string;
  text: string;
  vtt?: string;
  wordCount?: number;
  recordingStart?: string;
  sourceLocation?: string;
  audioBytes?: number;
  audioDuration?: number;
  transcribeSeconds?: number;
  convertedAudio?: string;
}

function taipeiTime(value: string | number): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`;
}

export function formatTranscript(record: TranscriptRecord) {
  const stamp = taipeiTime(record.createdAt);
  const date = stamp.slice(0, 10).replaceAll('-', '');
  const time = stamp.slice(11).replaceAll(':', '');
  const source = record.filename.replace(/[\r\n]/g, ' ');
  const seconds = record.transcribeSeconds === undefined ? undefined : Math.round(record.transcribeSeconds);
  const end = record.recordingStart && record.audioDuration !== undefined
    ? taipeiTime(new Date(record.recordingStart).getTime() + record.audioDuration * 1000).slice(0, 16) : 'Unknown';
  return {
    outputFilename: `cloud-${date.slice(2)}-${time}_${source.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}.txt`,
    exportText: `Voice Memo Transcript - ${record.recordingStart ? taipeiTime(record.recordingStart).slice(0, 10).replaceAll('-', '') : date}

## Metadata
Recording Start Time: ${record.recordingStart ? taipeiTime(record.recordingStart).slice(0, 16) : 'Unknown'}
Recording End Time: ${end}
Source File: ${source}
Source Location: ${record.sourceLocation?.replace(/[\r\n]/g, ' ') || 'Unknown (browser uploads do not expose the local path)'}
Converted Audio: ${record.convertedAudio || 'Not converted (original audio sent to Workers AI)'}
Audio Size: ${record.audioBytes === undefined ? 'Unknown' : (record.audioBytes / 1000000).toFixed(2) + ' MB'}
Audio Length: ${record.audioDuration === undefined ? 'Unknown' : (record.audioDuration / 60).toFixed(2) + ' min'}
Transcribe Backend: Cloudflare Workers AI
Transcribe Device: Cloudflare-managed
Transcribe Model: @cf/openai/whisper-large-v3-turbo
Transcribe Time: ${seconds === undefined ? 'Unknown' : Math.floor(seconds / 60) + 'm ' + seconds % 60 + 's'}
Recording Timezone: Asia/Taipei

## Transcript
${record.text}
`,
  };
}

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const PROMPT = '繁體中文，臺灣用語。English mixed conversation, Tagalog / Filipino, and ภาษาไทย.';

async function readBody(request: Request, limit: number): Promise<Uint8Array | null> {
  if (Number(request.headers.get('Content-Length')) > limit) return null;
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

async function saveTranscript(record: TranscriptRecord, env: Env): Promise<Response> {
  await env.TRANSCRIPTS.put(record.id, JSON.stringify(record), {
    metadata: { filename: record.filename, createdAt: record.createdAt },
  });
  return Response.json({ ...record, ...formatTranscript(record) });
}

const validDate = (value: unknown): value is string => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
const validFilename = (value: unknown): value is string => typeof value === 'string'
  && /\.(ogg|opus)$/i.test(value) && new TextEncoder().encode(value).length <= 512;
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const recordId = () => `rec_${String(9999999999999 - Date.now()).padStart(13, '0')}_${crypto.randomUUID()}`;

async function handleRequest(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === 'GET' && url.pathname === '/') {
        return new Response(HTML_CONTENT, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
      if (request.method === 'GET' && url.pathname === '/api/usage') {
        return await env.BUDGET.getByName('daily-ai-budget').fetch('https://budget/');
      }
      if (request.method === 'POST' && url.pathname === '/api/transcribe') {
        const startedAt = Date.now();
        const recordingStart = url.searchParams.get('recordingStart') || undefined;
        if (recordingStart && !validDate(recordingStart)) {
          return Response.json({ error: 'Invalid recording start time.' }, { status: 400 });
        }
        const filename = url.searchParams.get('name') || 'audio.ogg';
        if (!validFilename(filename)) {
          return Response.json({ error: 'Choose an .ogg or .opus file with a filename under 512 bytes.' }, { status: 400 });
        }
        const bytes = await readBody(request, MAX_AUDIO_BYTES);
        if (bytes === null) return Response.json({ error: 'Audio chunks must be 10 MiB or smaller.' }, { status: 413 });
        const size = bytes.byteLength;
        if (!size) return Response.json({ error: 'Empty audio payload.' }, { status: 400 });
        const duration = wavDuration(bytes);
        if (duration === null) return Response.json({ error: 'Upload a 16 kHz mono PCM16 WAV clip of at most 60 seconds. Use the browser or CLI to convert Ogg/Opus.' }, { status: 400 });
        const reservation = await env.BUDGET.getByName('daily-ai-budget').fetch('https://budget/', { method: 'POST' });
        if (!reservation.ok) return reservation;
        // Avoid spreading the entire file onto the JavaScript call stack.
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        }
        const inferenceStart = Date.now();
        const response = await env.AI.run('@cf/openai/whisper-large-v3-turbo', {
          audio: btoa(binary), initial_prompt: PROMPT, task: 'transcribe',
        });
        if (typeof response.text !== 'string') throw new Error('Model returned no transcript.');
        // KV sorts lexicographically; inverted timestamps put newest records first.
        const id = recordId();
        const record: TranscriptRecord = {
          id, filename, createdAt: new Date(startedAt).toISOString(), text: response.text,
          recordingStart, audioBytes: size, audioDuration: duration,
          transcribeSeconds: (Date.now() - inferenceStart) / 1000,
          convertedAudio: 'PCM16 WAV (16 kHz, mono)',
          vtt: response.vtt, wordCount: response.word_count,
        };
        if (url.searchParams.get('chunk') === '1') {
          return Response.json({ text: record.text, transcribeSeconds: record.transcribeSeconds, wordCount: record.wordCount });
        }
        return await saveTranscript(record, env);
      }
      if (request.method === 'POST' && url.pathname === '/api/transcripts') {
        const bytes = await readBody(request, 2 * 1024 * 1024);
        if (bytes === null) return Response.json({ error: 'Combined transcript exceeds 2 MiB.' }, { status: 413 });
        let data;
        try { data = JSON.parse(new TextDecoder().decode(bytes)); }
        catch { return Response.json({ error: 'Invalid JSON.' }, { status: 400 }); }
        if (!data || !validFilename(data.filename) || !validDate(data.createdAt)
          || (data.recordingStart !== undefined && !validDate(data.recordingStart))
          || (data.sourceLocation !== undefined && (typeof data.sourceLocation !== 'string'
            || !data.sourceLocation.length || /[\r\n\x00]/.test(data.sourceLocation)
            || new TextEncoder().encode(data.sourceLocation).length > 4096))
          || !Number.isSafeInteger(data.audioBytes) || data.audioBytes <= 0
          || !nonnegative(data.audioDuration) || data.audioDuration <= 0
          || !Array.isArray(data.chunks) || !data.chunks.length || data.chunks.length > 1000
          || data.chunks.length !== Math.ceil(data.audioDuration / 60)
          || !data.chunks.every((chunk: unknown) => {
            if (!chunk || typeof chunk !== 'object') return false;
            const part = chunk as Record<string, unknown>;
            return typeof part.text === 'string' && nonnegative(part.transcribeSeconds)
              && (part.wordCount === undefined || (Number.isSafeInteger(part.wordCount) && nonnegative(part.wordCount)));
          })) {
          return Response.json({ error: 'Invalid or incomplete chunk results.' }, { status: 400 });
        }
        const chunks: { text: string; transcribeSeconds: number; wordCount?: number }[] = data.chunks;
        const record: TranscriptRecord = {
          id: recordId(), filename: data.filename, createdAt: data.createdAt,
          recordingStart: data.recordingStart, audioBytes: data.audioBytes, audioDuration: data.audioDuration,
          sourceLocation: data.sourceLocation,
          convertedAudio: '60-second WAV chunks (16 kHz, mono, PCM16)',
          text: chunks.map(chunk => chunk.text.trim()).join('\n\n'),
          transcribeSeconds: chunks.reduce((sum, chunk) => sum + chunk.transcribeSeconds, 0),
          wordCount: chunks.every(chunk => chunk.wordCount !== undefined)
            ? chunks.reduce((sum, chunk) => sum + chunk.wordCount!, 0) : undefined,
        };
        return await saveTranscript(record, env);
      }
      if (request.method === 'GET' && url.pathname === '/api/transcripts') {
        const list = await env.TRANSCRIPTS.list<{ filename: string; createdAt: string }>({
          prefix: 'rec_', limit: 20, cursor: url.searchParams.get('cursor') || undefined,
        });
        return Response.json({
          items: list.keys.map(key => ({ id: key.name, filename: key.metadata?.filename || key.name, createdAt: key.metadata?.createdAt || '' })),
          cursor: list.list_complete ? null : list.cursor,
        });
      }
      if (request.method === 'GET' && url.pathname.startsWith('/api/transcripts/')) {
        const id = url.pathname.slice('/api/transcripts/'.length);
        if (!/^rec_\d{13}_[\da-f-]{36}$/.test(id)) return Response.json({ error: 'Invalid ID.' }, { status: 400 });
        const data = await env.TRANSCRIPTS.get(id);
        if (data === null) return Response.json({ error: 'Not found.' }, { status: 404 });
        const record: TranscriptRecord = JSON.parse(data);
        return Response.json({ ...record, ...formatTranscript(record) });
      }
      return Response.json({ error: 'Not found.' }, { status: 404 });
    } catch (error) {
      console.error('Worker request failed', error);
      return Response.json({ error: 'Unable to complete the request. Please retry.' }, { status: 500 });
    }
}

export default {
  async fetch(request: Request, env: Env, ctx: Pick<ExecutionContext, 'access'>): Promise<Response> {
    let response: Response;
    try {
      if (!env.ACCESS_AUD || !env.OWNER_EMAIL) {
        response = Response.json({ error: 'Cloudflare Access is not configured.' }, { status: 503 });
      } else if (!ctx?.access || ctx.access.aud !== env.ACCESS_AUD) {
        response = Response.json({ error: 'Cloudflare Access authentication required.' }, { status: 403 });
      } else if (request.method === 'POST' && (
        (request.headers.has('Origin') && request.headers.get('Origin') !== new URL(request.url).origin)
        || request.headers.get('Sec-Fetch-Site') === 'cross-site'
      )) {
        response = Response.json({ error: 'Cross-site uploads are not allowed.' }, { status: 403 });
      } else {
        const identity = await ctx.access.getIdentity();
        const owner = typeof identity?.email === 'string' && identity.email.toLowerCase() === env.OWNER_EMAIL.toLowerCase();
        const service = !!env.ALLOWED_SERVICE_TOKEN_ID && identity?.service_token_status === true
          && identity.service_token_id === env.ALLOWED_SERVICE_TOKEN_ID;
        response = owner || service ? await handleRequest(request, env)
          : Response.json({ error: 'Owner access required.' }, { status: 403 });
      }
    } catch {
      response = Response.json({ error: 'Unable to verify access. Please retry.' }, { status: 503 });
    }
    response = new Response(response.body, response);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  },
};
