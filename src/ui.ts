import { AUDIO_JS } from './audio.ts';

export const HTML_CONTENT = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>WorkerWhisper — your private transcript workspace</title>
<style>
:root{color-scheme:light;--paper:#f6f4ed;--ink:#24372e;--muted:#65756a;--line:#dce1d5;--accent:#c9df78}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:15px;line-height:1.6}
button,input{font:inherit}button,a,input{outline-offset:5px}button:focus-visible,a:focus-visible,input:focus-visible{outline:2px solid var(--ink)}button{cursor:pointer}button:disabled{opacity:.5;cursor:wait}main{max-width:1180px;margin:auto;padding:0 48px 64px}
.topbar{display:flex;align-items:center;justify-content:space-between;padding:28px 0;border-bottom:1px solid var(--line)}
.brand{font-weight:700;letter-spacing:-.5px;font-size:19px;display:flex;align-items:center;gap:12px}
.mark{display:flex;align-items:center;gap:3px;height:27px}
.mark i{display:block;background:var(--ink);width:4px;border-radius:4px;height:12px}
.mark i:nth-child(2){height:24px}
.mark i:nth-child(3){height:18px}
.badge{font-size:11px;letter-spacing:1.1px;text-transform:uppercase;border:1px solid var(--line);border-radius:20px;padding:5px 12px}
.badge:before{content:"";display:inline-block;width:6px;height:6px;background:#5d8151;border-radius:50%;margin-right:8px}
.hero{display:grid;grid-template-columns:1fr 330px;gap:80px;padding:64px 0 44px;align-items:end}
.eyebrow{font-size:11px;font-weight:650;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin:0 0 16px}
h1{font-family:ui-serif,Georgia,serif;font-weight:400;font-size:clamp(44px,6vw,68px);letter-spacing:-2.5px;line-height:1.05;margin:0 0 22px}
h1 em{font-weight:400;color:#789151}
p{margin:0}
.intro{max-width:410px;color:var(--muted);font-size:15px}
.budget{background:var(--ink);color:var(--paper);padding:25px 28px;border-radius:12px}
.budget-heading{display:flex;align-items:center;justify-content:space-between;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#d6dfcd}
.budget button{background:none;color:#d6dfcd;border:0;font-size:12px;text-transform:none;letter-spacing:0;padding:0}
.budget-number{font-size:44px;line-height:1.2;letter-spacing:-1.8px;font-variant-numeric:tabular-nums;margin-top:17px}
.budget-number small{font-size:12px;letter-spacing:0;color:#c1cbb9;margin-left:6px}
.budget progress{appearance:none;width:100%;height:5px;border:0;border-radius:3px;background:#516155;display:block;margin:18px 0 12px}
.budget progress::-webkit-progress-bar{background:#516155;border-radius:3px}
.budget progress::-webkit-progress-value{background:var(--accent);border-radius:3px}
.budget progress::-moz-progress-bar{background:var(--accent);border-radius:3px}
.budget-meta{font-size:12px;color:#c1cbb9}
.budget-note{font-size:11px;color:#c1cbb9;margin-top:7px}
.workspace{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:32px;align-items:start}
.panel{border:1px solid var(--line);background:#fdfcf8;border-radius:12px;padding:28px}
.panel-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px}
h2{font-size:17px;font-weight:600;letter-spacing:-.3px;margin:0}
.step{font-size:11px;color:var(--muted);letter-spacing:1px}
.upload-area{position:relative;display:flex;min-height:190px;align-items:center;justify-content:center;text-align:center;background:#f2f4eb;border:1px dashed #a8b69c;border-radius:8px;padding:28px;cursor:pointer}
.upload-area:focus-within{outline:2px solid var(--ink);outline-offset:4px}
.upload-area input{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer}
.upload-icon{display:block;font-size:30px;font-weight:300;line-height:1;margin-bottom:15px}
.upload-title{display:block;font-size:16px;font-weight:600}
.upload-help{display:block;font-size:12px;color:var(--muted);margin-top:6px}
.field-row{display:flex;align-items:end;justify-content:space-between;gap:18px;margin-top:24px}
.field-row label{display:block;font-size:12px;color:var(--muted);margin-bottom:6px}
.field-row input{max-width:100%;background:transparent;border:1px solid var(--line);border-radius:5px;padding:8px 10px;font-size:13px;color:var(--ink)}
.primary{background:var(--ink);color:var(--paper);border:0;border-radius:6px;padding:12px 20px;font-size:13px;font-weight:550;white-space:nowrap}
.quiet{border:1px solid var(--line);background:transparent;color:var(--ink);padding:7px 12px;border-radius:5px;font-size:12px}
.privacy{display:flex;justify-content:space-between;gap:10px;margin-top:22px;padding-top:18px;border-top:1px solid var(--line);font-size:11px;color:var(--muted)}
#status{font-size:13px;margin-top:20px;overflow-wrap:anywhere}
#status:empty{display:none}
.result{margin-top:24px}
pre{margin:0 0 16px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:520px;overflow:auto;font-family:ui-monospace,SFMono-Regular,monospace;font-size:12px;line-height:1.9;border-top:1px solid var(--line);padding-top:22px}
#download{display:inline-block;color:var(--ink);font-size:13px;text-underline-offset:4px}
#download[hidden]{display:none}
ul{list-style:none;padding:0;margin:0}
li{padding:16px 0;border-bottom:1px solid var(--line);display:flex;gap:12px;align-items:center;justify-content:space-between}
li span{min-width:0;font-size:12px;overflow-wrap:anywhere}
li button{background:none;border:0;color:var(--muted);font-size:12px;padding:4px}
li:first-child{padding-top:0}
.history-note{font-size:12px;color:var(--muted);margin-top:20px}
#more{margin-top:18px}
.footer{margin-top:44px;display:flex;justify-content:space-between;border-top:1px solid var(--line);padding-top:18px;font-size:11px;color:var(--muted)}
@media(max-width:850px){main{padding:0 24px 36px}
.hero{gap:32px;grid-template-columns:1fr 280px;padding-top:40px}
.workspace{grid-template-columns:1fr}
.history-panel{order:2}
.privacy{flex-wrap:wrap}}
@media(max-width:600px){main{padding:0 18px 28px}
.hero{grid-template-columns:1fr;padding-top:36px;gap:28px}
.hero h1{font-size:48px}
.budget{padding:22px}
.panel{padding:22px}
.field-row{align-items:stretch;flex-direction:column}
.field-row input{width:100%}
.footer{gap:12px;flex-wrap:wrap}
.topbar{padding:20px 0}
.badge{font-size:9px}}
</style>
</head>
<body>
<main>
<header class="topbar"><div class="brand"><span class="mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>WorkerWhisper</div><span class="badge">Private workspace</span></header>
<section class="hero" aria-labelledby="page-title">
<div><p class="eyebrow">A little clarity, from every conversation</p><h1 id="page-title">Your words.<br><em>Worth keeping.</em></h1><p class="intro">Turn your recordings into readable transcripts. English, 繁體中文, ภาษาไทย, and Filipino, together.</p></div>
<aside class="budget" aria-label="Daily transcription budget"><div class="budget-heading"><span>Daily budget remaining</span><button id="refreshUsage" type="button">Refresh ↻</button></div><div class="budget-number"><span id="budgetLeft">—</span><small>neurons</small></div><progress id="budgetBar" max="10000" value="0" aria-label="Remaining daily budget"></progress><p id="budgetDetail" class="budget-meta" role="status" aria-live="polite">Checking your budget…</p><p class="budget-note">App reservations · resets at 08:00 Taiwan</p></aside>
</section>
<div class="workspace">
<section class="panel" aria-labelledby="upload-heading"><div class="panel-head"><h2 id="upload-heading">Make room for the conversation</h2><span class="step">01 / TRANSCRIBE</span></div>
<form id="upload"><label class="upload-area" for="audioFile"><span><span class="upload-icon" aria-hidden="true">↑</span><span id="fileLabel" class="upload-title">Choose a recording</span><span id="fileDetail" class="upload-help">Ogg or Opus · split into 60-second clips for you</span></span><input type="file" id="audioFile" accept=".ogg,.opus,audio/ogg,audio/opus" required aria-label="Choose an Ogg or Opus recording"></label>
<div class="field-row"><div><label for="recordingStart">Recording start <span>(optional, local time)</span></label><input type="datetime-local" id="recordingStart"></div><button id="submitBtn" class="primary" type="submit">Upload &amp; Transcribe</button></div>
<div class="privacy"><span>Owner access only</span><span>Audio processed by Cloudflare AI</span><span>Transcript saved to history</span></div></form>
<p id="status" role="status" aria-live="polite"></p><div class="result"><pre id="output" hidden></pre><a id="download" hidden>Download transcript (.txt) ↓</a></div></section>
<aside class="panel history-panel" aria-labelledby="history-heading"><div class="panel-head"><h2 id="history-heading">Your archive</h2><span class="step">02 / SAVED</span></div><ul id="history"></ul><button id="more" class="quiet" hidden>Load more</button><p class="history-note">Saved transcripts stay here, ready when you need them.</p></aside>
</div>
<footer class="footer"><span>WORKERWHISPER / A quieter way to take notes.</span><span>Whisper Turbo · Cloudflare Workers AI</span></footer>
</main>
<script>
${AUDIO_JS}
const fileInput = document.getElementById('audioFile');
const submitBtn = document.getElementById('submitBtn');
const statusEl = document.getElementById('status');
const output = document.getElementById('output');
const historyList = document.getElementById('history');
const more = document.getElementById('more');
let cursor = null;
let job = null;
let downloadURL = null;
const download = document.getElementById('download');
fileInput.onchange = () => {
  const file = fileInput.files[0];
  document.getElementById('fileLabel').textContent = file ? file.name : 'Choose a recording';
  document.getElementById('fileDetail').textContent = file ? (file.size / 1000000).toFixed(2) + ' MB · ready to transcribe' : 'Ogg or Opus · split into 60-second clips for you';
};
async function refreshUsage() {
  const button = document.getElementById('refreshUsage');
  button.disabled = true;
  try {
    const data = await getJSON('/api/usage');
    document.getElementById('budgetLeft').textContent = data.remainingNeurons.toLocaleString();
    const bar = document.getElementById('budgetBar');
    bar.max = data.capNeurons; bar.value = data.remainingNeurons;
    document.getElementById('budgetDetail').textContent = data.reservedNeurons.toLocaleString() + ' / ' + data.capNeurons.toLocaleString() + ' reserved · up to ' + data.remainingClips + ' more clips';
  } catch (err) {
    document.getElementById('budgetLeft').textContent = '—';
    document.getElementById('budgetDetail').textContent = 'Budget unavailable: ' + err.message;
  } finally { button.disabled = false; }
}
document.getElementById('refreshUsage').onclick = refreshUsage;
async function getJSON(url, options) {
  const res = await fetch(url, options);
  let data;
  try { data = await res.json(); }
  catch { throw new Error('Server unavailable. Check the local server or Access login.'); }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function show(data) {
  statusEl.textContent = 'Loaded: ' + data.filename;
  output.textContent = data.exportText; output.hidden = false;
  if (downloadURL) URL.revokeObjectURL(downloadURL);
  downloadURL = URL.createObjectURL(new Blob([data.exportText], { type: 'text/plain;charset=utf-8' }));
  download.href = downloadURL; download.download = data.outputFilename; download.hidden = false;
}
async function fetchHistory(append = false) {
  more.disabled = true;
  try {
    const data = await getJSON('/api/transcripts' + (append && cursor ? '?cursor=' + encodeURIComponent(cursor) : ''));
    if (!append) historyList.replaceChildren();
    for (const item of data.items) {
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = item.filename + (item.createdAt ? ' (' + new Date(item.createdAt).toLocaleString() + ')' : '');
      const button = document.createElement('button');
      button.textContent = 'View';
      button.onclick = async () => {
        button.disabled = true;
        try { show(await getJSON('/api/transcripts/' + encodeURIComponent(item.id))); }
        catch (err) { statusEl.textContent = err.message; }
        finally { button.disabled = false; }
      };
      li.append(label, button); historyList.append(li);
    }
    cursor = data.cursor; more.hidden = !cursor;
    if (!historyList.children.length) historyList.textContent = 'Your first transcript belongs here.';
  } catch (err) { statusEl.textContent = 'History: ' + err.message; }
  finally { more.disabled = false; }
}
document.getElementById('upload').onsubmit = async event => {
  event.preventDefault();
  const file = fileInput.files[0];
  if (!file) return;
  if (!/\\.(ogg|opus)$/i.test(file.name) || !file.size) {
    statusEl.textContent = 'Select a nonempty .ogg or .opus file.'; return;
  }
  submitBtn.disabled = true; fileInput.disabled = true;
  const startInput = document.getElementById('recordingStart');
  startInput.disabled = true;
  output.hidden = true; download.hidden = true;
  try {
    const start = startInput.value;
    if (!job || job.file !== file || job.start !== start) {
      job = null;
      statusEl.textContent = 'Decoding audio and preparing clips…';
      // ponytail: decode the whole recording in browser memory; use streaming decoding for recordings that exceed device memory.
      let audio;
      try { audio = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(await file.arrayBuffer()); }
      catch { throw new Error('This browser could not decode the audio. Try a browser with Ogg/Opus support.'); }
      if (!audio.length || Math.ceil(audio.length / (audio.sampleRate * 60)) > 1000) {
        throw new Error('Choose audio between 1 sample and 1,000 minutes long.');
      }
      job = { file, start, audio, chunks: [], createdAt: new Date().toISOString(),
        recordingStart: start ? new Date(start).toISOString() : undefined };
    }
    const params = new URLSearchParams({ name: file.name, chunk: '1' });
    await processChunks(job, wav => getJSON('/api/transcribe?' + params, {
      method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav
    }), (completed, total, estimate) => {
      statusEl.textContent = 'Transcribing: ' + completed + ' / ' + total + ' clips complete · ' + estimate;
      output.textContent = job.chunks.map(chunk => chunk.text).join('\\n\\n'); output.hidden = false;
    });
    statusEl.textContent = 'Combining and saving transcript…';
    const data = await getJSON('/api/transcripts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.name, createdAt: job.createdAt, recordingStart: job.recordingStart,
        audioBytes: file.size, audioDuration: job.audio.length / job.audio.sampleRate, chunks: job.chunks })
    });
    show(data); statusEl.textContent = 'Transcription saved: ' + data.filename;
    job = null; submitBtn.textContent = 'Upload & Transcribe';
    await fetchHistory();
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message + ' Keep this page open and retry to resume.';
    if (job && job.chunks.length) {
      if (downloadURL) URL.revokeObjectURL(downloadURL);
      downloadURL = URL.createObjectURL(new Blob([job.chunks.map(chunk => chunk.text).join('\\n\\n')], { type: 'text/plain;charset=utf-8' }));
      download.href = downloadURL; download.download = 'partial_' + file.name + '.txt'; download.hidden = false;
    }
    submitBtn.textContent = 'Retry / Resume';
  } finally { submitBtn.disabled = false; fileInput.disabled = false; startInput.disabled = false; await refreshUsage(); }
};
more.onclick = () => fetchHistory(true);
fetchHistory();
refreshUsage();
</script>
</body></html>`;
