// Browser-only helpers kept as JavaScript so they can be served without a build step.
export const AUDIO_JS = String.raw`
function estimateTimeLeft(totalDuration, completedDuration, elapsedSeconds) {
  if (completedDuration <= 0 || elapsedSeconds <= 0) return 'estimating…';
  // ponytail: average speed varies with speech and network conditions; use recent clips if estimates drift.
  const seconds = Math.max(0, Math.ceil(elapsedSeconds / completedDuration * (totalDuration - completedDuration)));
  return '~' + Math.floor(seconds / 60) + 'm ' + seconds % 60 + 's remaining (excluding final save)';
}

function encodeWav(audio, start, end) {
  const samples = end - start;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const write = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
  write(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true);
  write(8, 'WAVE'); write(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, audio.sampleRate, true); view.setUint32(28, audio.sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, samples * 2, true);
  const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
  for (let i = start; i < end; i++) {
    let value = 0;
    for (const channel of channels) value += channel[i];
    value = Math.max(-1, Math.min(1, value / channels.length));
    view.setInt16(44 + (i - start) * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return buffer;
}

async function processChunks(job, transcribe, progress) {
  const chunkSamples = job.audio.sampleRate * 60;
  const count = Math.ceil(job.audio.length / chunkSamples);
  const first = job.chunks.length;
  const startedAt = Date.now();
  const duration = job.audio.length / job.audio.sampleRate;
  const report = completed => progress(completed, count, estimateTimeLeft(duration - first * 60,
    Math.min(completed * 60, duration) - first * 60, (Date.now() - startedAt) / 1000));
  // ponytail: contiguous 60-second clips can cut words; use silence-based boundaries if needed.
  while (job.chunks.length < count) {
    const index = job.chunks.length;
    const start = index * chunkSamples;
    const end = Math.min(start + chunkSamples, job.audio.length);
    report(index);
    const result = await transcribe(encodeWav(job.audio, start, end));
    job.chunks.push(result);
    report(index + 1);
  }
}
`;
