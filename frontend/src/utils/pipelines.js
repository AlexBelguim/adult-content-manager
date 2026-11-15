/**
 * Labels (labelmaster's scenes) and funscripts made from them: this app's own jobs, handed to the worker nodes by the
 * coordinator (backend routes/pipelines.js, services/labelQueue.js). The target is any mix of performers, content
 * folders and single videos; steps ['labels'] or ['labels', 'funscript']; runOn: a coordinator node id, or none (the
 * order set in the coordinator). The Jobs page shows the queue.
 */
export async function queuePipeline({ performerIds = [], folders = [], paths = [], steps, skipDone = true, runOn = null }) {
  const res = await fetch('/api/pipelines/queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ performerIds, folders, paths, steps, skipDone, runOn })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Queueing failed');
  const parts = [data.labels && `${data.labels} for labels`, steps.includes('funscript') && `${data.funscript} for funscripts`]
    .filter(Boolean).join(' and ');
  const skipped = data.skipped || 0;
  return `Queued ${parts || 'nothing'} of ${data.videos} video${data.videos === 1 ? '' : 's'}`
    + (skipped > 0 && skipDone ? ` (${skipped} done already)` : '');
}
