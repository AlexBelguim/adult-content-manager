/**
 * The one vote queue of the rate pages (the ranker and Smart Compare).
 *
 * Votes go out one at a time, in the order they were made, so an Undo always lands after the vote it reverses.
 * Every entry carries a vote id (a uuid), sent as `voteId` in its body: the server applies a vote once and answers
 * a resend of the same id with the first answer, so sending again is always safe.
 * A send that gets no answer, or a 5xx/408/429, is kept and tried again on its own, after 2 s, 4 s, 8 s … up to
 * 30 s (and at once when the browser comes back online); a 4xx is final ('rejected').
 * Leaving the page (unmount, tab close, reload) sends whatever is still unsent once more with fetch keepalive, the
 * ones in flight too (the vote id makes that safe). An undo pushed with `reverses: vote` whose vote has no answer yet
 * is handled as a pair: a vote never sent is dropped with its undo; else, with `cancelBody(vote)` (a body that names
 * the vote by its id), both go out and the server keeps neither; without it, neither is sent again.
 *
 *   const { queue, counts } = useVoteQueue();
 *   const entry = queue.push({ url, body, kind });   // body: object, or () => object | null (read just before sending)
 *   queue.push({ url, body, kind: 'undo', reverses: entry, cancelBody: (v) => ({ cancelVoteId: v.voteId }) });
 *   queue.whenSettled(entry).then((e) => e.status);  // 'saved' | 'rejected' | 'cancelled' | 'skipped' | 'blind'
 *   queue.cancel(entry)                               // true when it was never sent (it never will be)
 *   <SaveChip counts={counts} onRetry={queue.retry} />
 *   const { leave, leaving } = useSafeLeave({ queue, counts, onLeave });
 *
 * Statuses: pending, sending, saved, failed, rejected, cancelled, skipped (body was null), blind (sent with
 * keepalive, the answer is never read).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { useAsk, plural } from '../ui';

const SETTLED = new Set(['saved', 'rejected', 'cancelled', 'skipped', 'blind']);
const HEADERS = { 'Content-Type': 'application/json' };

let lastId = 0;

/** A 4xx is the server saying no for good; 408 and 429 are worth another try. */
const isFinalRefusal = (status) => status >= 400 && status <= 499 && status !== 408 && status !== 429;

/** A uuid v4. crypto.randomUUID needs a secure context (not plain http on the LAN); getRandomValues does not. */
export function newVoteId() {
  const c = typeof crypto !== 'undefined' ? crypto : null;
  if (c && typeof c.randomUUID === 'function') {
    try { return c.randomUUID(); } catch (_) { /* not a secure context */ }
  }
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i += 1) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The body as sent: the entry's vote id added to it. */
const withVoteId = (entry, body) => ({ ...body, voteId: entry.voteId });

export function createVoteQueue({ retryMs = 2000, maxRetryMs = 30000 } = {}) {
  const open = []; // entries not settled yet (pending, sending, failed), in order
  const bodies = new Map(); // entry.id -> body (object or function)
  const waiters = new Map(); // entry.id -> [resolve]
  const listeners = new Set();
  let timer = null;
  let running = false;
  let stopped = false;
  let failures = 0; // sends in a row without a usable answer: each one doubles the next wait

  const emit = () => {
    for (const fn of [...listeners]) {
      try { fn(); } catch (_) { /* a listener's problem is not the queue's */ }
    }
  };

  const settle = (entry, status) => {
    entry.status = status;
    const i = open.indexOf(entry);
    if (i >= 0) open.splice(i, 1);
    bodies.delete(entry.id);
    const ws = waiters.get(entry.id);
    waiters.delete(entry.id);
    if (ws) for (const resolve of ws) resolve(entry);
  };

  const readBody = (entry) => {
    const b = bodies.get(entry.id);
    if (typeof b !== 'function') return b == null ? null : b;
    try {
      const v = b();
      return v == null ? null : v;
    } catch (_) {
      return null;
    }
  };

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const nextDelay = () => Math.min(maxRetryMs, retryMs * 2 ** Math.max(0, failures - 1));

  const scheduleRetry = () => {
    if (timer || stopped) return;
    timer = setTimeout(() => {
      timer = null;
      retry();
    }, nextDelay());
  };

  const fail = (entry, message) => {
    failures += 1;
    entry.status = 'failed';
    entry.error = message;
    scheduleRetry();
  };

  async function pump() {
    if (running || stopped) return;
    running = true;
    try {
      while (!stopped) {
        const head = open[0];
        if (!head || head.status === 'failed') break; // empty, or halted until the retry
        const b = readBody(head);
        if (b === null) {
          settle(head, 'skipped');
          emit();
          continue;
        }
        head.status = 'sending';
        head.error = null;
        head.tries += 1;
        emit();
        let res;
        let data;
        try {
          res = await fetch(head.url, { method: 'POST', headers: HEADERS, body: JSON.stringify(withVoteId(head, b)) });
          data = await res.json().catch(() => ({}));
        } catch (_) {
          if (!open.includes(head)) break; // settled while in flight: the page is being left
          fail(head, 'No answer from the server');
          emit();
          break;
        }
        if (!open.includes(head)) break; // settled while in flight: the page is being left
        const said = data && typeof data === 'object' && data.error ? String(data.error) : null;
        if (res.ok) {
          failures = 0;
          head.result = data;
          settle(head, 'saved');
          emit();
        } else if (isFinalRefusal(res.status)) {
          failures = 0;
          head.error = said || `The server refused it (${res.status})`;
          settle(head, 'rejected');
          emit();
        } else {
          fail(head, said || `HTTP ${res.status}`);
          emit();
          break;
        }
      }
    } finally {
      running = false;
    }
  }

  function retry() {
    clearTimer();
    let changed = false;
    for (const e of open) {
      if (e.status === 'failed') {
        e.status = 'pending';
        changed = true;
      }
    }
    if (changed) emit();
    pump();
  }

  function push({ url, body, kind, reverses = null, cancelBody = null }) {
    lastId += 1;
    const entry = {
      id: lastId, voteId: newVoteId(), url, kind, reverses, cancelBody,
      status: 'pending', result: null, error: null, tries: 0
    };
    bodies.set(entry.id, body);
    open.push(entry);
    emit();
    pump();
    return entry;
  }

  /**
   * Drops an entry that was never sent (true). One that was sent, even without an answer, can be on the server: it is
   * kept (false) and sent again until it is answered, so an undo queued after it can reverse it.
   */
  function cancel(entry) {
    if (!entry || (entry.status !== 'pending' && entry.status !== 'failed') || entry.tries > 0) return false;
    settle(entry, 'cancelled');
    emit();
    return true;
  }

  function whenSettled(entry) {
    if (!entry || SETTLED.has(entry.status)) return Promise.resolve(entry);
    return new Promise((resolve) => {
      const ws = waiters.get(entry.id) || [];
      ws.push(resolve);
      waiters.set(entry.id, ws);
    });
  }

  function counts() {
    let failed = 0;
    let undos = 0;
    for (const e of open) {
      if (e.status === 'failed') failed += 1;
      if (e.kind === 'undo') undos += 1;
    }
    return { unsent: open.length, failed, undos };
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function drain(timeoutMs) {
    const done = () => open.length === 0;
    const halted = () => open.length > 0 && open[0].status === 'failed';
    if (done()) return Promise.resolve(true);
    if (halted()) return Promise.resolve(false);
    return new Promise((resolve) => {
      let t = null;
      const finish = (ok) => {
        clearTimeout(t);
        unsubscribe();
        resolve(ok);
      };
      const unsubscribe = subscribe(() => {
        if (done()) finish(true);
        else if (halted()) finish(false);
      });
      t = setTimeout(() => finish(false), timeoutMs);
    });
  }

  function flushKeepalive() {
    clearTimer();
    // 'sending' too: its answer may never come once the page is gone, and the same vote id is never counted twice
    const todo = open.filter((e) => e.status === 'pending' || e.status === 'failed' || e.status === 'sending');
    if (todo.length === 0) return;
    const send = (e, b) => {
      try {
        // the same vote id: a vote the server already has is not counted again
        fetch(e.url, { method: 'POST', keepalive: true, headers: HEADERS, body: JSON.stringify(withVoteId(e, b)) }).catch(() => {});
      } catch (_) { /* the page is going away: nothing more to do */ }
      settle(e, 'blind');
    };
    const undoOf = new Map(); // vote entry id -> the undo of it, both unanswered
    for (const e of todo) if (e.reverses && todo.includes(e.reverses)) undoOf.set(e.reverses.id, e);
    for (const e of todo) {
      if (SETTLED.has(e.status)) continue; // settled with its vote above
      const undo = undoOf.get(e.id);
      if (undo) {
        // a vote with no answer, and its undo: the server must end with neither
        const b = readBody(e);
        if (b === null || (e.tries === 0 && e.status === 'pending')) {
          settle(e, b === null ? 'skipped' : 'cancelled'); // never sent
          settle(undo, 'cancelled');
          continue;
        }
        let cb = null;
        try { cb = typeof undo.cancelBody === 'function' ? undo.cancelBody(e) : null; } catch (_) { cb = null; }
        if (cb) {
          send(e, b);
          send(undo, cb);
        } else {
          // no way to name it by id: not sent again (only its first send may have been stored), and the undo cannot go
          settle(e, 'cancelled');
          settle(undo, 'skipped');
        }
        continue;
      }
      const b = readBody(e);
      if (b === null) {
        settle(e, 'skipped');
        continue;
      }
      send(e, b);
    }
    emit();
  }

  function start() {
    stopped = false;
    if (open.length > 0 && open[0].status === 'failed') scheduleRetry();
    pump();
  }

  function stop() {
    stopped = true;
    clearTimer();
  }

  return { push, retry, cancel, whenSettled, counts, subscribe, drain, flushKeepalive, start, stop };
}

/** One queue per mount. Unsent votes are sent once more (keepalive) on unmount and on pagehide. */
export function useVoteQueue(options) {
  const ref = useRef(null);
  if (!ref.current) ref.current = createVoteQueue(options);
  const queue = ref.current;
  const [counts, setCounts] = useState(() => queue.counts());

  useEffect(() => {
    const sync = () => setCounts((prev) => {
      const c = queue.counts();
      return c.unsent === prev.unsent && c.failed === prev.failed && c.undos === prev.undos ? prev : c;
    });
    const unsubscribe = queue.subscribe(sync);
    sync();
    queue.start();
    const flush = () => queue.flushKeepalive();
    const online = () => { if (queue.counts().failed > 0) queue.retry(); };
    window.addEventListener('pagehide', flush);
    window.addEventListener('online', online);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('online', online);
      queue.flushKeepalive();
      queue.stop();
      unsubscribe();
    };
  }, [queue]);

  return { queue, counts };
}

const chipBase = {
  display: 'inline-flex', alignItems: 'center', flex: 'none', height: 22, px: '8px',
  fontFamily: 'inherit', fontSize: 12, fontWeight: 560, lineHeight: 1, whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums', borderRadius: 'var(--radius-lg)', boxSizing: 'border-box'
};

/** Saved / Saving n / n not saved · Retry */
export function SaveChip({ counts, onRetry }) {
  const c = counts || { unsent: 0, failed: 0 };
  if (c.failed > 0) {
    return (
      <Box component="button" type="button" onClick={onRetry} aria-live="polite"
        title="They are tried again on their own. Retry sends them now."
        sx={{
          ...chipBase, cursor: 'pointer', border: '1px solid var(--bad)', color: 'var(--bad)', bgcolor: 'var(--bad-quiet)',
          '&:hover': { color: 'var(--text)' }
        }}>
        {`${c.failed} not saved · Retry`}
      </Box>
    );
  }
  return (
    <Box component="span" aria-live="polite" sx={{ ...chipBase, border: '1px solid var(--line-strong)', color: 'var(--dim)' }}>
      {c.unsent > 0 ? `Saving ${c.unsent}` : 'Saved'}
    </Box>
  );
}

/**
 * Leave without losing votes: with nothing unsent leave at once; else wait up to 4 s for the queue, then ask.
 * `counts` is accepted for symmetry with SaveChip; the live numbers are read from the queue.
 */
export function useSafeLeave({ queue, onLeave }) {
  const ask = useAsk();
  const [leaving, setLeaving] = useState(false);
  const busy = useRef(false);
  const onLeaveRef = useRef(onLeave);
  onLeaveRef.current = onLeave;

  const leave = useCallback(async () => {
    if (busy.current) return;
    if (queue.counts().unsent === 0) {
      onLeaveRef.current();
      return;
    }
    busy.current = true;
    try {
      setLeaving(true);
      const ok = await queue.drain(4000);
      setLeaving(false);
      const c = queue.counts();
      const n = c.unsent;
      if (ok || n === 0) {
        onLeaveRef.current();
        return;
      }
      const undos = c.undos || 0;
      const votes = n - undos;
      let title = `${plural(votes, 'vote')} not saved`;
      if (undos > 0) title = votes > 0 ? `${plural(votes, 'vote')} and ${plural(undos, 'undo')} not saved` : `${plural(undos, 'undo')} not saved`;
      const go = await ask({
        title,
        text: 'The server has not confirmed them. Stay and they keep retrying, or leave and they are sent once more without waiting for an answer.'
          + (undos > 0 ? ' A vote you undid is not counted.' : ''),
        okLabel: 'Leave anyway',
        cancelLabel: 'Stay',
        danger: true
      });
      if (go) {
        queue.flushKeepalive();
        onLeaveRef.current();
      }
    } finally {
      busy.current = false;
      setLeaving(false);
    }
  }, [queue, ask]);

  return { leave, leaving };
}
