// The three.js runtime of the VR screen: renderer, WebXR session, controllers and hands, the pointer (controller rays in
// the headset, the mouse on a screen), sticks and buttons, flat-mode drag-to-look, and the frame loop.
//
//   const app = createRuntime(container, { yaw, pitch });
//   app.scene / camera / player; app.pointer.add(mesh, { onClick(hit, src), onHover(on, hit) }); app.onFrame((dt, t) => {})
//   app.on('button', ({ hand, name }) => {})   names: a b x y stick
//   app.sticks.right.x; app.say(text, ms); app.listen(target, type, fn, opts)   (removed on dispose)
//   await app.enterXR(); app.setActive(on); app.dispose()
//
// Coordinates: metres; the player stands at the origin of app.player (a group the camera and controllers live in),
// looking down -z, eyes at about 1.6 m. Flat mode (no headset): drag to look, wheel = right stick y, arrow keys /
// WASD = sticks, click = trigger, keys 1-4 = A, B, X, Y. Input is only read while the runtime is active.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/examples/jsm/webxr/XRHandModelFactory.js';
import { C } from './palette';
import { makeText } from './kit';

/** the controller models come from a CDN; without internet they are simply not shown (the stock loader throws) */
class QuietGLTFLoader extends GLTFLoader {
  load(url, onLoad, onProgress) {
    return super.load(url, onLoad, onProgress, (e) => console.warn('[VR] controller model not loaded', e?.message || e));
  }
}

export function createRuntime(container, { yaw: yaw0 = 0, pitch: pitch0 = 0, eye = 1.6 } = {}) {
  const cleanups = [];
  const listen = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); cleanups.push(() => target.removeEventListener(type, fn, opts)); };
  const size = () => ({ w: Math.max(1, container.clientWidth || window.innerWidth), h: Math.max(1, container.clientHeight || window.innerHeight) });

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const s0 = size();
  renderer.setSize(s0.w, s0.h);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');
  renderer.xr.setFoveation(0.5);
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.touchAction = 'none';
  container.appendChild(renderer.domElement);
  const canvas = renderer.domElement;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(C.bg);
  const player = new THREE.Group();
  scene.add(player);
  const camera = new THREE.PerspectiveCamera(70, s0.w / s0.h, 0.02, 200);
  camera.position.set(0, eye, 0);
  player.add(camera);
  const resizeFns = [];
  const onResize = () => {
    if (renderer.xr.isPresenting) return;
    const s = size();
    camera.aspect = s.w / s.h; camera.updateProjectionMatrix(); renderer.setSize(s.w, s.h);
    resizeFns.forEach((fn) => fn());
  };
  listen(window, 'resize', onResize);

  // a short notice under the view (it follows the head)
  const notice = makeText('', { w: 0.9, h: 0.06, size: 0.026, align: 'center', color: C.text, res: 1600 });
  const noticeBg = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.06), new THREE.MeshBasicMaterial({ color: C.surface, transparent: true, opacity: 0.9, depthWrite: false }));
  noticeBg.position.z = -0.001; notice.add(noticeBg);
  notice.renderOrder = 41; noticeBg.renderOrder = 40;
  notice.material.depthTest = false; noticeBg.material.depthTest = false;
  notice.visible = false; notice.position.set(0, -0.32, -1.1); camera.add(notice);
  let noticeUntil = 0;
  const say = (str, ms = 2500, tone = null) => {
    notice.setText(str, tone === 'bad' ? C.bad : C.text);
    noticeBg.material.color.set(tone === 'bad' ? C.del : C.surface);
    notice.visible = true; noticeUntil = performance.now() + ms;
  };

  // ---- pointer: rays from controllers (XR) or the mouse (flat) ----
  const targets = new Map(); // mesh -> { onClick, onHover }
  const raycaster = new THREE.Raycaster();
  const pointer = {
    add(mesh, h = {}) { targets.set(mesh, h); return mesh; },
    remove(mesh) { targets.delete(mesh); for (const [src, m] of hoverOf) if (m === mesh) hoverOf.set(src, null); },
  };
  const visibleChain = (m) => { let o = m; while (o) { if (!o.visible) return false; o = o.parent; } return true; };
  const hitTest = (origin, dir) => {
    raycaster.set(origin, dir);
    raycaster.far = 30;
    const list = [...targets.keys()].filter(visibleChain);
    return raycaster.intersectObjects(list, false)[0] || null;
  };
  const hoverOf = new Map(); // source -> mesh
  const setHover = (src, hit) => {
    const prev = hoverOf.get(src), next = hit ? hit.object : null;
    if (prev === next) { if (next) targets.get(next)?.onMove?.(hit); return; }
    if (prev) { prev.userData.hover?.(false); targets.get(prev)?.onHover?.(false, null); }
    if (next) { next.userData.hover?.(true); targets.get(next)?.onHover?.(true, hit); }
    hoverOf.set(src, next);
  };
  const click = (hit, src) => { if (hit) targets.get(hit.object)?.onClick?.(hit, src); };

  // ---- controllers and hands ----
  const handlers = {};
  const on = (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); };
  const emit = (ev, data) => (handlers[ev] || []).forEach((fn) => fn(data));
  const cmf = new XRControllerModelFactory(new QuietGLTFLoader());
  const hmf = new XRHandModelFactory();
  const controllers = [];
  const rayGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
  const rayMat = new THREE.LineBasicMaterial({ color: C.accent, transparent: true, opacity: 0.8 });
  const dotGeo = new THREE.SphereGeometry(0.008, 12, 8);
  const dotMat = new THREE.MeshBasicMaterial({ color: C.accent });
  for (let i = 0; i < 2; i++) {
    const c = renderer.xr.getController(i);
    const grip = renderer.xr.getControllerGrip(i);
    grip.add(cmf.createControllerModel(grip));
    const hand = renderer.xr.getHand(i);
    hand.add(hmf.createHandModel(hand, 'mesh'));
    const ray = new THREE.Line(rayGeo, rayMat);
    ray.scale.z = 5; c.add(ray);
    const dot = new THREE.Mesh(dotGeo, dotMat);
    dot.visible = false; scene.add(dot);
    const entry = { index: i, controller: c, grip, hand, ray, dot, handedness: null, hit: null };
    listen(c, 'connected', (e) => { entry.handedness = e.data.handedness; entry.source = e.data; ray.visible = !e.data.hand; });
    listen(c, 'disconnected', () => { entry.handedness = null; entry.source = null; });
    listen(c, 'selectstart', () => { emit('select', { hand: entry.handedness, entry }); click(entry.hit, entry); });
    player.add(c, grip, hand);
    controllers.push(entry);
  }

  // ---- sticks and buttons (XR gamepads, or keyboard / wheel in flat mode) ----
  let active = false;
  const sticks = { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } };
  const keys = new Set();
  let wheel = 0;
  const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '');
  listen(window, 'keydown', (e) => {
    if (!active || typing(e)) return;
    keys.add(e.key.toLowerCase());
    const b = { 1: 'a', 2: 'b', 3: 'x', 4: 'y' }[e.key];
    if (b) emit('button', { hand: b === 'a' || b === 'b' ? 'right' : 'left', name: b });
    emit('key', e);
  });
  listen(window, 'keyup', (e) => keys.delete(e.key.toLowerCase()));
  listen(window, 'blur', () => keys.clear());
  listen(canvas, 'wheel', (e) => { if (active) wheel += e.deltaY > 0 ? 1 : -1; }, { passive: true });
  const prevPressed = new Map();
  const NAMES = { right: { 4: 'a', 5: 'b', 3: 'stick' }, left: { 4: 'x', 5: 'y', 3: 'stick' } };
  const readPads = () => {
    sticks.left.x = sticks.left.y = sticks.right.x = sticks.right.y = 0;
    const session = renderer.xr.getSession();
    if (session) {
      for (const src of session.inputSources) {
        const gp = src.gamepad; if (!gp || !src.handedness) continue;
        const st = sticks[src.handedness]; if (!st) continue;
        st.x = Math.abs(gp.axes[2] || 0) > 0.15 ? gp.axes[2] : 0;
        st.y = Math.abs(gp.axes[3] || 0) > 0.15 ? gp.axes[3] : 0;
        gp.buttons.forEach((b, i) => {
          const k = `${src.handedness}${i}`, was = prevPressed.get(k);
          if (b.pressed && !was) { const name = NAMES[src.handedness]?.[i]; if (name) emit('button', { hand: src.handedness, name }); }
          prevPressed.set(k, b.pressed);
        });
      }
    } else {
      const k = (a, b) => (keys.has(a) || keys.has(b) ? 1 : 0);
      sticks.right.x = k('arrowright', 'd') - k('arrowleft', 'a');
      sticks.right.y = k('arrowdown', 's') - k('arrowup', 'w') + Math.sign(wheel);
      wheel *= 0.5; if (Math.abs(wheel) < 0.5) wheel = 0;
    }
  };

  // ---- flat mode: drag to look, click to point ----
  let yaw = THREE.MathUtils.degToRad(yaw0), pitch = THREE.MathUtils.degToRad(pitch0);
  let drag = null;
  const mouse = new THREE.Vector2(-9, -9);
  const toNDC = (e, out) => { const r = canvas.getBoundingClientRect(); return out.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); };
  const setMouse = (e) => toNDC(e, mouse);
  listen(canvas, 'pointerdown', (e) => { if (!active) return; setMouse(e); drag = { x: e.clientX, y: e.clientY, moved: false }; });
  listen(window, 'pointermove', (e) => {
    if (!active) return;
    setMouse(e);
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    yaw -= dx * 0.004; pitch = THREE.MathUtils.clamp(pitch - dy * 0.004, -1.4, 1.4);
    drag.x = e.clientX; drag.y = e.clientY;
  });
  listen(window, 'pointerup', () => {
    if (drag && !drag.moved && active && !renderer.xr.isPresenting) {
      raycaster.setFromCamera(mouse, camera);
      click(hitTest(raycaster.ray.origin, raycaster.ray.direction), { handedness: 'right', mouse: true });
    }
    drag = null;
  });
  listen(canvas, 'pointerleave', () => { if (!drag) mouse.set(-9, -9); });

  // ---- the frame loop ----
  const frameFns = [];
  const clock = new THREE.Clock();
  const tmpO = new THREE.Vector3(), tmpD = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
  const frame = () => {
    const dt = Math.min(0.1, clock.getDelta()), t = clock.elapsedTime;
    readPads();
    if (renderer.xr.isPresenting) {
      for (const c of controllers) {
        if (!c.handedness) { c.dot.visible = false; continue; }
        c.controller.getWorldPosition(tmpO);
        c.controller.getWorldQuaternion(tmpQ);
        tmpD.set(0, 0, -1).applyQuaternion(tmpQ);
        const hit = hitTest(tmpO, tmpD);
        c.hit = hit;
        setHover(c, hit);
        c.ray.scale.z = hit ? hit.distance : 5;
        c.dot.visible = !!hit; if (hit) c.dot.position.copy(hit.point);
      }
    } else {
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
      raycaster.setFromCamera(mouse, camera);
      setHover('mouse', hitTest(raycaster.ray.origin, raycaster.ray.direction));
    }
    if (notice.visible && performance.now() > noticeUntil) notice.visible = false;
    for (const fn of frameFns) fn(dt, t);
    renderer.render(scene, camera);
  };
  const setLoop = () => renderer.setAnimationLoop(active || renderer.xr.isPresenting ? frame : null);

  // ---- the XR session ----
  let session = null;
  listen(renderer.xr, 'sessionend', () => {
    session = null; prevPressed.clear();
    onResize(); setLoop();
    emit('xrend', {});
  });
  listen(renderer.xr, 'sessionstart', () => emit('xrstart', {}));

  return {
    THREE, scene, camera, renderer, player, controllers, sticks, pointer, on, say, listen, canvas,
    onFrame: (fn) => frameFns.push(fn),
    onResize: (fn) => resizeFns.push(fn),
    isXR: () => renderer.xr.isPresenting,
    isActive: () => active,
    toNDC,
    /** the camera's flat-mode pose (radians) */
    setLook(y, p) { yaw = y; pitch = p; },
    /** render (and read input) or not; the XR session renders on its own */
    setActive(on) { active = !!on; if (!active) { keys.clear(); drag = null; mouse.set(-9, -9); } clock.getDelta(); setLoop(); },
    /** start an immersive-vr session (needs a user gesture); resolves when the headset shows the scene */
    async enterXR() {
      if (!navigator.xr) throw new Error('WebXR is not available in this browser');
      const s = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'hand-tracking'] });
      try {
        await renderer.xr.setSession(s);
      } catch (e) {
        s.end().catch(() => {});
        throw e;
      }
      session = s;
      clock.getDelta();
      setLoop();
    },
    exitXR() { if (session) session.end().catch(() => {}); },
    dispose() {
      if (session) session.end().catch(() => {});
      renderer.setAnimationLoop(null);
      cleanups.splice(0).reverse().forEach((fn) => fn());
      frameFns.length = 0; targets.clear();
      for (const k of Object.keys(handlers)) delete handlers[k];
      notice.userData.canvasTex?.dispose(); notice.geometry.dispose(); notice.material.dispose();
      noticeBg.geometry.dispose(); noticeBg.material.dispose();
      rayGeo.dispose(); rayMat.dispose(); dotGeo.dispose(); dotMat.dispose();
      // controller and hand models (glTF from the CDN, if they came)
      for (const c of controllers) {
        for (const o of [c.grip, c.hand]) o.traverse((x) => { x.geometry?.dispose?.(); if (x.material) [].concat(x.material).forEach((m) => { m.map?.dispose?.(); m.dispose(); }); });
      }
      scene.clear();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}

