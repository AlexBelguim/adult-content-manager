// Picture textures for one scene: fetched small from the server (/api/files/thumb, resized there), decoded off the main
// thread into ImageBitmaps, shared by key with a reference count, at most 6 loads at a time. When the server has no
// /thumb route yet (its 404 says "No such API route": an older backend), it falls back to /api/files/raw and downscales here.
// Video posters come from /api/files/video-thumbnail. dispose() frees everything, including loads still on the way.
import * as THREE from 'three';
import { api } from './data';

const MAX_ACTIVE = 6;

/** src: { kind: 'image' | 'video', path } */
export function createTextures() {
  const cache = new Map(); // key -> { p: Promise<Texture>, refs }
  let active = 0, dead = false, thumbRoute = null; // null: not known yet; false: missing, use /raw
  const waiting = [];
  const slot = () => (active < MAX_ACTIVE ? Promise.resolve(active++) : new Promise((r) => waiting.push(r)).then(() => active++));
  const free = () => { active--; const n = waiting.shift(); if (n) n(); };
  const keyOf = (src, max) => `${src.kind}|${src.path}|${max}`;

  async function fetchBlob(src, max) {
    if (src.kind === 'image' && thumbRoute !== false) {
      const r = await fetch(api.thumbUrl(src.path, max));
      if (r.ok) { thumbRoute = true; return r.blob(); }
      if (r.status !== 404) throw new Error(`${r.status}`);
      // an older backend has no such route: it answers with its catch-all ("No such API route") or a plain page
      const body = await r.text().catch(() => '');
      if (/No such API route|Cannot GET/i.test(body) || !body.trim().startsWith('{')) thumbRoute = false;
      else throw new Error('404');
    }
    const r = await fetch(src.kind === 'video' ? api.videoThumbUrl(src.path) : api.rawUrl(src.path));
    if (!r.ok) throw new Error(`${r.status}`);
    return r.blob();
  }

  async function load(src, max) {
    await slot();
    try {
      if (dead) throw new Error('disposed');
      const blob = await fetchBlob(src, max);
      // ImageBitmaps ignore texture.flipY, so they are flipped here, when decoded
      const probe = await createImageBitmap(blob);
      const s = Math.min(1, max / Math.max(probe.width, probe.height));
      const bmp = await createImageBitmap(blob, {
        imageOrientation: 'flipY',
        ...(s < 1 ? { resizeWidth: Math.round(probe.width * s), resizeHeight: Math.round(probe.height * s), resizeQuality: 'high' } : {}),
      });
      probe.close();
      if (dead) { bmp.close(); throw new Error('disposed'); }
      const t = new THREE.Texture(bmp);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      t.needsUpdate = true;
      t.userData.aspect = bmp.width / bmp.height;
      return t;
    } finally { free(); }
  }

  const drop = (t) => { t.image?.close?.(); t.dispose(); };

  return {
    /** a texture whose longest side is at most max px; .userData.aspect = w/h. Pair every acquire with a release. */
    acquire(src, max) {
      const key = keyOf(src, max);
      let e = cache.get(key);
      if (!e) {
        e = { p: load(src, max), refs: 0 };
        cache.set(key, e);
        e.p.catch(() => { if (cache.get(key) === e) cache.delete(key); });
      }
      e.refs++;
      return e.p;
    },
    release(src, max) {
      const key = keyOf(src, max);
      const e = cache.get(key);
      if (!e) return;
      e.refs--;
      if (e.refs > 0) return;
      cache.delete(key);
      e.p.then(drop).catch(() => {});
    },
    dispose() {
      dead = true;
      for (const e of cache.values()) e.p.then(drop).catch(() => {});
      cache.clear();
      waiting.splice(0).forEach((n) => n());
    },
  };
}
