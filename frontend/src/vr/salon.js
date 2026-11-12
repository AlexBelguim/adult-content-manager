// The VR screen ("Salon"). No rooms: the library is one band of three rows of framed portraits that wraps around you;
// grab it and pull it sideways (or use the stick). A floating control panel you can grab and put anywhere. All content
// (and the panel) lives in one group, the stage, placed from the head pose at recentre; the player never moves.
//
// Views (panel, View row):
//   Performers  the gallery's performers. Trigger on her = her gallery (her pictures and videos in the band);
//               trigger on a picture = the plain viewer (one big, ‹ Close ›, stick prev / next, B or Y close).
//               A video in the viewer plays on the viewer plane (play / pause, scrub bar, sound).
//   Filter      the performers still to filter, each with "N to decide". Trigger on her = triage of her files still
//               to decide (one big): A keep, B delete, X undo, or grip and throw up (keep) / down (delete). These are
//               REAL decisions (POST /api/filter/action, /api/filter/undo, as the app's Filter page sends them).
//   Genres      the library's content genres; trigger on one = its pictures and videos in the band + the viewer.
// Settings kept in localStorage: the shape (Dome / Cylinder) and where the panel was put.
// Recentre: right stick press, both grips held 0.6 s, or the panel's Recentre button (a short countdown).
//
// Flags for screenshots (read once at start, only outside XR; never decide anything):
//   ?look=1                   start in look-around mode (VRPage)          ?yaw=<deg> ?pitch=<deg>  the flat camera
//   ?view=performers|filter|genres   the library view                     ?fov=<horizontal deg>  a wider flat camera
//   ?open=N                   open the Nth library piece (gallery; triage in the Filter view; a genre's pictures)
//   ?show=all|pics|vids       her gallery's Show row (triage: pics / vids = the type)
//   ?viewer=N                 her gallery: item N in the viewer (a video plays)
//   ?focus=N                  triage: file N in focus                     ?hover=N  piece N hovered
//   ?at=N  the band starts at item N   ?shape=dome|cylinder   ?panel=front|moved   ?test=1  window.__vrSalon
// Shot list (F:/acm-sandbox/shots/vr-app/, flat mode, headless Chrome):
//   landing.png (the VR page)            library.png      ?look=1&pitch=0
//   filter.png       ?look=1&view=filter                   genres.png  ?look=1&view=genres
//   gallery.png      ?look=1&open=1                        viewer-picture.png  ?look=1&open=1&viewer=3
//   viewer-video.png ?look=1&open=1&show=vids&viewer=1     triage.png  ?look=1&view=filter&open=1&focus=2
//   triage-videos.png ?look=1&view=filter&open=1&show=vids  hover.png ?look=1&hover=5   cylinder.png ?look=1&shape=cylinder
//   genre-open.png   ?look=1&view=genres&open=1           (all with &pitch=0&test=1; flow-*.png: clicks and keys, no decisions)
import * as THREE from 'three';
import { C, refreshColors } from './palette';
import { DEG, clamp, plural, easeInOut, loadFonts, canvasPlane, text, disposeTree } from './kit';
import { createRuntime } from './runtime';
import { createAssets } from './assets';
import { createTextures } from './textures';
import { createVideoPlayer } from './video';
import { api, pool } from './data';
import { Band } from './band';
import { FocusView } from './focus';
import { createPanel } from './panel';

const STORE_KEY = 'vr.salon';
function loadSettings() { try { return JSON.parse(window.localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; } }
function saveSettings(patch) { try { window.localStorage.setItem(STORE_KEY, JSON.stringify({ ...loadSettings(), ...patch })); } catch { /* storage blocked */ } }

/** the screenshot flags from a query string (see the top of this file) */
export function parseFlags(search) {
  const q = new URLSearchParams(search || '');
  const num = (k) => (q.has(k) && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : null);
  const pick = (k, list) => (list.includes(q.get(k)) ? q.get(k) : null);
  return {
    look: q.get('look') === '1',
    view: pick('view', ['performers', 'filter', 'genres']),
    show: pick('show', ['all', 'pics', 'vids']),
    shape: pick('shape', ['dome', 'cylinder']),
    panel: pick('panel', ['front', 'moved']),
    open: num('open'), viewer: num('viewer'), focus: num('focus'), hover: num('hover'), at: num('at'),
    fov: num('fov'), yaw: num('yaw'), pitch: num('pitch'),
    test: q.get('test') === '1',
  };
}

const SORT_TRIAGE = { name: { sortBy: 'name', sortOrder: 'asc' }, newest: { sortBy: 'date', sortOrder: 'desc' }, largest: { sortBy: 'size', sortOrder: 'desc' } };
const byName = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' });

/**
 * Build the scene in `container`. Resolves once it can render (the library keeps loading in the background).
 * opts: { flags, onLibrary({ count, error }), onXR(presenting) }
 * Returns { enterVR(), exitVR(), setActive(on), dispose() }.
 */
export async function createSalon(container, { flags = {}, onLibrary, onXR } = {}) {
  refreshColors();
  await loadFonts();
  const app = createRuntime(container, { yaw: flags.yaw || 0, pitch: flags.pitch || 0 });
  const { scene, camera, renderer } = app;
  const assets = createAssets();
  const tex = createTextures();
  let disposed = false;
  const timers = new Set();
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); if (!disposed) fn(); }, ms); timers.add(id); };

  let lib = null, focus = null, her = null;
  const leaving = new Set();
  const player = createVideoPlayer({ say: app.say, onMeta: (it, a) => focus?.fixAspect(it, a) });
  const ctx = { app, tex, assets, player };
  const settings = loadSettings();

  // ?fov=<horizontal degrees> widens the flat camera (one screenshot shows how the whole view is filled)
  const applyFov = () => { if (!flags.fov) return; camera.fov = (2 * Math.atan(Math.tan((flags.fov / 2) * DEG) / camera.aspect)) / DEG; camera.updateProjectionMatrix(); };
  applyFov(); app.onResize(applyFov);

  // ---------- the void: a soft floor disc, nothing else ----------
  const disc = new THREE.Mesh(new THREE.CircleGeometry(3.6, 72), new THREE.MeshBasicMaterial({ map: assets.floor(), transparent: true, depthWrite: false }));
  disc.rotation.x = -Math.PI / 2; disc.position.y = 0.002; disc.renderOrder = -10; scene.add(disc); // drawn first: it never covers content below the floor

  // ---------- the stage: everything hangs in here ----------
  const stage = new THREE.Group(); stage.name = 'stage';
  stage.position.set(0, 1.6, 0);
  scene.add(stage);
  let stageFade = 1;
  // a line in the middle of the view for loading and empty states
  const note = canvasPlane(1.6, 0.12, { density: 1200 });
  note.position.set(0, 0, -2.3); note.renderOrder = 6; note.visible = false;
  stage.add(note);
  let noteText = '';
  const setNote = (str) => {
    if (str === noteText) return;
    noteText = str; note.visible = !!str;
    if (str) note.draw((c, s, w, h) => { text(c, s, str, { x: w / 2, y: h / 2, size: 0.05, weight: 500, align: 'center', color: C.dim, maxW: w - 0.04, minSize: 0.036 }); });
  };

  const headPos = new THREE.Vector3(), headQ = new THREE.Quaternion(), tmpScale = new THREE.Vector3();
  /** the head pose right now. In XR it is read from the viewer camera that renderer.xr updates (its world
   *  matrix), so it is never a stale or identity pose; until the first XR frame it falls back to the camera. */
  function readHead() {
    if (renderer.xr.isPresenting) {
      const xc = renderer.xr.getCamera();
      xc.matrixWorld.decompose(headPos, headQ, tmpScale);
      if (headPos.lengthSq() > 1e-6 || Math.abs(headQ.w) < 0.99999) return 'xr';
    }
    camera.getWorldPosition(headPos); camera.getWorldQuaternion(headQ);
    return 'camera';
  }
  /** the pose for the stage: its centre goes exactly where the head looks (yaw and pitch). When the head is
   *  pitched more than 30 deg (reclined or lying) the stage takes the head's full orientation, roll included;
   *  otherwise it stays upright (so looking level again after lying down brings it back upright). */
  function stagePoseFromHead() {
    const src = readHead();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(headQ);
    const yaw = Math.atan2(-fwd.x, -fwd.z), pitch = Math.asin(clamp(fwd.y, -1, 1));
    const full = Math.abs(pitch) > 30 * DEG;
    const quat = full ? headQ.clone() : new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
    return { pos: headPos.clone(), quat, pitch, full, src };
  }
  let recentreTw = null;
  function recentre({ instant = false, quiet = false } = {}) {
    const to = stagePoseFromHead();
    const deg = Math.round(to.pitch / DEG);
    const where = Math.abs(deg) < 4 ? 'level' : deg > 0 ? `${deg}° up` : `${-deg}° down`;
    if (!quiet) app.say(`Recentred · ${where}${to.full ? ' · upright to your face' : ''}${renderer.xr.isPresenting && to.src !== 'xr' ? ' · (no headset pose yet)' : ''}`, 2600);
    if (instant) { stage.position.copy(to.pos); stage.quaternion.copy(to.quat); recentreTw = null; return; }
    recentreTw = { t0: performance.now(), ms: 420, p0: stage.position.clone(), q0: stage.quaternion.clone(), to };
  }
  function updateRecentre() {
    if (!recentreTw) { stageFade = 1; return; }
    const t = clamp((performance.now() - recentreTw.t0) / recentreTw.ms, 0, 1), e = easeInOut(t);
    stage.position.lerpVectors(recentreTw.p0, recentreTw.to.pos, e);
    stage.quaternion.slerpQuaternions(recentreTw.q0, recentreTw.to.quat, e);
    stageFade = 1 - 0.65 * Math.sin(Math.PI * t); // a dip, so a big turn does not feel like being turned
    if (t >= 1) recentreTw = null;
  }
  // once, 0.75 s after entering VR (by then the viewer pose is live)
  app.on('xrstart', () => { later(() => recentre(), 750); buildMenu(); onXR?.(true); });
  app.on('xrend', () => {
    player.pause();
    stage.position.set(0, 1.6, 0); stage.quaternion.identity(); // the flat camera looks from the origin again
    buildMenu(); onXR?.(false);
  });

  // the panel's Recentre button arms a short countdown, so you can look where you want the band first
  let armed = null;
  function armRecentre() { armed = { t0: performance.now(), lastSay: -1 }; }
  function updateArmed() {
    if (!armed) return;
    const rem = Math.max(0, 1.5 - (performance.now() - armed.t0) / 1000);
    menu.setLabel('recentre', `Look there · ${rem.toFixed(1)} s`);
    const step = Math.ceil(rem * 2);
    if (step !== armed.lastSay) { armed.lastSay = step; app.say(`Look where you want it · ${rem.toFixed(1)} s`, 900); }
    if (rem <= 0) { armed = null; menu.setLabel('recentre', 'Recentre'); recentre(); }
  }

  // ---------- data ----------
  const D = {
    base: null, baseError: null,            // the gallery: performers after filtering
    filterList: null, filterError: null,    // performers still to filter
    counts: new Map(), countsReady: false,  // id -> { pics, vids } still to decide
    cover: new Map(),                       // thumbnail path -> aspect
    genres: null, genresError: null, genresLoading: null, basePath: null,
    gallery: new Map(),                     // performer id -> { pics, vids }
  };
  const coverDims = async (list) => {
    const paths = list.map((p) => p.thumbnail).filter((p) => p && !D.cover.has(p));
    if (!paths.length) return;
    const dims = await Promise.race([api.dims(paths).catch(() => ({})), new Promise((r) => setTimeout(() => r({}), 6000))]);
    for (const [p, wh] of Object.entries(dims)) if (wh && wh[0] && wh[1]) D.cover.set(p, wh[0] / wh[1]);
  };
  const basePromise = (async () => {
    try { D.base = await api.performers(); } catch (e) { D.base = []; D.baseError = e.message || String(e); }
    await coverDims(D.base);
    if (disposed) return;
    onLibrary?.({ count: D.baseError ? null : D.base.length, error: D.baseError });
    if (S.level === 'library' && S.view === 'performers') rebuildLibrary();
  })();
  const filterPromise = (async () => {
    try { D.filterList = await api.filterPerformers(); } catch (e) { D.filterList = []; D.filterError = e.message || String(e); }
    await Promise.all([
      coverDims(D.filterList),
      pool(D.filterList, 6, async (p) => {
        if (disposed) return;
        const [a, v] = await Promise.all([api.toDecide(p.id, 'pics').catch(() => 0), api.toDecide(p.id, 'vids').catch(() => 0)]);
        D.counts.set(p.id, { pics: a, vids: v });
      }),
    ]);
    D.countsReady = true;
    if (disposed) return;
    if (S.level === 'library' && S.view === 'filter') rebuildLibrary();
  })();
  function ensureGenres() {
    if (!D.genresLoading) {
      D.genresLoading = (async () => {
        try {
          D.basePath = D.basePath || await api.basePath();
          D.genres = D.basePath ? await api.genres(D.basePath) : [];
        } catch (e) { D.genres = []; D.genresError = e.message || String(e); }
        if (!disposed && S.level === 'library' && S.view === 'genres') rebuildLibrary();
      })();
    }
    return D.genresLoading;
  }
  const isNew = (p) => !!p.last_leakshaven_update_time && !p.leakshaven_update_acknowledged;
  const toDecide = (p) => { const c = D.counts.get(p.id); return c ? c.pics + c.vids : 0; };
  const coverAspect = (p) => clamp(D.cover.get(p.thumbnail) || 0.75, 0.45, 1.8);

  // ---------- state ----------
  const S = {
    level: 'library', view: flags.view || 'performers',
    sort: 'name', newOnly: false, hasVideos: false,
    shape: flags.shape || (settings.shape === 'cylinder' ? 'cylinder' : 'dome'),
    her: null, herMode: 'gallery', viewer: false, herItems: [], show: 'all', pSort: 'name', showKept: true,
    triType: 'pics', tri: null, loading: false,
    libAt: 0, libScroll: null,
  };
  const SORTS = {
    name: byName,
    most: (a, b) => (S.view === 'filter' ? toDecide(b) - toDecide(a) : S.view === 'genres' ? ((b.pics || 0) + (b.vids || 0)) - ((a.pics || 0) + (a.vids || 0)) : (b.pics_count || 0) - (a.pics_count || 0)) || byName(a, b),
    newest: (a, b) => String(b.import_date || '').localeCompare(String(a.import_date || '')) || byName(a, b),
  };

  function libraryItems() {
    if (S.view === 'genres') return [...(D.genres || [])].sort(SORTS[S.sort] || byName).map((g) => ({ aspect: 1.3, genre: g }));
    const filter = S.view === 'filter';
    if (filter && !D.countsReady) return [];
    let src = (filter ? D.filterList : D.base) || [];
    if (S.newOnly) src = src.filter(isNew);
    if (S.hasVideos) src = src.filter((p) => (filter ? (D.counts.get(p.id)?.vids || 0) : (p.vids_count || 0)) > 0);
    if (filter) src = src.filter((p) => toDecide(p) > 0);
    return [...src].sort(SORTS[S.sort]).map((p) => ({
      aspect: coverAspect(p), src: p.thumbnail ? { kind: 'image', path: p.thumbnail } : null, perf: p,
      sub: filter ? `${toDecide(p)} to decide` : null,
    }));
  }
  function libraryNote(count) {
    if (S.view === 'genres') {
      if (!D.genres) return 'Loading genres · the first scan can take a while';
      if (D.genresError) return `Genres not loaded: ${D.genresError}`;
      return count ? '' : 'No genres in this library';
    }
    if (S.view === 'filter') {
      if (!D.countsReady) return 'Counting the files still to decide…';
      if (D.filterError) return `The filter list did not load: ${D.filterError}`;
      return count ? '' : (S.newOnly || S.hasVideos ? 'Nobody to filter with these filters' : 'Nothing left to filter');
    }
    if (!D.base) return 'Loading the library…';
    if (D.baseError) return `The library did not load: ${D.baseError}`;
    return count ? '' : (S.newOnly || S.hasVideos ? 'No performers match these filters' : 'No performers in the gallery yet');
  }

  // ---------- what is on show ----------
  const band = () => (S.level === 'library' ? lib : her); // the band in view, if any
  const retire = (o, instant) => { if (!o) return; if (instant) o.dispose(); else { o.leave(); leaving.add(o); } };

  function makeLibrary(startIndex = 0) {
    const items = libraryItems();
    const B = new Band(ctx, stage, {
      kind: S.view === 'genres' ? 'genres' : 'performers', items, shape: S.shape, startIndex,
      onPick: (pc) => {
        if (pc.item.genre) openGenre(pc.item.genre);
        else openPerformer(pc.item.perf, S.view === 'filter' ? 'triage' : 'gallery');
      },
    });
    B.onPress = (pc, src) => { if (src?.controller) startBandPress(B, pc, src, 'trigger'); };
    setNote(libraryNote(items.length));
    return B;
  }
  function swapIn(old, neu, instant) {
    retire(old, instant);
    if (instant) { neu.fade = 1; neu.depth = 1; } else neu.enter();
  }
  function showLibrary({ instant = false } = {}) {
    S.level = 'library'; S.viewer = false; S.her = null; S.tri = null;
    loadSeq++;
    const neu = makeLibrary(S.libAt);
    if (S.libScroll != null) { neu.scroll = clamp(S.libScroll, neu.min, neu.max); S.libScroll = null; } // back where you were
    retire(focus, instant); retire(her, instant);
    focus = her = null;
    swapIn(lib, neu, instant);
    lib = neu;
    buildMenu();
  }
  function rebuildLibrary({ keepPlace = true } = {}) {
    if (S.level !== 'library') return;
    const old = lib;
    lib = makeLibrary(keepPlace && old && old.count ? old.nearestIndex() : 0);
    swapIn(old, lib, false);
    buildMenu();
  }
  function setView(v) {
    if (v === S.view) return;
    S.view = v;
    if (v === 'genres') { ensureGenres(); if (!['name', 'most'].includes(S.sort)) S.sort = 'name'; }
    rebuildLibrary({ keepPlace: false });
  }

  // ---------- one performer or genre: a gallery (band + plain viewer), or triage of her files to decide ----------
  let loadSeq = 0;
  async function openHer(her0, mode, { instant = false } = {}) {
    if (S.level !== 'library') return false;
    S.libScroll = lib ? lib.scroll : null;
    S.libAt = lib ? lib.nearestIndex() : 0;
    S.level = 'her'; S.her = her0; S.herMode = mode; S.viewer = false; S.herItems = []; S.tri = null;
    undoStack.length = 0;
    retire(lib, instant); lib = null;
    setNote(`Loading ${her0.name}…`);
    buildMenu();
    const ok = await loadHer();
    if (!ok) return false;
    showHer({ instant, focusAt: 0 });
    return true;
  }
  const openPerformer = (p, mode, o) => openHer({ kind: 'performer', perf: p, name: p.name, fromFilter: mode === 'triage' }, mode, o);
  const openGenre = (g, o) => openHer({ kind: 'genre', genre: g, name: g.name }, 'gallery', o);
  async function switchHerMode(mode) {
    if (mode === S.herMode || S.level !== 'her') return;
    S.herMode = mode; S.viewer = false;
    retire(focus); retire(her); focus = her = null;
    setNote(`Loading ${S.her.name}…`);
    buildMenu();
    if (await loadHer()) showHer({ focusAt: 0 });
  }
  const itemOf = (x, isVid) => ({
    key: x.path, path: x.path, video: !!isVid,
    aspect: x.width && x.height ? x.width / x.height : isVid ? 16 / 9 : 0.75, aspectKnown: !!(x.width && x.height),
    src: { kind: isVid ? 'video' : 'image', path: x.path },
    name: x.name || String(x.path).split(/[\\/]/).pop(), size: x.size || 0, modified: x.modified || 0, duration: x.duration || 0,
    decision: null, pending: false, decided: false,
  });
  /** load what the level shows; false when it is stale (the user moved on) or failed */
  async function loadHer() {
    const h = S.her, seq = ++loadSeq;
    S.loading = true;
    try {
      if (S.herMode === 'triage') return await loadTriage(seq);
      let g;
      if (h.kind === 'genre') {
        D.basePath = D.basePath || await api.basePath();
        g = await api.genre(h.genre.name, D.basePath);
        const paths = [...g.pics, ...g.vids].map((x) => x.path).slice(0, 800);
        const dims = await api.dims(paths).catch(() => ({}));
        for (const x of [...g.pics, ...g.vids]) { const d = dims[x.path]; if (d) { x.width = d[0]; x.height = d[1]; } }
      } else {
        g = D.gallery.get(h.perf.id);
        if (!g) {
          const [pics, vids] = await Promise.all([api.pictures(h.perf.id), api.videos(h.perf.id)]);
          g = { pics, vids };
          D.gallery.set(h.perf.id, g);
        }
      }
      if (seq !== loadSeq) return false;
      S.herItems = [...g.pics.map((x) => itemOf(x, false)), ...g.vids.map((x) => itemOf(x, true))];
      return true;
    } catch (e) {
      if (seq !== loadSeq) return false;
      S.herItems = [];
      setNote(`${h.name} did not load: ${e.message || e}`);
      app.say(`${h.name} did not load`, 3000, 'bad');
      return false;
    } finally { if (seq === loadSeq) S.loading = false; }
  }
  async function loadTriage(seq) {
    const p = S.her.perf;
    const { files, total } = await api.filterFiles(p.id, { type: S.triType, limit: 200, offset: 0, ...SORT_TRIAGE[S.pSort] });
    if (seq !== loadSeq) return false;
    S.tri = { type: S.triType, perfId: p.id, items: files.map((f) => itemOf(f, S.triType === 'vids')), total, confirmed: 0, loading: false, exhausted: files.length >= total };
    S.herItems = S.tri.items;
    const c = D.counts.get(p.id) || { pics: 0, vids: 0 };
    D.counts.set(p.id, { ...c, [S.triType]: total });
    return true;
  }
  /** near the end of what is loaded: the next page (the server's list has lost the files decided since) */
  async function loadMoreTriage() {
    const T = S.tri;
    if (!T || T.loading || T.exhausted || !focus || S.herMode !== 'triage') return;
    if (focus.f < focus.list.length - 15) return;
    if (T.items.some((i) => i.pending)) return;
    const offset = T.items.filter((i) => !i.decided).length;
    if (offset >= T.total - T.confirmed) { T.exhausted = true; return; }
    T.loading = true;
    const seq = loadSeq;
    try {
      const { files, total } = await api.filterFiles(T.perfId, { type: T.type, limit: 200, offset, ...SORT_TRIAGE[S.pSort] });
      if (seq !== loadSeq || S.tri !== T) return;
      const have = new Set(T.items.map((i) => i.path));
      const add = files.filter((f) => !have.has(f.path)).map((f) => itemOf(f, T.type === 'vids'));
      if (!add.length) T.exhausted = true;
      T.items.push(...add);
      T.total = total + T.confirmed;
      if (focus) { focus.setList(herList(), focus.current); updateStatus(); }
    } catch (e) {
      app.say(`More files did not load: ${e.message || e}`, 3000, 'bad');
    } finally { T.loading = false; }
  }
  function herList() {
    if (S.herMode === 'triage') return S.herItems.filter((i) => i.decision !== 'delete' && (S.showKept || i.decision !== 'keep'));
    const fn = S.pSort === 'newest' ? (a, b) => b.modified - a.modified : S.pSort === 'largest' ? (a, b) => b.size - a.size : (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });
    const pics = S.herItems.filter((i) => !i.video).sort(fn), vids = S.herItems.filter((i) => i.video).sort(fn);
    if (S.show === 'pics') return pics;
    if (S.show === 'vids') return vids;
    const all = [...pics];
    vids.forEach((v, i) => all.splice(Math.min(all.length, 1 + i * 2), 0, v)); // videos woven in near the start
    return all;
  }
  function showHer({ instant = false, focusAt = null } = {}) {
    const list = herList();
    const at = clamp(focusAt ?? 0, 0, Math.max(0, list.length - 1));
    const old = focus || her;
    focus = her = null;
    const triage = S.herMode === 'triage';
    if (!triage && !S.viewer) {
      her = new Band(ctx, stage, { kind: 'pictures', items: list, shape: S.shape, startIndex: at, onPick: (pc) => openViewer(pc.index) });
      const B = her; B.onPress = (pc, src) => { if (src?.controller) startBandPress(B, pc, src, 'trigger'); };
      her.list = list;
      swapIn(old, her, instant);
      setNote(list.length ? '' : 'Nothing here');
    } else {
      focus = new FocusView(ctx, stage, {
        title: triage ? `${S.her.name} · to filter` : S.her.name, decide: triage,
        onPick: (i, isFocus) => {
          if (!isFocus) { focus.setFocus(i); updateStatus(); loadMoreTriage(); return; }
          tapFocus();
        },
        onAction: (k) => ({ prev: () => step(-1), next: () => step(1), keep: () => decide('keep'), del: () => decide('delete'), undo: () => undo(), close: () => closeViewer() })[k]?.(),
      });
      focus.setList(list, list[at] || null, { instant: true });
      swapIn(old, focus, instant);
      setNote(list.length ? '' : triage ? 'Nothing left to decide here' : 'Nothing here');
    }
    updateStatus();
    buildMenu();
  }
  function tapFocus() {
    const it = focus?.current;
    if (!it) return;
    if (it.video) { focus.togglePlay(); return; }
    app.say(S.herMode === 'triage' ? 'A keep · B delete · X undo' : 'Stick: previous / next · B: close');
  }
  function openViewer(i) { S.viewer = true; showHer({ focusAt: i }); }
  function closeViewer() { if (!S.viewer) return; const at = focus ? focus.f : 0; S.viewer = false; showHer({ focusAt: at }); }
  function goBack() {
    if (S.viewer) { closeViewer(); return; }
    if (S.level !== 'her') return;
    showLibrary();
  }

  // ---------- deciding in triage: real decisions, as the app's Filter page makes them ----------
  const undoStack = []; // this triage's decisions, newest last: { item, kind, prev, type, perfId, done, confirmed }
  let undoBusy = false;
  const counts = () => { let k = 0, d = 0; for (const i of S.herItems) { if (i.decision === 'keep') k++; else if (i.decision === 'delete') d++; } return { k, d }; };
  function updateStatus() {
    if (S.level !== 'her') return;
    if (S.herMode === 'triage') {
      const { k, d } = counts();
      const T = S.tri;
      const c = D.counts.get(S.her.perf.id) || { pics: 0, vids: 0 };
      if (focus && T) {
        const unloaded = Math.max(0, T.total - T.confirmed - T.items.filter((i) => !i.decided).length);
        focus.setStatus(focus.list.length ? `${focus.f + 1} of ${focus.list.length + unloaded} · ${k} kept · ${d} deleted` : `Nothing left to decide · ${k} kept · ${d} deleted`);
      }
      menu.setSub(`${plural(c.pics, 'picture')}, ${plural(c.vids, 'video')} to decide · ${k} kept · ${d} deleted`);
    } else {
      const np = S.herItems.filter((i) => !i.video).length, nv = S.herItems.length - np;
      if (focus) focus.setStatus(focus.list.length ? `${focus.f + 1} of ${focus.list.length}${focus.current?.video ? ' · video' : ''}` : 'Nothing here');
      menu.setSub(S.loading ? 'Loading…' : `${plural(np, 'picture')} · ${plural(nv, 'video')}`);
    }
  }
  const sameTriage = (entry) => S.level === 'her' && S.herMode === 'triage' && S.tri && S.tri.perfId === entry.perfId && S.tri.type === entry.type && focus;
  const LABEL = { keep: 'Keep', delete: 'Delete' };
  function decide(kind) {
    if (!focus || !focus.current || S.herMode !== 'triage' || !S.tri) return;
    const it = focus.current, old = focus.list, at = focus.f;
    if (it.pending) return;
    focus.grabY = 0;
    if (it.decision === kind) { step(1); return; } // already so: just move on
    const entry = { item: it, kind, prev: it.decision, type: S.tri.type, perfId: S.tri.perfId, confirmed: false };
    it.decision = kind; it.pending = true;
    undoStack.push(entry);
    const list = herList();
    let next = null;
    for (let i = at + 1; i < old.length && !next; i++) if (list.includes(old[i]) && !old[i].decision) next = old[i];
    for (let i = at + 1; i < old.length && !next; i++) if (list.includes(old[i])) next = old[i];
    if (!next) next = list.includes(it) ? it : list[Math.min(at, list.length - 1)] || null;
    focus.setList(list, next);
    updateStatus();
    const T = S.tri;
    entry.done = api.decide(entry.perfId, it.path, kind).then(() => {
      it.pending = false;
      if (!it.decided) { it.decided = true; T.confirmed++; }
      entry.confirmed = true;
      const c = D.counts.get(entry.perfId);
      if (c && !entry.prev) c[entry.type] = Math.max(0, c[entry.type] - 1);
      if (!disposed) { updateStatus(); loadMoreTriage(); }
    }).catch((e) => {
      it.pending = false; it.decision = entry.prev;
      const i = undoStack.indexOf(entry); if (i >= 0) undoStack.splice(i, 1);
      if (disposed) return;
      app.say(`${LABEL[kind]} failed: ${e.message || e} · it is back`, 4000, 'bad');
      if (sameTriage(entry)) { focus.setList(herList(), it); updateStatus(); }
    });
  }
  async function undo() {
    if (S.herMode !== 'triage' || undoBusy) return;
    const entry = undoStack[undoStack.length - 1];
    if (!entry) { app.say('Nothing to undo'); return; }
    undoBusy = true;
    try {
      await entry.done?.catch(() => {});
      if (!undoStack.includes(entry)) return; // it failed: already put back
      await api.undo();
      undoStack.splice(undoStack.indexOf(entry), 1);
      const it = entry.item;
      it.decision = entry.prev; it.decided = !!entry.prev;
      const T = S.tri && S.tri.perfId === entry.perfId && S.tri.type === entry.type ? S.tri : null;
      if (T && !entry.prev) T.confirmed = Math.max(0, T.confirmed - 1);
      const c = D.counts.get(entry.perfId);
      if (c && !entry.prev) c[entry.type] += 1;
      if (disposed) return;
      app.say(`Undone · ${it.name} is back`, 2200);
      if (sameTriage(entry)) { focus.setList(herList(), it); updateStatus(); }
      else if (S.level === 'her' && S.herMode === 'triage' && S.tri?.perfId === entry.perfId) {
        // it was decided under the other type: show that type again, with it in focus
        S.triType = entry.type;
        if (await loadHer()) { const i = herList().findIndex((x) => x.path === it.path); showHer({ focusAt: Math.max(0, i) }); }
      }
    } catch (e) {
      if (!disposed) app.say(`Undo failed: ${e.message || e}`, 4000, 'bad');
    } finally { undoBusy = false; }
  }
  function step(d) { if (focus && focus.step(d)) { updateStatus(); loadMoreTriage(); } }

  // ---------- grips: throw (triage), drag the band, move the panel; both grips held = recentre ----------
  let grab = null, press = null, panelGrab = null;
  const tmpV = new THREE.Vector3();
  const stageUp = () => new THREE.Vector3(0, 1, 0).applyQuaternion(stage.quaternion);
  const gripDown = new Map(); let bothSince = 0, bothFired = false;
  app.controllers.forEach((e) => {
    app.listen(e.controller, 'squeezestart', () => {
      gripDown.set(e, performance.now());
      if (gripDown.size >= 2) { // both grips: cancel single-grip actions; recentre after 0.6 s
        bothSince = performance.now(); bothFired = false;
        grab = null;
        if (press?.kind === 'grip') { press.band.endDrag(); press.band.vel = 0; press = null; }
        if (panelGrab?.kind === 'grip') endPanelGrab();
        return;
      }
      const o = e.hit?.object;
      if (o && o === menu.handle) { startPanelGrab(e, 'grip'); return; }
      if (o && menu.contains(o)) return;
      const pc = o?.userData.bandPiece, B = band();
      if (pc && B && B.pieces.includes(pc)) { startBandPress(B, pc, e, 'grip'); return; }
      if (!focus || !focus.current || S.herMode !== 'triage' || S.viewer) return;
      grab = { entry: e, start: e.controller.getWorldPosition(new THREE.Vector3()), samples: [] };
    });
    app.listen(e.controller, 'squeezeend', () => {
      gripDown.delete(e); bothSince = 0;
      if (grab?.entry === e) endGrab();
      if (press?.src === e && press.kind === 'grip') endBandPress();
      if (panelGrab?.src === e && panelGrab.kind === 'grip') endPanelGrab();
    });
    app.listen(e.controller, 'selectend', () => {
      if (press?.src === e && press.kind === 'trigger') endBandPress();
      if (panelGrab?.src === e && panelGrab.kind === 'trigger') endPanelGrab();
    });
  });
  function updateBothGrips() {
    if (bothSince && !bothFired && performance.now() - bothSince > 600) { bothFired = true; recentre(); }
  }
  function moveGrab(dy) {
    if (!grab || !focus) return;
    focus.grabY = clamp(dy, -0.45, 0.45);
    grab.samples.push({ t: performance.now(), y: focus.grabY });
    if (grab.samples.length > 8) grab.samples.shift();
  }
  function endGrab() {
    const g = grab; grab = null;
    if (!g || !focus) return;
    const s = g.samples, v = s.length > 1 ? (s[s.length - 1].y - s[0].y) / Math.max(0.016, (s[s.length - 1].t - s[0].t) / 1000) : 0;
    const y = focus.grabY;
    if (y > 0.13 || (v > 1.3 && y > 0.04)) decide('keep');
    else if (y < -0.13 || (v < -1.3 && y < -0.04)) decide('delete');
    else if (g.mouse && g.moved < 4) tapFocus();
  }
  const ray = new THREE.Raycaster();
  const mouseNDC = new THREE.Vector2();
  const onHandleObj = (o) => { while (o) { if (o === menu.handle) return true; o = o.parent; } return false; };
  app.listen(window, 'pointerdown', (ev) => {
    if (renderer.xr.isPresenting || !app.isActive() || ev.target !== app.canvas) return;
    app.toNDC(ev, mouseNDC);
    ray.setFromCamera(mouseNDC, camera);
    const onPanel = menu.root.visible ? ray.intersectObject(menu.root, true)[0] : null;
    if (onPanel && onHandleObj(onPanel.object)) { ev.stopPropagation(); startPanelGrab('mouse', 'mouse', onPanel.point); return; }
    if (onPanel) return; // panel buttons: the runtime turns a click into the button press
    const B = band();
    if (B) {
      const hit = ray.intersectObjects(B.pickables(), false)[0];
      if (hit) { ev.stopPropagation(); startBandPress(B, hit.object.userData.bandPiece, 'mouse', 'mouse', ev.clientX); }
      return;
    }
    if (!focus || !focus.current || S.herMode !== 'triage') return;
    const n = focus.nodes.get(focus.current); if (!n) return;
    if (ray.intersectObject(n.pic, false).length) {
      // the scrub bar and buttons of a video sit on the picture: they keep their clicks
      const strip = focus.strip?.g;
      if (strip && ray.intersectObject(strip, true).length) return;
      ev.stopPropagation();
      grab = { mouse: true, y0: ev.clientY, moved: 0, samples: [] };
    }
  }, { capture: true });
  app.listen(window, 'pointermove', (ev) => {
    if (!app.isActive()) return;
    app.toNDC(ev, mouseNDC);
    if (press?.src === 'mouse') { ev.stopPropagation(); press.moved = Math.max(press.moved, Math.abs(ev.clientX - press.x0)); return; }
    if (panelGrab?.src === 'mouse') { ev.stopPropagation(); return; }
    if (!grab?.mouse) return;
    ev.stopPropagation();
    const visH = 2 * Math.tan((camera.fov / 2) * DEG) * 1.45;
    grab.moved = Math.max(grab.moved, Math.abs(ev.clientY - grab.y0));
    moveGrab(-(ev.clientY - grab.y0) * (visH / Math.max(1, app.canvas.clientHeight)));
  }, { capture: true });
  app.listen(window, 'pointerup', (ev) => {
    if (grab?.mouse) { ev.stopPropagation(); endGrab(); }
    if (press?.src === 'mouse') { ev.stopPropagation(); endBandPress(); }
    if (panelGrab?.src === 'mouse') { ev.stopPropagation(); endPanelGrab(); }
  }, { capture: true });

  // ---------- the band: grab it and pull sideways (1:1 with the hand's angle); a tap opens ----------
  const tq = new THREE.Quaternion(), tv = new THREE.Vector3();
  /** the yaw of a pointing ray in the stage's frame (controller ray, or the mouse ray in flat mode) */
  function rayYaw(src) {
    if (src === 'mouse') { ray.setFromCamera(mouseNDC, camera); tv.copy(ray.ray.direction); }
    else { src.controller.getWorldQuaternion(tq); tv.set(0, 0, -1).applyQuaternion(tq); }
    tv.applyQuaternion(stage.quaternion.clone().invert());
    return Math.atan2(tv.x, -tv.z);
  }
  function startBandPress(B, pc, src, kind, x0 = 0) {
    if (press || B.dead) return;
    press = { band: B, piece: pc, src, kind, x0, moved: 0 };
    B.beginDrag(rayYaw(src));
  }
  function endBandPress() {
    const p = press; press = null;
    if (!p) return;
    const tap = p.kind !== 'grip' && (p.src === 'mouse' ? p.moved < 5 : p.band.dragged < 1.5 * DEG);
    p.band.endDrag();
    if (tap && !p.band.dead) { p.band.vel = 0; if (p.piece) p.band.onPick?.(p.piece); }
  }

  // ---------- the panel: grab its handle bar and put it anywhere; it then faces you ----------
  const menu = createPanel(app);
  stage.add(menu.root);
  menu.root.scale.setScalar(0.72);
  menu.onHandle = (src) => { if (src && !src.mouse && src.controller) startPanelGrab(src, 'trigger'); };
  const stageUpWorld = () => new THREE.Vector3(0, 1, 0).applyQuaternion(stage.quaternion);
  function billboard() {
    readHead();
    stage.updateMatrixWorld(true);
    menu.root.up.copy(stageUpWorld());
    menu.root.lookAt(headPos);
  }
  /** put the panel at a direction (degrees, in the stage's frame) and distance from the head */
  function placePanel(yawDeg, pitchDeg, dist) {
    const y = yawDeg * DEG, p = pitchDeg * DEG;
    menu.root.position.set(Math.sin(y) * Math.cos(p) * dist, Math.sin(p) * dist, -Math.cos(y) * Math.cos(p) * dist);
    billboard();
  }
  /** bring it in front of where the head looks now (left stick press, or M on a screen) */
  function summonPanel() {
    readHead();
    const d = new THREE.Vector3(0, 0, -1).applyQuaternion(headQ).applyQuaternion(stage.quaternion.clone().invert());
    placePanel(Math.atan2(d.x, -d.z) / DEG - 14, Math.asin(clamp(d.y, -1, 1)) / DEG - 16, 0.62);
    saveSettings({ panel: menu.root.position.toArray().map((v) => +v.toFixed(3)) });
  }
  function startPanelGrab(src, kind, point = null) {
    if (panelGrab) return;
    const wp = menu.root.getWorldPosition(new THREE.Vector3());
    if (src === 'mouse') {
      camera.getWorldPosition(headPos);
      panelGrab = { src, kind, dist: point.distanceTo(headPos), offset: wp.clone().sub(point) };
    } else panelGrab = { src, kind, offset: src.controller.worldToLocal(wp.clone()) };
  }
  function updatePanelGrab() {
    if (!panelGrab) return;
    let wp;
    if (panelGrab.src === 'mouse') {
      ray.setFromCamera(mouseNDC, camera);
      wp = ray.ray.origin.clone().addScaledVector(ray.ray.direction, panelGrab.dist).add(panelGrab.offset);
    } else wp = panelGrab.src.controller.localToWorld(panelGrab.offset.clone());
    menu.root.position.copy(stage.worldToLocal(wp));
    billboard();
  }
  function endPanelGrab() {
    panelGrab = null; billboard();
    saveSettings({ panel: menu.root.position.toArray().map((v) => +v.toFixed(3)) });
  }

  // ---------- the control panel ----------
  function seg(rowLabel, opts, value, set) { return { label: rowLabel, items: opts.map(([id, label]) => ({ id: `${rowLabel}-${id}`, label, active: value === id, onClick: () => set(id) })) }; }
  function buildMenu() {
    if (disposed) return;
    const shapeRow = seg('Shape', [['dome', 'Dome'], ['cylinder', 'Cylinder']], S.shape, setShape);
    const actions = [{ id: 'recentre', label: 'Recentre', onClick: () => armRecentre() }];
    if (renderer.xr.isPresenting) actions.push({ id: 'exit', label: 'Exit VR', onClick: () => app.exitXR() });
    const keys = ['Right stick press or both grips: recentre', 'Left stick press: panel here'];
    if (S.level === 'library') {
      const filter = S.view === 'filter', genres = S.view === 'genres';
      const n = lib ? lib.count : 0;
      const noun = genres ? plural(n, 'genre') : plural(n, 'performer');
      const rows = [seg('View', [['performers', 'Performers'], ['filter', 'Filter'], ['genres', 'Genres']], S.view, setView)];
      rows.push(seg('Sort', genres ? [['name', 'Name'], ['most', 'Most files']] : [['name', 'Name'], ['most', filter ? 'Most to decide' : 'Most pictures'], ['newest', 'Newest']], S.sort, (v) => { if (v !== S.sort) { S.sort = v; rebuildLibrary({ keepPlace: false }); } }));
      if (!genres) {
        rows.push({ label: 'Show', items: [
          { id: 'new', label: 'New only', active: S.newOnly, onClick: () => { S.newOnly = !S.newOnly; rebuildLibrary({ keepPlace: false }); } },
          { id: 'hasv', label: 'Has videos', active: S.hasVideos, onClick: () => { S.hasVideos = !S.hasVideos; rebuildLibrary({ keepPlace: false }); } },
        ] });
      }
      rows.push(shapeRow);
      menu.build({
        title: `${filter ? 'To filter' : genres ? 'Genres' : 'Library'} · ${noun}`,
        sub: filter ? 'Trigger: decide her files · drag: move the band' : genres ? 'Trigger: its pictures · drag: move the band' : 'Trigger: her gallery · drag: move the band',
        back: null, rows, actions,
        legend: ['Trigger: open · hold trigger and drag: move', 'Right stick: scroll', ...keys],
      });
    } else if (S.herMode === 'gallery') {
      const rows = [];
      if (S.her.fromFilter) rows.push(seg('View', [['gallery', 'Gallery'], ['triage', 'Filter her files']], 'gallery', (v) => switchHerMode(v)));
      rows.push(seg('Show', [['all', 'All'], ['pics', 'Pictures'], ['vids', 'Videos']], S.show, (v) => { if (v !== S.show) { S.show = v; showHer({ focusAt: 0 }); } }));
      rows.push(seg('Sort', [['name', 'Name'], ['newest', 'Newest'], ['largest', 'Largest']], S.pSort, (v) => { if (v !== S.pSort) { S.pSort = v; showHer({ focusAt: 0 }); } }));
      rows.push(shapeRow);
      menu.build({
        title: S.her.name, sub: '', back: goBack, rows, actions,
        legend: S.viewer
          ? ['Stick: previous / next · B or Y: close', 'Trigger on a video: play / pause', ...keys]
          : ['Trigger: open a picture · hold and drag: move', 'Right stick: scroll · Y: back', ...keys],
      });
    } else {
      const c = D.counts.get(S.her.perf.id) || { pics: 0, vids: 0 };
      menu.build({
        title: `${S.her.name} · to filter`, sub: '', back: goBack,
        rows: [
          seg('View', [['triage', 'Filter'], ['gallery', 'Gallery']], 'triage', (v) => switchHerMode(v)),
          seg('Show', [['pics', `Pictures ${c.pics}`], ['vids', `Videos ${c.vids}`]], S.triType, (v) => setTriType(v)),
          seg('Sort', [['name', 'Name'], ['newest', 'Newest'], ['largest', 'Largest']], S.pSort, (v) => { if (v !== S.pSort) { S.pSort = v; reloadTriage(); } }),
          { label: 'Filter', items: [{ id: 'kept', label: 'Show kept too', active: S.showKept, onClick: () => { S.showKept = !S.showKept; if (focus) { focus.setList(herList(), focus.current); updateStatus(); } buildMenu(); } }] },
          shapeRow,
        ],
        actions: [{ id: 'undo', label: 'Undo   X', onClick: () => undo() }, ...actions],
        legend: ['A keep · B delete · X undo · Y back', 'Grip: throw up (keep) or down (delete)', ...keys],
      });
    }
    updateStatus();
  }
  function setTriType(t) { if (t === S.triType) return; S.triType = t; reloadTriage(); }
  async function reloadTriage() {
    if (S.level !== 'her' || S.herMode !== 'triage') return;
    retire(focus); focus = null;
    setNote(`Loading ${S.her.name}…`);
    buildMenu();
    if (await loadHer()) showHer({ focusAt: 0 });
  }
  function setShape(s) {
    if (s === S.shape) return;
    S.shape = s;
    saveSettings({ shape: s });
    if (S.level === 'library') { const old = lib; lib = makeLibrary(old ? old.nearestIndex() : 0); swapIn(old, lib, false); }
    else if (her) showHer({ focusAt: her.nearestIndex() });
    buildMenu();
  }

  // ---------- buttons and sticks ----------
  //  right: A keep, B delete (viewer: close), stick press recentre;  left: X undo, Y back (viewer: close), stick press panel
  app.on('button', ({ hand, name }) => {
    const triage = S.level === 'her' && S.herMode === 'triage' && !S.viewer;
    if (name === 'stick') { if (hand === 'left') summonPanel(); else recentre(); }
    else if (name === 'y') goBack();
    else if (name === 'a') { if (triage) decide('keep'); }
    else if (name === 'b') { if (S.viewer) closeViewer(); else if (triage) decide('delete'); }
    else if (name === 'x') { if (triage) undo(); }
  });
  app.on('key', (e) => {
    if (e.key === 'r' || e.key === 'R') recentre();
    if (e.key === 'm' || e.key === 'M') summonPanel();
    if (e.key === 'Backspace') goBack();
    // on a screen the arrow keys step one by one (the keyboard repeats them); in the headset the stick does
    const d = { ArrowRight: 1, ArrowLeft: -1, d: 1, a: -1, D: 1, A: -1 }[e.key];
    if (d && focus) step(d);
  });
  let held = 0, nextAt = 0;
  function updateSticks(dt, t) {
    const x = Math.abs(app.sticks.right.x) >= Math.abs(app.sticks.left.x) ? app.sticks.right.x : app.sticks.left.x;
    if (focus) {
      if (!renderer.xr.isPresenting) return; // keys step on their own (above)
      if (Math.abs(x) > 0.65) {
        if (!held) { held = Math.sign(x); nextAt = t + 0.45; step(held); }
        else if (t > nextAt) { nextAt = t + 0.2; step(held); }
      } else if (Math.abs(x) < 0.3) held = 0;
      return;
    }
    band()?.stick(dt, x);
  }

  // ---------- start ----------
  const savedPanel = Array.isArray(settings.panel) && settings.panel.length === 3 && settings.panel.every(Number.isFinite) ? settings.panel : null;
  if (savedPanel && new THREE.Vector3().fromArray(savedPanel).length() < 3) { menu.root.position.fromArray(savedPanel); billboard(); }
  else placePanel(-28, -21, 0.72); // below-left of the view centre
  if (flags.panel === 'moved') placePanel(30, -4, 0.85);
  if (flags.panel === 'front') placePanel(0, -14, 0.6);
  if (S.view === 'genres') ensureGenres();
  S.libAt = Math.max(0, (flags.at || 1) - 1);
  if (flags.show) { if (flags.show === 'vids') S.triType = 'vids'; S.show = flags.show; }
  showLibrary({ instant: true });

  // the screenshot flags: open a piece, a picture in the viewer, a file in focus, a hovered piece
  const ready = (async () => {
    const wait = S.view === 'filter' ? filterPromise : S.view === 'genres' ? ensureGenres() : basePromise;
    await wait;
    if (disposed || renderer.xr.isPresenting) return;
    if (flags.open > 0 && lib && lib.count) {
      const it = lib.items[(flags.open - 1) % lib.count];
      const ok = it.genre ? await openGenre(it.genre, { instant: true }) : await openPerformer(it.perf, S.view === 'filter' ? 'triage' : 'gallery', { instant: true });
      if (!ok || disposed) return;
      if (flags.focus > 0 && focus) { focus.setFocus(flags.focus - 1, { instant: true }); updateStatus(); }
      if (flags.viewer > 0 && her) { S.viewer = true; showHer({ instant: true, focusAt: flags.viewer - 1 }); }
    }
    if (flags.hover > 0) {
      if (focus) { const it = focus.list[flags.hover - 1]; const n = it && focus.nodes.get(it); if (n) n.on = true; }
      else { const B = band(); const pc = B && B.pieceOf(flags.hover - 1); if (pc) { B.update(0); pc.on = true; } }
    }
  })();

  app.onFrame((dt, t) => {
    updateArmed();
    updateBothGrips();
    updateRecentre();
    updateSticks(dt, t);
    if (grab && grab.entry) {
      const p = grab.entry.controller.getWorldPosition(tmpV).sub(grab.start);
      moveGrab(p.dot(stageUp()) * 1.6);
    } else if (!grab && focus && Math.abs(focus.grabY) > 0.0005) focus.grabY *= Math.exp(-dt * 14);
    if (press) press.band.dragTo(rayYaw(press.src));
    updatePanelGrab();
    const opts = { hoverOK: !grab && !press, fadeMul: stageFade };
    for (const o of [lib, her]) o?.update(dt, opts);
    // levels that are fading out are no longer referenced; they finish (and dispose themselves) here
    for (const o of leaving) { o.update(dt, opts); if (o.disposed) leaving.delete(o); }
    focus?.update(dt, opts);
    note.material.opacity = stageFade;
  });

  const handle = {
    ready,
    /** start the headset session (call from a click) */
    enterVR: () => app.enterXR(),
    exitVR: () => app.exitXR(),
    /** render and take input on this screen (look-around mode), or rest */
    setActive(on) { app.setActive(on); if (!on) player.pause(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      timers.forEach((id) => clearTimeout(id)); timers.clear();
      player.close();
      for (const o of [lib, her, focus, ...leaving]) o?.dispose();
      lib = her = focus = null; leaving.clear();
      menu.dispose();
      disposeTree(note);
      disc.geometry.dispose(); disc.material.dispose();
      tex.dispose();
      assets.dispose();
      app.dispose();
      if (window.__vrSalon === testHook) delete window.__vrSalon;
    },
  };
  // for tests and screenshots only (?test=1): the state and a few actions, never a decision
  const testHook = flags.test ? {
    get S() { return S; }, get lib() { return lib; }, get her() { return her; }, get focus() { return focus; },
    ready, goBack, step, setShape, closeViewer, openViewer, recentre, summonPanel,
  } : null;
  if (testHook) window.__vrSalon = testHook;
  return handle;
}
