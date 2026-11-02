# Discover

The keep scanner, inside the app. Its watchers read sites, the P model judges the pictures, and the performers worth adding show on
the Discover page (`/discover`). The code is in `backend/services/discover/` and `backend/services/sites/`, the routes in
`backend/routes/discovery.js`, the page in `frontend/src/pages/DiscoverPage.js`.

## Who judges

The scan runs in the app on the NAS. P needs CLIP, so each post's pictures go to, in this order:

1. **acm-gpu**, where the coordinator says it is, at `POST /performer_keep`. It takes a host agent grant and answers on the PC's CPU
   when the card is taken.
2. **p-cpu**, the service in this repo's compose file, on the NAS's CPU. It holds no model: P's numbers come with each request, from
   `GET /performer_keep/weights`, saved every time acm-gpu answers (`data/discover/p_weights.json`). With the PC off it judges with
   the P the PC last had. It loads torch and CLIP only while it judges and leaves memory after five idle minutes.
3. **Nobody**: the post is saved as waiting, with its pictures. A later run judges it. A scan never stops for this.

The page's strip says how many wait, and how many seconds a picture the NAS's CPU took in its last run.

## What each button does

- **Keep**, **Delete**, **Super wrong**: on the profile page, and P's training, with source `discover` in Discover's current round.
  A performer the profile page or the library already has is merged and set undecided there, under its "From Discover" sort.
- **Checked**: clears a kept performer from Kept. Found again, they come back with a green Update; a deleted one with a red Update.
- **Remove**: off Discover, nothing else. No verdict, no profile page, no training. Found again, they come back marked "Found again".
- **Add performer**: a library performer with no files, a folder and their Leakhaven link, so the update checks follow them.
- **Upload**: **Send** puts the pictures on the profile page as undecided, under "Uploaded". **Remove** deletes them and sends nothing.

## The first deploy

1. Merge `claude/discover-page` here and `claude/performer-keep-endpoint` in acm-gpu. Get acm-gpu running that code (publish it to
   the coordinator, or restart it from the merged checkout on the PC).
2. On the NAS: `git pull`, then `docker compose up -d --build`. This adds `flaresolverr` and `p-cpu`. The first picture p-cpu
   judges downloads CLIP (1.7 GB) into `data/p-cpu`.
3. Stop the old scanner. Copy its `out/results.db` (with `-wal` and `-shm`) and its `cache/` folder to
   `Z:\Apps\adultManager\data\discover-import\`, then carry them over; `--dry-run` first shows the counts and writes nothing:

       docker exec adult-content-manager node backend/scripts/import-keep-scanner.js /app/data/discover-import --dry-run
       docker exec adult-content-manager node backend/scripts/import-keep-scanner.js /app/data/discover-import

   Running it twice changes nothing. Delete `data/discover-import` afterwards.
4. With the PC on, run Scan now once, so P's numbers are saved for the days it's off.
5. Switch on **Watch every N min**. The timer is off until then, and stays on across a restart.

## Reading the NAS's speed

Fapello is the only site that needs FlareSolverr, and its page reads take about 5 s each. Whether the NAS's CPU keeps up shows on the
strip after a run with the PC off: "NAS CPU: x.x s a picture". A timer run judges a few dozen pictures, so a few seconds each is fine.
A pass over every Leakhaven model is about 5,500 pictures and only runs by hand: leave that one for when the PC is on.
