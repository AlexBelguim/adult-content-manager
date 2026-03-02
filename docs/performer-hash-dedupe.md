# Performer Hash Deduplication — Feature Spec & TODO

Status: draft  
Owner: (assign)  
Goal: Add an optional, minimally-invasive per-performer hash database and UI actions so users can create a performer hash DB, run cross-performer duplicate checks (exact + perceptual), preview results with adjustable similarity (Hamming) threshold, and safely remove or quarantine duplicates.

---

## Summary / Motivation
Provide a modular deduplication tool that:
- Stores file hashes per performer (exact + perceptual).
- Lets users create a performer-specific hash DB snapshot on demand.
- Lets users run comparisons of one performer’s files against another performer's DB.
- Persists comparison runs (temporary) so the user can interactively adjust similarity thresholds (Hamming distance) and preview changes before committing delete/quarantine.
- Keeps the integration surface minimal (new DB and a few API endpoints + UI buttons) so existing scanning/import code remains mostly untouched.

---

## Non-Goals
- Automatic global dedupe on import (out of scope for initial feature).
- Full integration into fileScanner chokidar watchers (optional future enhancement).
- Forced deletion without user confirmation / quarantine.

---

## High-level UX flows

1. Create Hash DB (per performer)
   - Location: "Before filter folder" and "After filter folder" settings modal (button).
   - Action: user creates an performer with name and or alliases(by canonical performer id) and presses "Create Hash DB".  
   - Result: Backend creates/updates a per-performer hash DB (or a shared DB row set) containing exact and perceptual hashes for every file currently associated with that performer. UI shows progress and completion.

2. Check Hash (compare performer A vs performer B)
   - Location: same settings modal (button).
   - Action:
     - User triggers "Check Hash" for performer A.
     - Prompt: choose target performer DB to compare against (performer B).
     - Backend computes comparisons and returns a run result id + preview dataset (file list, matched candidate(s), exact match flag, perceptual hamming distances).
   - Result: UI displays a preview list with thumbnails, similarity percentage, and allows:
     - Adjusting Hamming threshold slider (client-side filter — no re-hash required).
     - Toggling items to include/exclude from final action.
     - Dry-run mode to see counts.
     - Commit action: Move to Quarantine or Delete (require explicit confirmation).

3. Post-commit
   - Files removed are either flagged (deleted_flag) or moved to configurable quarantine folder.
   - DB rows remain (deleted_flag set) so later imports still dedupe.

4. Run persistence & editability
   - Comparison run results are saved temporarily with run_id.
   - User can change threshold later and re-open the run to filter results without recomputing hashes.
   - Runs expire after configurable TTL (e.g., 7 days) but can be exported.

---

## Data Model (recommended)

Option A — Single SQLite DB (recommended)
- Table: performer_file_hashes
  - id INTEGER PK
  - performer_id INTEGER (canonical performer id)
  - file_path TEXT (original path seen)
  - size INTEGER
  - mtime INTEGER
  - exact_hash TEXT (SHA-256 or BLAKE3)
  - perceptual_hash BLOB / INTEGER (e.g., 64-bit pHash)
  - deleted_flag INTEGER DEFAULT 0
  - seen_at INTEGER

- Table: hash_runs
  - run_id TEXT PK
  - source_performer_id INTEGER
  - target_performer_id INTEGER
  - created_at INTEGER
  - status TEXT (pending/complete/expired)
  - metadata JSON (settings used)

- Table: hash_run_items
  - id INTEGER PK
  - run_id TEXT
  - file_path TEXT
  - file_id_ref INTEGER (nullable)
  - candidate_id INTEGER (matched hash id)
  - exact_match INTEGER (0/1)
  - hamming_distance INTEGER (for perceptual)
  - selected INTEGER (0/1)  -- user selection flag
  - note TEXT
---

## Hashing strategy
- Store two hashes:
  - exact_hash: SHA-256 or BLAKE3 (for exact byte-equal matches).
  - perceptual_hash: 64-bit pHash / dHash (for visual similarity).
- Videos: just save length and size as accurate as possible of each video and compare length when comparing just make the user aware this video length/size has already beens seen and make sure the user can view the videos before choosing to delete  
- Compute perceptual hashes once when creating DB; do not recompute while users adjust thresholds.

---

## Comparison algorithm (overview)
- For each file in source performer:
  - Check exact_hash against target performer's exact_hash (fast).
  - If exact match found -> mark exact duplicate.
  - Else compute/lookup perceptual_hash Hamming distance(s).
  - Record nearest candidate(s) with distances.
- Persist results in hash_run_items to allow threshold-based filtering in UI.

---

## API endpoints (suggested)
- POST /api/hashes/create
  - body: { performer_id, basePath? }
  - returns: { jobId, estimatedCount }

- GET /api/hashes/status/:jobId
  - returns progress

- POST /api/hashes/check
  - body: { source_performer_id, target_performer_id, runId? }
  - returns: { runId }

- GET /api/hashes/run/:runId
  - returns results (paginated) including filenames, thumbnails, exactMatch, hammingDistance, candidate references

- POST /api/hashes/run/:runId/commit
  - body: { action: "delete" | "quarantine", selectedItems: [id,...] }
  - returns: operation status and undo token (if quarantine)

- GET /api/hashes/run/:runId/export
  - export run JSON

- Admin: DELETE /api/hashes/run/:runId (expire)

All API routes follow existing error patterns: try/catch and standard JSON error responses.

---

## UI changes
- Settings modal(s) (Before / After view):
  - Add button: "Create Hash DB" — shows modal with performer selector, options (include videos? frames per video?), start button, progress bar.
  - Add button: "Check Hash" — opens run modal: choose target performer (dropdown of performer ids), options (similarity slider default, dry-run), Start Check.
- Run modal:
  - Shows progress, then preview grid with thumbnails, similarity %, exact-match badge.
  - Slider to adjust Hamming threshold (client filters persisted distances).
  - Bulk-select / deselect, per-item preview and manual override.
  - Actions: Move to Quarantine (recommended default), Permanently Delete (warning + require typed confirmation).
  - Undo / restore for quarantine with TTL.

---

## Safety & UX rules
- Default to Move to Quarantine, not permanent delete.
- Require explicit confirmation for permanent deletes (typed confirmation: "DELETE").
- Provide dry-run preview by default.
- Show exact vs perceptual match reason so user can trust automated recommendations.
- Keep an operation log and optional export for auditing.
- Use canonical performer_id to avoid name-mismatch problems.

---

## Performance & throttling
- Hashing is I/O bound for large files:
  - Limit hashing concurrency (configurable workers, default 4).
  - Batch operations and provide an estimated time/ETA.
  - Allow background jobs and resume on restart.
- Prefilter candidates by file size (fast equality) before full perceptual comparisons.
- For large performer DBs, use prefix bucketing or index on perceptual hash prefix to avoid full O(N) comparisons when possible.

---

## Configuration options (admin)
- Hash algorithm: exact = sha256 | blake3, perceptual = phash | dhash
- Perceptual hash bits: 64 (default)
- Video frame strategy: middle / keyframes / n frames
- Worker concurrency: default 4
- Run TTL: default 7 days
- Quarantine path and retention period
- Default Hamming threshold (% or bits)

---

## Tests & QA
- Unit tests for:
  - Exact-hash match behaviour
  - Perceptual-hash Hamming distance calculations and percent conversion
  - Run persistence and filtering (no re-hash on threshold change)
- Integration tests:
  - Create DB -> create second DB -> cross-check -> dry-run preview -> quarantine -> restore
  - Video frame hashing end-to-end (small sample video set)
- Edge-case tests:
  - Very small images (thumbnails), heavily cropped/edited images, identical scene different images
  - Race conditions when hash DB updated concurrently

---

## Implementation TODO (prioritized)
1. Data model
   - Add `performer_file_hashes`, `hash_runs`, `hash_run_items` to DB schema.
2. Hashing service
   - Implement exact and perceptual hash creation (images + video frames).
   - Worker queue with concurrency limit.
3. API endpoints
   - Create endpoints for create, status, check, run results, commit, export.
4. Settings modal UI
   - Add "Create Hash DB" and "Check Hash" buttons and modals.
   - Implement run modal with preview grid, similarity slider, selection, and commit actions.
5. Comparison pipeline
   - Implement run creation, candidate matching, result persistence.
6. Quarantine / commit actions
   - Implement safe move to quarantine and optional permanent delete with confirmation.
   - Implement undo for quarantine within retention window.
7. Background/long-running job handling
   - Persist job state and resume after server restart.
8. Tests & docs
   - Add unit/integration tests.
   - Add user documentation and admin config notes.
9. Monitoring & telemetry
   - Add basic logging, progress endpoints, and operation audit log.

---

## Migration & Backwards Compatibility
- Migration script to add new tables to the existing SQLite schema.
- Feature must be optional; default behavior unchanged until user uses UI actions.

---

## Open questions / decisions
- Default perceptual algorithm (pHash recommended).
- How many representative frames per video for perceptual hashing (1 vs 3).
- Retention policy for run results and quarantine.

---

## Notes
- Keep UX conservative: dry-run, preview, quarantine, and undo minimize accidental data loss.
- Perceptual hashing enables similarity-based dedupe; pair with exact hashes for safety.
- Persisting run distances enables interactive threshold tuning without recompute.

---

End of spec.