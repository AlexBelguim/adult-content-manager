// Queue processing utilities for hash and CLIP creation

export const startHashCreation = async (job, basePath, setHashQueue, currentJobRef, pollJobStatus) => {
  try {
    if (!basePath) {
      throw new Error('Base path is not configured. Please set it in settings.');
    }

    setHashQueue(prev => prev.map(j => 
      j.id === job.id ? { ...j, status: 'processing', processed: 0 } : j
    ));

    currentJobRef.current = job.id;

    const response = await fetch('/api/hashes/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        basePath: basePath,
        performer_id: job.performerId,
        mode: job.mode || 'append',
      }),
    });

    const data = await response.json();

    if (data.success && data.jobId) {
      // Store backend jobId in the queue item for resuming
      setHashQueue(prev => prev.map(j => 
        j.id === job.id ? { ...j, backendJobId: data.jobId } : j
      ));
      pollJobStatus(job.id, data.jobId);
    } else {
      throw new Error(data.error || 'Failed to start hash creation');
    }
  } catch (err) {
    console.error('Error starting hash creation:', err);
    setHashQueue(prev => prev.map(j =>
      j.id === job.id ? { ...j, status: 'error', error: err.message } : j
    ));
    currentJobRef.current = null;
  }
};

export const pollHashJobStatus = (queueJobId, backendJobId, setHashQueue, currentJobRef, pollingIntervalRef, onComplete) => {
  if (pollingIntervalRef.current) {
    clearInterval(pollingIntervalRef.current);
  }

  pollingIntervalRef.current = setInterval(async () => {
    try {
      const response = await fetch(`/api/hashes/status/${backendJobId}`);
      const data = await response.json();

      if (data.success) {
        const status = data.status;

        setHashQueue(prev => prev.map(j =>
          j.id === queueJobId
            ? {
                ...j,
                processed: status.processed || 0,
                total: status.total || 0,
                progress: status.total ? (status.processed / status.total) * 100 : 0,
              }
            : j
        ));

        if (status.status === 'completed') {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;

          setHashQueue(prev => prev.map(j =>
            j.id === queueJobId
              ? { ...j, status: 'completed', processed: status.processed }
              : j
          ));

          currentJobRef.current = null;
          if (onComplete) onComplete();
        } else if (status.status === 'failed' || status.error) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;

          setHashQueue(prev => prev.map(j =>
            j.id === queueJobId
              ? { ...j, status: 'error', error: status.error || 'Job failed' }
              : j
          ));

          currentJobRef.current = null;
        }
      }
    } catch (err) {
      console.error('Error polling hash job status:', err);
    }
  }, 1000);
};

export const startClipCreation = async (job, basePath, setClipQueue, currentClipJobRef, pollClipJobStatus) => {
  try {
    if (!basePath) {
      throw new Error('Base path is not configured.');
    }

    setClipQueue(prev => prev.map(j => 
      j.id === job.id ? { ...j, status: 'processing', processed: 0 } : j
    ));

    currentClipJobRef.current = job.id;

    const response = await fetch('/api/clip/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        basePath: basePath,
        performer_id: job.performerId,
        mode: job.mode || 'append',
      }),
    });

    const data = await response.json();

    if (data.success && data.jobId) {
      // Store backend jobId in the queue item for resuming
      setClipQueue(prev => prev.map(j => 
        j.id === job.id ? { ...j, backendJobId: data.jobId } : j
      ));
      pollClipJobStatus(job.id, data.jobId);
    } else {
      throw new Error(data.error || 'Failed to start CLIP creation');
    }
  } catch (err) {
    console.error('Error starting CLIP creation:', err);
    setClipQueue(prev => prev.map(j =>
      j.id === job.id ? { ...j, status: 'error', error: err.message } : j
    ));
    currentClipJobRef.current = null;
  }
};

export const pollClipJobStatus = (queueJobId, backendJobId, setClipQueue, currentClipJobRef, pollingClipIntervalRef, onComplete) => {
  if (pollingClipIntervalRef.current) {
    clearInterval(pollingClipIntervalRef.current);
  }

  pollingClipIntervalRef.current = setInterval(async () => {
    try {
      const response = await fetch(`/api/clip/status/${backendJobId}`);
      const data = await response.json();

      if (data.success) {
        const status = data.status;

        setClipQueue(prev => prev.map(j =>
          j.id === queueJobId
            ? {
                ...j,
                processed: status.processed || 0,
                total: status.total || 0,
                progress: status.total ? (status.processed / status.total) * 100 : 0,
              }
            : j
        ));

        if (status.status === 'completed') {
          clearInterval(pollingClipIntervalRef.current);
          pollingClipIntervalRef.current = null;

          setClipQueue(prev => prev.map(j =>
            j.id === queueJobId
              ? { ...j, status: 'completed', processed: status.processed }
              : j
          ));

          currentClipJobRef.current = null;
          if (onComplete) onComplete();
        } else if (status.status === 'failed' || status.error) {
          clearInterval(pollingClipIntervalRef.current);
          pollingClipIntervalRef.current = null;

          setClipQueue(prev => prev.map(j=>
            j.id === queueJobId
              ? { ...j, status: 'error', error: status.error || 'Job failed' }
              : j
          ));

          currentClipJobRef.current = null;
        }
      }
    } catch (err) {
      console.error('Error polling CLIP job status:', err);
    }
  }, 1000);
};
