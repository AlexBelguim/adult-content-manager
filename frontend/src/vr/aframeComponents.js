/**
 * Reusable A-Frame components for the ACM VR mode.
 *
 * `recenter`, `force-laser`, and `system-recenter` are ported verbatim (logic-wise)
 * from the proven prototype in `vr-reference/index.html` — the comments there explain
 * the hard-won WebXR reasoning. `rounded` and `cover-thumb` are new helpers so VR cards
 * match the 2D `PerformerCard` (rounded corners + cover-fit thumbnails, dark placeholder
 * on error, never white).
 *
 * registerVRComponents(AFRAME) is idempotent — safe to call on every VR route mount.
 */
export function registerVRComponents(AFRAME) {
  if (registerVRComponents._done) return;
  const THREE = AFRAME.THREE;
  const reg = (name, def) => {
    if (!AFRAME.components[name]) AFRAME.registerComponent(name, def);
  };

  /* ---- recenter: re-anchor the whole UI on the user's current gaze ----
     The point the user looks at becomes the new center of the layout, including
     pitch (looking up in bed => UI up). Keeps yaw+pitch, drops roll to stay level. */
  reg('recenter', {
    schema: { anchorY: { default: 1.6 } }, // layout's vertical centre = where the head lands
    init() {
      this.world = document.querySelector('#world');
      this.head = document.querySelector('#head');
      this._q = new THREE.Quaternion();
      this._e = new THREE.Euler();
      this._p = new THREE.Vector3();
      this._rot = new THREE.Quaternion();
      this._off = new THREE.Vector3();
      this._anchor = new THREE.Vector3(0, this.data.anchorY, 0);
      window.__recenter = this.recenter.bind(this); // global hook for controller buttons
    },
    update() {
      this._anchor.set(0, this.data.anchorY, 0);
    },
    // Read the LIVE render camera, not the #head entity group. In a WebXR session three.js
    // writes the full headset pose (yaw + PITCH) to the camera object; the entity group only
    // carries the desktop look-controls rotation. Reading the group dropped pitch, so looking
    // straight up + recenter only re-anchored horizontally.
    getHeadCamera() {
      const head = this.head;
      return (head && head.getObject3D && head.getObject3D('camera')) ||
        (this.el.sceneEl && this.el.sceneEl.camera);
    },
    recenter() {
      const cam = this.getHeadCamera();
      const world = this.world && this.world.object3D;
      if (!cam || !world) return;
      cam.getWorldQuaternion(this._q); // getWorld* refreshes matrices internally
      this._e.setFromQuaternion(this._q, 'YXZ'); // yaw=y, pitch=x, roll=z
      // Keep yaw + pitch (so it follows where you look up/down), drop roll to stay level.
      this._rot.setFromEuler(new THREE.Euler(this._e.x, this._e.y, 0, 'YXZ'));
      cam.getWorldPosition(this._p);
      // Orient the layout to the gaze, then place it so the eye-anchor lands on the head:
      //   world.pos = headPos - R * anchor
      world.quaternion.copy(this._rot);
      this._off.copy(this._anchor).applyQuaternion(this._rot);
      world.position.copy(this._p).sub(this._off);
    },
  });

  /* ---- force-laser: guarantee the raycaster line stays visible ----
     laser-controls can drop our line styling on connect; re-assert it. */
  reg('force-laser', {
    init() {
      const enable = () => {
        this.el.setAttribute('raycaster', 'showLine', true);
        this.el.setAttribute('raycaster', 'lineColor', '#007acc');
        this.el.setAttribute('raycaster', 'lineOpacity', 0.9);
      };
      this.el.addEventListener('controllerconnected', enable);
      this.el.addEventListener('controllermodelready', enable);
      [200, 800, 2000].forEach((t) => setTimeout(enable, t));
    },
  });

  /* ---- system-recenter: hook the headset's own recenter gesture ----
     Long-pressing the Quest's Meta button resets the WebXR reference space and fires
     'reset'; re-anchor the UI to the new forward. Deferred via the scene tick because
     requestAnimationFrame is paused during an immersive session. */
  reg('system-recenter', {
    init() {
      this.delay = 0;
      this.el.addEventListener('enter-vr', this.attach.bind(this));
    },
    attach() {
      const xr = this.el.renderer && this.el.renderer.xr;
      const session = xr && xr.getSession && xr.getSession();
      if (!session) return;
      const onReset = () => {
        this.delay = 2;
      };
      const add = (rs) => {
        if (rs && rs.addEventListener) rs.addEventListener('reset', onReset);
      };
      // The renderer's ACTIVE reference space is the one the Meta-button reset fires on.
      try { add(xr.getReferenceSpace && xr.getReferenceSpace()); } catch (e) { /* ignore */ }
      // Also a separately-requested space of the same type (belt and suspenders).
      session
        .requestReferenceSpace('local-floor')
        .then(add)
        .catch(() => session.requestReferenceSpace('local').then(add).catch(() => {}));
    },
    tick() {
      if (this.delay > 0 && --this.delay === 0 && window.__recenter) window.__recenter();
    },
  });

  /* ---- rounded: a rounded-rectangle mesh, reused for card bodies and badges ----
     ShapeGeometry's default UVs are raw vertex coords, so we renormalize them to 0..1
     across the rect — required for cover-thumb's textures to map correctly. */
  reg('rounded', {
    schema: {
      width: { default: 1 },
      height: { default: 1 },
      radius: { default: 0.05 },
      color: { default: '#1a1a1a' },
      opacity: { default: 1 },
    },
    init() {
      this.build();
    },
    update() {
      this.build();
    },
    build() {
      const { width: w, height: h, radius, color, opacity } = this.data;
      const rr = Math.min(radius, w / 2, h / 2);
      const x = -w / 2;
      const y = -h / 2;
      const s = new THREE.Shape();
      s.moveTo(x + rr, y);
      s.lineTo(x + w - rr, y);
      s.quadraticCurveTo(x + w, y, x + w, y + rr);
      s.lineTo(x + w, y + h - rr);
      s.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
      s.lineTo(x + rr, y + h);
      s.quadraticCurveTo(x, y + h, x, y + h - rr);
      s.lineTo(x, y + rr);
      s.quadraticCurveTo(x, y, x + rr, y);
      const geo = new THREE.ShapeGeometry(s);
      const pos = geo.attributes.position;
      const uv = new Float32Array(pos.count * 2);
      for (let i = 0; i < pos.count; i++) {
        uv[i * 2] = (pos.getX(i) - x) / w;
        uv[i * 2 + 1] = (pos.getY(i) - y) / h;
      }
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: opacity < 1,
        opacity,
        side: THREE.DoubleSide,
      });
      this.el.setObject3D('mesh', new THREE.Mesh(geo, mat));
    },
    remove() {
      this.el.removeObject3D('mesh');
    },
  });

  /* ---- cover-thumb: load a texture and cover-fit it onto this entity's mesh ----
     Center-crops via texture repeat/offset (no stretch). On load error the dark
     placeholder color set on the mesh stays — never a white box. */
  reg('cover-thumb', {
    schema: {
      src: { type: 'string' },
      ratio: { default: 1 }, // plane width / height
    },
    init() {
      const el = this.el;
      const data = this.data;
      if (!data.src) return;

      const apply = (mesh, tex) => {
        const imgRatio = tex.image.width / tex.image.height;
        const aspect = imgRatio / (data.ratio || 1);
        let rx = 1;
        let ry = 1;
        if (aspect > 1) rx = 1 / aspect; // image wider than plane -> crop sides
        else ry = aspect; // image taller -> crop top/bottom
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.repeat.set(rx, ry);
        tex.offset.set((1 - rx) / 2, (1 - ry) / 2);
        if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
        else if ('encoding' in tex && THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
        tex.needsUpdate = true;
        mesh.material.map = tex;
        mesh.material.color.set('#ffffff');
        mesh.material.needsUpdate = true;
      };

      // The mesh may be created by the `rounded` component after this init runs.
      const withMesh = (cb) => {
        const m = el.getObject3D('mesh');
        if (m) return cb(m);
        const onSet = (e) => {
          if (e.detail && e.detail.type === 'mesh') {
            el.removeEventListener('object3dset', onSet);
            cb(el.getObject3D('mesh'));
          }
        };
        el.addEventListener('object3dset', onSet);
      };

      new THREE.TextureLoader().load(
        data.src,
        (tex) => withMesh((m) => apply(m, tex)),
        undefined,
        () => {
          /* keep dark placeholder */
        }
      );
    },
  });

  /* ---- vr-tick: bridge A-Frame's per-frame tick to a JS callback ----
     Used to poll controller gamepads directly each XR frame (window.requestAnimationFrame is
     paused during an immersive session, so we ride the scene tick instead). */
  reg('vr-tick', {
    tick(t, dt) {
      if (window.__vrTick) window.__vrTick(t, dt);
    },
  });

  registerVRComponents._done = true;
}
