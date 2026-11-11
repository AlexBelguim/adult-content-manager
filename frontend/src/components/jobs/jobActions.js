/**
 * What a job's buttons do. The server decides which of the six slots are on (job.actions); this file only carries
 * them out: ask first when the slot has a question, POST /api/jobs/act, say what happened, refresh the list.
 *
 *   runSlot(job, key, { ask, notify, uploads, refresh, navigate })   key: pause | front | retry | cancel | remove | open
 *   bulkClear(kind, { notify, refresh })    POST /api/jobs/clear-finished
 *   bulkRetry(kind, { notify, refresh })    POST /api/jobs/retry-failed
 *
 * Browser uploads (job.local) are not the server's yet: they go to UploadsProvider, which asks its own questions.
 */
import { errorText, plural } from '../ui';

export const SLOT_KEYS = ['pause', 'front', 'retry', 'cancel', 'remove', 'open'];

async function send(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false || data.success === false) {
    throw Object.assign(new Error(data.error || `The server answered ${res.status}`), { status: res.status, code: data.code });
  }
  return data;
}
export const post = (url, body) => send('POST', url, body || {});

const DONE_TEXT = {
  retry: (t) => `Queued again: ${t}`,
  cancel: (t) => `Stopping ${t}`,
  remove: (t) => `Removed ${t}`,
  pause: (t) => `Paused ${t}`,
  resume: (t) => `Resumed ${t}`,
  front: (t) => `${t} runs next`
};

/** A server import upload whose browser row failed: the provider's own Cancel asks and deletes it. */
function failedUploadRow(job, uploads) {
  const raw = job.raw || {};
  const leftOver = !!(raw.report && raw.report.leftIn && raw.report.failed);
  if (raw.kind !== 'upload' || (raw.status === 'completed' && !leftOver)) return null;
  const row = (uploads?.uploads || []).find(u => u.jobId !== null && u.jobId !== undefined && String(u.jobId) === String(job.sourceId));
  return row && row.status === 'failed' ? row : null;
}

/**
 * Carry out one slot of a job. Resolves when it is done (or was declined); errors are shown as a toast.
 * Always refreshes the list at the end.
 */
export async function runSlot(job, key, { ask, notify, uploads, refresh, navigate } = {}) {
  const slot = job?.actions?.[key];
  if (!slot || !slot.on) return;
  if (key === 'open') {
    if (slot.to && navigate) navigate(slot.to);
    return;
  }
  const action = key === 'pause' ? (slot.act || 'pause') : key;
  try {
    if (job.local) {
      if (key === 'retry') await uploads.retryUpload(job.sourceId);
      else if (key === 'cancel' || key === 'remove') await uploads.cancelUpload(job.sourceId);
      return;
    }

    if (job.type === 'import' && key === 'remove') {
      const row = failedUploadRow(job, uploads);
      if (row) {
        await uploads.cancelUpload(row.id);
        return;
      }
    }

    if (slot.ask) {
      const ok = await ask({ ...slot.ask, danger: true, cancelLabel: 'Keep it' });
      if (!ok) return;
    }

    const data = await post('/api/jobs/act', { id: job.id, action });

    if (job.type === 'import' && key === 'retry' && uploads?.watchJobs) {
      // Watched again: the Import page row follows it, and a toast says when it ends.
      uploads.watchJobs([{ jobId: job.sourceId, title: job.title }]);
    }

    const message = (DONE_TEXT[action] || DONE_TEXT[key])(job.title);
    const undo = data && data.undo;
    notify(undo && undo.url ? {
      message,
      action: {
        label: 'Undo',
        onClick: async () => {
          try {
            await send(undo.method || 'POST', undo.url, undo.body);
            notify(`Back in the queue: ${job.title}`);
          } catch (err) {
            notify({ severity: 'error', message: errorText(err) });
          } finally {
            refresh && refresh();
          }
        }
      }
    } : message);
  } catch (err) {
    notify({ severity: 'error', message: errorText(err) });
  } finally {
    if (refresh) await Promise.resolve(refresh()).catch(() => {});
  }
}

const scope = (kind) => (kind && kind !== 'all' ? { kind } : {});

/** Clear every finished row (of one kind, or all). Failed rows stay. */
export async function bulkClear(kind, { notify, refresh } = {}) {
  try {
    const data = await post('/api/jobs/clear-finished', scope(kind));
    const cleared = Number(data.cleared) || 0;
    const errors = Array.isArray(data.errors) ? data.errors : [];
    const done = `Cleared ${plural(cleared, 'finished job')}`;
    if (errors.length) {
      const e = errors[0];
      notify({ severity: 'warning', message: `${done}. Not cleared: ${e.kind ? `${e.kind}: ` : ''}${e.error}` });
    } else {
      notify(done);
    }
  } catch (err) {
    notify({ severity: 'error', message: errorText(err) });
  } finally {
    if (refresh) await Promise.resolve(refresh()).catch(() => {});
  }
}

/** Retry every failed row (of one kind, or all) whose Retry is on. */
export async function bulkRetry(kind, { notify, refresh } = {}) {
  try {
    const data = await post('/api/jobs/retry-failed', scope(kind));
    const retried = Number(data.retried) || 0;
    const errors = Array.isArray(data.errors) ? data.errors : [];
    const done = `Queued ${plural(retried, 'failed job')} again`;
    if (errors.length) {
      const e = errors[0];
      notify({ severity: 'warning', message: `${done}. ${e.title ? `${e.title}: ` : ''}${e.error}${errors.length > 1 ? ` (and ${errors.length - 1} more)` : ''}` });
    } else {
      notify(done);
    }
  } catch (err) {
    notify({ severity: 'error', message: errorText(err) });
  } finally {
    if (refresh) await Promise.resolve(refresh()).catch(() => {});
  }
}
