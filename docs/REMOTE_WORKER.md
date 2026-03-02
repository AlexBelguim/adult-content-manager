# Remote Encoding Worker - Future Implementation Guide

## Overview
This document describes how to implement a remote encoding worker that connects to the Adult Content Manager backend to process video/image optimization jobs on a GPU-enabled machine.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Server (Pi/Low-Power)                    │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Backend API (Node.js)                              │    │
│  │  Port: 4069                                         │    │
│  │                                                     │    │
│  │  Tables:                                            │    │
│  │  - encode_jobs: Job queue                          │    │
│  │  - encode_settings: Configuration                   │    │
│  │                                                     │    │
│  │  Key Settings:                                      │    │
│  │  - worker_mode: 'local' | 'remote'                 │    │
│  │  - worker_api_key: (future auth)                   │    │
│  └─────────────────────────────────────────────────────┘    │
│                              │                               │
│                              │ File Storage (NFS/SMB mount)  │
└──────────────────────────────┼──────────────────────────────┘
                               │
                   HTTP API    │    File Access
                               ▼
┌─────────────────────────────────────────────────────────────┐
│              Worker App (GPU Machine - RTX 3060)             │
│                                                              │
│  1. Poll GET /api/encode/worker/claim                       │
│  2. Download source file (via mount or API)                 │
│  3. Encode with FFmpeg (NVENC hardware acceleration)        │
│  4. Upload result to POST /api/encode/worker/complete/:id   │
│  5. Repeat                                                   │
└─────────────────────────────────────────────────────────────┘
```

---

## Files to Modify

### 1. Backend: Enable Remote Mode

**File:** `backend/services/encodeService.js`

Add these functions:

```javascript
// Claim next pending job for worker
function claimJob(workerId) {
  const job = db.prepare(`
    SELECT * FROM encode_jobs 
    WHERE status = 'pending' 
    ORDER BY priority DESC, created_at ASC 
    LIMIT 1
  `).get();
  
  if (!job) return null;
  
  db.prepare(`
    UPDATE encode_jobs 
    SET status = 'processing', worker_id = ?, started_at = datetime('now')
    WHERE id = ?
  `).run(workerId, job.id);
  
  return job;
}

// Mark job complete with result
function completeJob(jobId, actualSizeBytes) {
  return db.prepare(`
    UPDATE encode_jobs 
    SET status = 'completed', actual_size_bytes = ?, completed_at = datetime('now')
    WHERE id = ?
  `).run(actualSizeBytes, jobId);
}

// Mark job failed with error
function failJob(jobId, errorMessage) {
  return db.prepare(`
    UPDATE encode_jobs 
    SET status = 'failed', error_message = ?, completed_at = datetime('now')
    WHERE id = ?
  `).run(errorMessage, jobId);
}
```

---

### 2. Backend: Worker API Endpoints

**File:** `backend/routes/encode.js`

Replace the placeholder endpoints:

```javascript
// GET /api/encode/worker/claim
router.get('/worker/claim', (req, res) => {
  const settings = encodeService.getSettings();
  if (settings.worker_mode !== 'remote') {
    return res.status(503).json({ error: 'Remote mode not enabled' });
  }
  
  // TODO: Add authentication via worker_api_key header
  const workerId = req.headers['x-worker-id'] || 'default';
  const job = encodeService.claimJob(workerId);
  
  if (!job) {
    return res.status(204).send(); // No jobs available
  }
  
  res.json(job);
});

// POST /api/encode/worker/complete/:id
router.post('/worker/complete/:id', (req, res) => {
  const settings = encodeService.getSettings();
  if (settings.worker_mode !== 'remote') {
    return res.status(503).json({ error: 'Remote mode not enabled' });
  }
  
  const { id } = req.params;
  const { actualSizeBytes, newPath } = req.body;
  
  // Verify the new file exists
  const fs = require('fs');
  if (newPath && !fs.existsSync(newPath)) {
    return res.status(400).json({ error: 'New file not found at specified path' });
  }
  
  encodeService.completeJob(parseInt(id), actualSizeBytes);
  res.json({ success: true });
});

// POST /api/encode/worker/fail/:id
router.post('/worker/fail/:id', (req, res) => {
  const { id } = req.params;
  const { error } = req.body;
  
  encodeService.failJob(parseInt(id), error);
  res.json({ success: true });
});
```

---

### 3. Settings Required

Enable remote mode via API or database:

```sql
UPDATE encode_settings SET value = 'remote' WHERE key = 'worker_mode';
```

Or via API:
```bash
curl -X PUT http://server:4069/api/encode/settings \
  -H "Content-Type: application/json" \
  -d '{"worker_mode": "remote"}'
```

---

## Worker App Implementation

### Option A: Python Script

```python
#!/usr/bin/env python3
"""Remote Encoding Worker for Adult Content Manager"""

import requests
import subprocess
import os
import time

SERVER_URL = "http://192.168.1.100:4069"
WORKER_ID = "worker-rtx3060"
POLL_INTERVAL = 5  # seconds

def claim_job():
    """Fetch next available job"""
    try:
        resp = requests.get(
            f"{SERVER_URL}/api/encode/worker/claim",
            headers={"X-Worker-Id": WORKER_ID},
            timeout=10
        )
        if resp.status_code == 204:
            return None  # No jobs
        return resp.json()
    except Exception as e:
        print(f"Error claiming job: {e}")
        return None

def encode_video(input_path, output_path):
    """Encode video to H.265 using NVENC"""
    cmd = [
        "ffmpeg", "-y",
        "-hwaccel", "cuda",
        "-i", input_path,
        "-c:v", "hevc_nvenc",
        "-preset", "p4",
        "-crf", "28",
        "-c:a", "copy",
        output_path
    ]
    result = subprocess.run(cmd, capture_output=True)
    return result.returncode == 0

def encode_image(input_path, output_path):
    """Convert image to WebP"""
    cmd = [
        "ffmpeg", "-y",
        "-i", input_path,
        "-quality", "85",
        output_path
    ]
    result = subprocess.run(cmd, capture_output=True)
    return result.returncode == 0

def complete_job(job_id, new_path):
    """Report job completion"""
    new_size = os.path.getsize(new_path)
    requests.post(
        f"{SERVER_URL}/api/encode/worker/complete/{job_id}",
        json={"actualSizeBytes": new_size, "newPath": new_path}
    )

def fail_job(job_id, error):
    """Report job failure"""
    requests.post(
        f"{SERVER_URL}/api/encode/worker/fail/{job_id}",
        json={"error": str(error)}
    )

def main():
    print(f"Worker {WORKER_ID} starting...")
    while True:
        job = claim_job()
        if not job:
            time.sleep(POLL_INTERVAL)
            continue
        
        print(f"Processing job {job['id']}: {job['source_path']}")
        
        try:
            source = job['source_path']
            ext = ".webp" if job['target_format'] == 'webp' else ".mp4"
            output = source.rsplit('.', 1)[0] + f"_optimized{ext}"
            
            if job['target_format'] == 'h265':
                success = encode_video(source, output)
            else:
                success = encode_image(source, output)
            
            if success:
                # Replace original with optimized
                os.replace(output, source.rsplit('.', 1)[0] + ext)
                complete_job(job['id'], source.rsplit('.', 1)[0] + ext)
                print(f"Job {job['id']} completed")
            else:
                fail_job(job['id'], "Encoding failed")
        except Exception as e:
            fail_job(job['id'], str(e))

if __name__ == "__main__":
    main()
```

---

### Option B: Node.js Script

```javascript
// worker.js
const fetch = require('node-fetch');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SERVER_URL = 'http://192.168.1.100:4069';
const WORKER_ID = 'worker-rtx3060';
const POLL_INTERVAL = 5000;

async function claimJob() {
  const resp = await fetch(`${SERVER_URL}/api/encode/worker/claim`, {
    headers: { 'X-Worker-Id': WORKER_ID }
  });
  if (resp.status === 204) return null;
  return resp.json();
}

function encodeVideo(input, output) {
  execSync(`ffmpeg -y -hwaccel cuda -i "${input}" -c:v hevc_nvenc -preset p4 -crf 28 -c:a copy "${output}"`);
}

function encodeImage(input, output) {
  execSync(`ffmpeg -y -i "${input}" -quality 85 "${output}"`);
}

async function main() {
  console.log(`Worker ${WORKER_ID} starting...`);
  
  while (true) {
    const job = await claimJob();
    
    if (!job) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      continue;
    }
    
    console.log(`Processing: ${job.source_path}`);
    // ... encoding logic similar to Python version
  }
}

main();
```

---

## File Access Options

### Option 1: Shared Network Mount (Recommended)
Mount the server's storage on the worker machine via NFS or SMB. Worker directly reads/writes files.

```bash
# On worker machine
sudo mount -t nfs server:/media /mnt/media
```

### Option 2: File Transfer via API
Upload/download files through backend API endpoints:
- `GET /api/files/raw?path=...` - Download source
- `POST /api/encode/worker/upload/:id` - Upload result (not yet implemented)

---

## Database Schema Reference

**encode_jobs table:**
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| performer_id | INTEGER | FK to performers |
| source_path | TEXT | Full path to source file |
| target_format | TEXT | 'h265' or 'webp' |
| status | TEXT | pending/processing/completed/failed |
| worker_id | TEXT | Which worker is processing |
| original_size_bytes | INTEGER | Original file size |
| estimated_size_bytes | INTEGER | Estimated result size |
| actual_size_bytes | INTEGER | Actual result size |
| created_at | TEXT | When job was created |
| started_at | TEXT | When processing started |
| completed_at | TEXT | When completed |
| error_message | TEXT | Error details if failed |

**encode_settings table:**
| Key | Default | Description |
|-----|---------|-------------|
| worker_mode | local | 'local' or 'remote' |
| video_codec | h265 | Target video codec |
| video_crf | 28 | Quality (lower = better) |
| video_preset | medium | Speed vs quality |
| video_hw_accel | auto | Hardware acceleration |
| image_format | webp | Target image format |
| image_quality | 85 | WebP quality (1-100) |
| keep_originals | true | Backup originals |
| backup_folder | .originals | Backup location |

---

## Future Enhancements

1. **Worker Authentication** - Add `worker_api_key` setting and verify in headers
2. **Progress Reporting** - WebSocket for real-time encoding progress
3. **Multiple Workers** - Load balancing across multiple GPU machines
4. **Priority Queue** - Different priority levels for jobs
5. **Auto-scaling** - Spin up cloud GPU instances when queue is large
