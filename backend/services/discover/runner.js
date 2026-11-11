/**
 * Discover's runs: two slots, one for runs started by hand (a long one, like every Leakhaven model, takes hours) and one for
 * the timer, so watching goes on meanwhile. The two never run the same watchers at once. The timer is off until it's switched
 * on on the page; on, it stays on across a restart of the app (a redeploy shouldn't quietly stop it). A timer run that cannot
 * start because the run by hand covers the same watchers waits for it (waitingForHand) and starts when it ends.
 */
const { inRun } = require('./runLog');
const scanner = require('./scan');
const { WATCHERS, LIMITS } = require('./watchers');
const store = require('./store');

const blank = () => ({ running: false, mode: null, watcher: null, startedAt: null, finishedAt: null, exitCode: null, error: null, secondsPerPicture: null, log: [] });
const job = blank();
const watchJob = blank();
const watch = { on: false, minutes: LIMITS.watchMinutes, timer: null, nextAt: null, waitingForHand: false };
const listeners = new Set();

const onWatch = (id) => WATCHERS.find((w) => w.id === id)?.watch !== false;
/** Whether a run by hand covers watchers the timer runs too */
const touchesWatched = (mode, watcher) => mode !== 'watcher' || onWatch(watcher);

function startScan(mode = 'scan', options = {}, slot = job) {
  if (slot.running) return false;
  if (slot === watchJob && job.running && touchesWatched(job.mode, job.watcher)) return false;
  if (slot === job && watchJob.running && touchesWatched(mode, options.watcher)) return false;
  if (mode === 'watcher' && !WATCHERS.some((w) => w.id === options.watcher)) return false;
  const lastCpu = slot.secondsPerPicture;   // a run that didn't use the NAS's CPU says nothing new about it
  Object.assign(slot, { ...blank(), running: true, mode, watcher: mode === 'watcher' ? options.watcher : null, startedAt: new Date().toISOString(), stopRequested: false });
  const started = inRun(slot, () => scanner.run(mode, options));
  started.then((outcome) => {
    Object.assign(slot, { exitCode: 0, secondsPerPicture: outcome.secondsPerPicture ?? lastCpu });
  }).catch((err) => {
    slot.log.push(`Stopped: ${err.message}`);
    Object.assign(slot, { exitCode: 1, error: err.message, secondsPerPicture: lastCpu });
  }).finally(() => {
    Object.assign(slot, { running: false, finishedAt: new Date().toISOString(), paused: !!slot.stopRequested });
    // The timer's run that waited for this one goes now, a moment later
    if (slot === job && watch.waitingForHand) {
      watch.waitingForHand = false;
      if (watch.on) setTimeout(timerRun, 1000).unref?.();
    }
    for (const fn of listeners) fn();
  });
  return true;
}

/** The timer's run; refused while the run by hand covers the same watchers, it then waits for that one to end */
function timerRun() {
  if (startScan('scan', {}, watchJob)) { watch.waitingForHand = false; return; }
  if (!watchJob.running && job.running) {
    if (!watch.waitingForHand) watchJob.log.push('Timer: waiting for the run started by hand');
    watch.waitingForHand = true;
  }
}

/**
 * Stops a run between two posts: slot 'hand' (the default: the run started by hand) or 'timer'. A profiles run keeps its page
 * in the list, so Run now goes on from there. Returns false when that slot is not running.
 */
function pause(slot = 'hand') {
  const which = slot === 'timer' ? watchJob : job;
  if (!which.running) return false;
  which.stopRequested = true;
  which.log.push(which === job ? 'Pausing: Run now goes on from here' : 'Pausing: the next timer run goes on from here');
  return true;
}

function setWatch(on, minutes, { firstAfterMs = 0 } = {}) {
  clearInterval(watch.timer);
  clearTimeout(watch.first);
  const wasOn = watch.on;
  watch.on = !!on;
  if (minutes) watch.minutes = Math.max(5, Number(minutes));
  watch.timer = null;
  watch.nextAt = null;
  store.setSetting('watch', { on: watch.on, minutes: watch.minutes });
  if (!watch.on) {
    watch.waitingForHand = false;
    // Switched off: the timer's run going now stops too, between two posts
    if (watchJob.running && !watchJob.stopRequested) {
      watchJob.stopRequested = true;
      watchJob.log.push('Timer switched off: stopping');
    }
  }
  if (watch.on) {
    const tick = () => { timerRun(); watch.nextAt = Date.now() + watch.minutes * 60000; };
    watch.timer = setInterval(tick, watch.minutes * 60000);
    watch.timer.unref?.();
    if (firstAfterMs) {
      watch.nextAt = Date.now() + firstAfterMs;
      watch.first = setTimeout(tick, firstAfterMs);
      watch.first.unref?.();
    } else if (wasOn) watch.nextAt = Date.now() + watch.minutes * 60000;   // other minutes: no run for that
    else tick();
  }
}

/** At startup: the timer as it was left. It first runs a minute later, when the app has settled. */
function resume() {
  const saved = store.setting('watch', null);
  if (saved?.on) setWatch(true, saved.minutes, { firstAfterMs: 60000 });
  else if (saved?.minutes) watch.minutes = saved.minutes;
}

const plain = ({ log, stopRequested, ...rest }) => ({ ...rest, log: log.slice(-200) });
const status = () => ({ job: plain(job), watchJob: plain(watchJob), watch: { on: watch.on, minutes: watch.minutes, nextAt: watch.nextAt, waitingForHand: watch.waitingForHand } });

module.exports = { startScan, pause, setWatch, resume, status, onChange: (fn) => listeners.add(fn), slots: { job, watchJob } };
