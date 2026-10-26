/**
 * Labels (labelmaster's scenes) and funscripts, run by scenetest on the GPU PC (backend routes/pipelines.js).
 * The target is any mix of performers, content folders and single videos; the Jobs page shows the queue.
 */
export async function queuePipeline({ performerIds = [], folders = [], paths = [], steps, skipDone = true }) {
  const res = await fetch('/api/pipelines/queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ performerIds, folders, paths, steps, skipDone })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Queueing failed');
  const parts = [steps.includes('labels') && `${data.labels} for labels`, steps.includes('funscript') && `${data.funscript} for funscripts`]
    .filter(Boolean).join(' and ');
  const skipped = data.videos - Math.max(steps.includes('labels') ? data.labels : 0, steps.includes('funscript') ? data.funscript : 0);
  return `Queued ${parts || 'nothing'} of ${data.videos} video${data.videos === 1 ? '' : 's'}`
    + (skipped > 0 && skipDone ? ' (the rest were done already)' : '')
    + (data.missing ? `; ${data.missing} not found on the GPU PC` : '');
}
