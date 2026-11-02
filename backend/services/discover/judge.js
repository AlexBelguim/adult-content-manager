/**
 * Who judges a performer's pictures with P. The scan runs on the NAS, P needs CLIP, so a picture is judged, in this order, by:
 *   1. acm-gpu, where the coordinator says it is (utils/aiUrl.js), the way the K scores go: POST /performer_keep. It takes
 *      its own slot on the GPU PC and answers with its CPU when the card is busy.
 *   2. The NAS's CPU: the p-cpu service next to the app (p-cpu/, P_CPU_URL), the same contract with P's numbers in the
 *      request, since it holds no model of its own. They come from acm-gpu (GET /performer_keep/weights), saved here every
 *      time it answers, so with the PC off it judges with the P the PC last had.
 *   3. Nobody: the error says waiting, the pictures stay saved and a later run judges them. A scan never stops for this.
 *
 *   POST <url>/performer_keep  { images: ["<base64 picture>", …], names: ["<file name>", …], why, weights?: { coef, intercept, backbone, model } }
 *   → { score: 0-100, model: "<checkpoint file>", used: n, failed: [names] }   the pictures judged together, as one performer
 */
const fs = require('fs');
const path = require('path');
const { getAiServerUrl } = require('../../utils/aiUrl');
const { ROOT } = require('./paths');
const { say, warn } = require('./runLog');

const WEIGHTS = path.join(ROOT, 'p_weights.json');
const RECHECK_MS = 60 * 1000;
const GPU_TIMEOUT_MS = 2 * 60 * 1000;
const CPU_TIMEOUT_MS = 10 * 60 * 1000;   // its first call loads CLIP, or downloads it

const cpuUrl = () => (process.env.P_CPU_URL || 'http://127.0.0.1:3345').replace(/\/+$/, '');
const gpuUrl = () => getAiServerUrl().replace(/\/+$/, '');
const unreachable = (err) => err.name === 'TimeoutError' || err.name === 'AbortError' || /fetch failed|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ETIMEDOUT/i.test(`${err.message} ${err.cause?.code || ''}`);
const waiting = () => Object.assign(new Error('nobody can judge right now: acm-gpu and the NAS\'s CPU service are both away'), { waiting: true });

const readWeights = () => { try { return JSON.parse(fs.readFileSync(WEIGHTS, 'utf8')); } catch { return null; } };
function saveWeights(w) {
  fs.mkdirSync(ROOT, { recursive: true });
  fs.writeFileSync(WEIGHTS + '.tmp', JSON.stringify(w));
  fs.renameSync(WEIGHTS + '.tmp', WEIGHTS);
}

async function ask(url, body, timeout) {
  const res = await fetch(`${url}/performer_keep`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  const answer = await res.json().catch(() => ({}));
  if (res.status === 503 || res.status === 404) throw Object.assign(new Error(answer.error || `HTTP ${res.status}`), { away: true });   // it runs, but has no P
  if (!res.ok) throw new Error(answer.error || `HTTP ${res.status}`);
  if (typeof answer.score !== 'number') throw new Error('answered without a score');
  return answer;
}

// A dropped connection is tried once more: one reset socket shouldn't send a minute of pictures to the CPU. A timeout isn't.
async function post(url, body, timeout) {
  try {
    return await ask(url, body, timeout);
  } catch (err) {
    if (err.name === 'TimeoutError' || !unreachable(err)) throw err;
    return ask(url, body, timeout);
  }
}

function createJudge({ threshold = 50, why = 'Discover' } = {}) {
  let gpuAwayUntil = 0;
  let cpuAwayUntil = 0;
  const judge = {
    file: readWeights()?.model || 'performer_keep.pt',
    threshold,
    done: { gpu: 0, cpu: 0 },
    cpuSeconds: 0,
    cpuPictures: 0,
    /** Asks acm-gpu for P's numbers, for the day the PC is off; says where the pictures will go. */
    async prepare() {
      try {
        const res = await fetch(`${gpuUrl()}/performer_keep/weights`, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const w = await res.json();
        saveWeights(w);
        judge.file = w.model || judge.file;
        say(`P: acm-gpu at ${gpuUrl()}, ${judge.file}`);
      } catch (err) {
        gpuAwayUntil = Date.now() + RECHECK_MS;
        say(`P: acm-gpu is not answering (${err.message}): ${readWeights() ? 'the NAS\'s CPU judges' : 'nothing to judge with until it has answered once'}`);
      }
    },
    /** Keep % (0-100) for the pictures as one performer; one picture judges a post on its own. Rejects with .waiting when nobody can. */
    async score(files) {
      const body = { images: files.map((f) => fs.readFileSync(f).toString('base64')), names: files.map((f) => path.basename(f)), why };
      if (Date.now() >= gpuAwayUntil) {
        try {
          const answer = await post(gpuUrl(), body, GPU_TIMEOUT_MS);
          judge.done.gpu += files.length;
          judge.file = answer.model || judge.file;
          return answer;
        } catch (err) {
          if (!err.away && !unreachable(err)) throw err;
          gpuAwayUntil = Date.now() + RECHECK_MS;
          warn(`P: acm-gpu went away (${err.message})`);
        }
      }
      const weights = readWeights();
      if (!weights || Date.now() < cpuAwayUntil) throw waiting();
      try {
        const start = Date.now();
        const answer = await post(cpuUrl(), { ...body, weights }, CPU_TIMEOUT_MS);
        judge.done.cpu += files.length;
        judge.cpuSeconds += (Date.now() - start) / 1000;
        judge.cpuPictures += files.length;
        judge.file = answer.model || weights.model || judge.file;
        return answer;
      } catch (err) {
        if (!err.away && !unreachable(err)) throw err;
        cpuAwayUntil = Date.now() + RECHECK_MS;
        warn(`P: the NAS's CPU service is away too (${err.message})`);
        throw waiting();
      }
    },
    /** How the run went, for its log: seconds a picture on the NAS's CPU is the number that says whether it keeps up */
    summary() {
      const cpu = judge.cpuPictures ? `, ${judge.done.cpu} on the NAS's CPU (${(judge.cpuSeconds / judge.cpuPictures).toFixed(1)} s a picture)` : '';
      return `P judged ${judge.done.gpu} pictures on acm-gpu${cpu}`;
    },
    secondsPerPicture: () => (judge.cpuPictures ? judge.cpuSeconds / judge.cpuPictures : null),
  };
  return judge;
}

module.exports = { createJudge };
