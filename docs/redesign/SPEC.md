# UI redesign — build spec (Sept 2026)

Approved interactive mocks live in the repo root (index: `mockups.html`). They are the visual and
behavioural reference. **Read the mock for your screen before writing code**, including its
"Kept / New / things I found" notes at the bottom — every "Kept" item must survive.

| Screen | Mock | Approved direction |
|---|---|---|
| Gallery | `gallery-redesign-mockups.html` | **C** — masonry + filter drawer |
| Player page | `player-redesign-mockups.html` | **3** — three columns |
| Filter view | `filter-redesign-mockup.html` | the only one |
| Jobs | `jobs-redesign-mockup.html` | the only one |
| Ranking | `ranking-redesign-mockups.html` | both screens |

## House rules

- React 18 + CRA + MUI 5. Match the file you are editing (MUI `sx` where the file uses it).
  New components may use MUI `Box`/`sx` or a co-located `.css` file — either is fine.
- **Colours come from tokens only**: `var(--bg) --surface --raised --overlay --text --dim --muted
  --faint --line --line-strong --scrim --scrim-strong --accent --accent-hover --accent-quiet
  --on-accent --ok --ok-quiet --warn --warn-quiet --bad --bad-quiet --info --info-quiet
  --radius --radius-sm --radius-lg --shadow-sm/md/lg`. See `frontend/src/styles/tokens.js`.
  Do not invent literals. One accent only; status colours are the desaturated ones.
- **Buttons that act on the current item never move, never hide, never reorder.** Unavailable
  actions are `disabled`, not removed. Control bars do not auto-hide.
- No default (white) scrollbars: global styling exists in `styles/components.css`; scrolling
  containers must not override it with light colours.
- Must work at phone width (no horizontal page scroll) and in phone landscape where the mock shows it.
- Keep every existing feature and API call. Do not change backend request/response shapes that
  other screens use; add fields, never rename.
- Do NOT edit `frontend/src/App.js` or `frontend/src/components/Toolbar.js` — routes and toolbar
  links are wired centrally afterwards. Export your page as default and say in your final report
  which route + props it needs.
- Do not start dev servers, do not commit. Verify with
  `cd frontend && npx eslint <your files>` (CRA config) and fix what it reports.
- No `console.log` noise in new code. No dead code "for later".

## Player navigation contract  (`frontend/src/utils/playerContext.js`)

The player is a real route: `/player?ctx=<id>&i=<index>`; chrome-free (no app toolbar).

```js
// A list the player walks through. Stored in sessionStorage under `playerCtx:<id>`.
{
  title: 'shawawaww',                 // shown small above the file name
  backUrl: '/unified-gallery?performer=…&basePath=…',   // where Back / Esc goes
  items: [ MediaItem, … ]             // already filtered + sorted by the opener
}
// MediaItem — superset of what the gallery endpoints return
{ path, name, type: 'image' | 'video' | 'funscript_video',
  url, thumbnail,                     // as built in UnifiedGallery.fetchAllContent
  size, sizeFormatted, modified, duration, width, height,
  videoRating, funscriptRating, funscriptCount, tags }
```

Exports: `savePlayerContext(ctx) -> id`, `loadPlayerContext(id) -> ctx | null`,
`playerUrl(id, index) -> string`. `/player?path=<file>` with no ctx must still work (single item,
type inferred from extension, Back = history.back()).

## Shared player components  (`frontend/src/components/player/`)

- `MediaStage` — the media box + control bar + optional action bar. **One root element that goes
  fullscreen as a whole**, so whatever is in `actionBar` stays usable in fullscreen.
  Props: `item`, `scenes`, `videoRef` (forwarded to the `<video>`), `autoPlay`, `muted`, `loop`,
  `onLoopChange`, `onEnded`, `overlay` (node rendered over the media — nav buttons, swipe stamps),
  `actionBar` (node under the control bar), `barStart` (node at the left of the control row, e.g.
  prev/next), `counterText`, `onMediaPointer*` hooks are NOT needed — instead expose
  `stageProps` so a parent can attach pointer handlers to the media area.
  Behaviour (from the mock + today's modal): click video = play/pause; wheel over media = seek,
  scroll up = forward, step scaled by duration; seek bar click/drag; scene segments drawn on the
  seek bar, click = jump; time; mute + volume slider; speed; loop; fullscreen; blurred thumbnail
  backdrop; `<img>` for images with the thumbnail as instant placeholder.
- Panels, each self-contained and calling today's endpoints (see `utils/FunscriptPlayer.js` and
  `utils/tagModal.js` for the exact calls and events):
  `RatingPanel` (half-star video + funscript score, `POST /api/ratings`, dispatches
  `ratings-updated`; Delete video & scripts with its two confirms → `gallery-content-updated`),
  `TagPanel` (filter box, toggle, assigned first, genre-from-path tag disabled; dispatches
  `tag-modal-closed` when tags changed and the panel unmounts/ item changes),
  `FunscriptPanel` (list, Upload to Handy via `handyIntegration.uploadAndSetScript`, Delete with a
  confirm, upload state idle/uploading/success/failed; play/pause sync → `/api/handy/play|pause`;
  scene-aware auto-load stays),
  `ScenesPanel` (list, click = jump, "Open Scene Manager" → same `window.open('/scene-manager?…')`),
  `FileInfoPanel`.
- `useScenes(path)` → scenes from `GET /api/scenes/video?path=`, refreshes on `scenesUpdated`.
- `usePlayerKeys({...})` — Space, ←/→ ±5 s for video (prev/next for images), N/P and Shift+arrows
  next/prev, F, M, L, Esc. Ignores keypresses in inputs.

## Media dimensions

Gallery endpoints gain `width` / `height` (and `duration` for videos) per file, cached in
`performer_file_cache`. Frontend falls back to 3:4 (pics) / 9:16 (videos) when missing and corrects
from `naturalWidth` on load — it must never crash or stall without them.
