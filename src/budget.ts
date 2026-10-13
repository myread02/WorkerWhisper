export const CLIP_NEURONS = 47;

export function wavDuration(bytes: Uint8Array): number | null {
  if (bytes.length <= 44 || bytes.length > 1920044 || (bytes.length - 44) % 2) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint32(0, true) !== 0x46464952 || v.getUint32(8, true) !== 0x45564157
    || v.getUint32(12, true) !== 0x20746d66 || v.getUint32(36, true) !== 0x61746164
    || v.getUint32(4, true) !== bytes.length - 8 || v.getUint32(16, true) !== 16
    || v.getUint16(20, true) !== 1 || v.getUint16(22, true) !== 1
    || v.getUint32(24, true) !== 16000 || v.getUint32(28, true) !== 32000
    || v.getUint16(32, true) !== 2 || v.getUint16(34, true) !== 16
    || v.getUint32(40, true) !== bytes.length - 44) return null;
  return (bytes.length - 44) / 32000;
}

interface BudgetState { reservedNeurons: number; requests: number }
interface BudgetEnv { DAILY_NEURON_CAP?: string; TRANSCRIPTS: KVNamespace }

// One named Durable Object reserves atomically; KV is only a display/history copy.
export class DailyBudget {
  state: DurableObjectState;
  env: BudgetEnv;
  constructor(state: DurableObjectState, env: BudgetEnv) { this.state = state; this.env = env; }

  async fetch(request: Request): Promise<Response> {
    const cap = Number(this.env.DAILY_NEURON_CAP);
    if (!Number.isSafeInteger(cap) || cap < 1 || cap > 10000) {
      return Response.json({ error: 'Daily cap must be an integer between 1 and 10000 neurons.' }, { status: 503 });
    }
    if (!['GET', 'POST'].includes(request.method)) return new Response(null, { status: 405 });
    return this.state.blockConcurrencyWhile(async () => {
      const now = new Date();
      const day = now.toISOString().slice(0, 10);
      const budget = await this.state.storage.get<BudgetState>(day) ?? { reservedNeurons: 0, requests: 0 };
      const blocked = request.method === 'POST' && budget.reservedNeurons + CLIP_NEURONS > cap;
      if (request.method === 'POST' && !blocked) {
        budget.reservedNeurons += CLIP_NEURONS;
        budget.requests++;
        await this.state.storage.put(day, budget);
      }
      const snapshot = {
        day, capNeurons: cap, ...budget, remainingNeurons: Math.max(0, cap - budget.reservedNeurons),
        remainingClips: Math.floor(Math.max(0, cap - budget.reservedNeurons) / CLIP_NEURONS),
        neuronsPerClip: CLIP_NEURONS,
        resetsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString(),
        updatedAt: now.toISOString(),
      };
      if (request.method === 'POST' && !blocked) {
        await this.env.TRANSCRIPTS.put('budget:' + day + ':' + String(budget.requests).padStart(6, '0'), JSON.stringify(snapshot));
      }
      return Response.json(blocked ? { ...snapshot, error: 'Daily transcription budget reached. Resume after 08:00 Taiwan time.' } : snapshot,
        { status: blocked ? 429 : 200 });
    });
  }
}
