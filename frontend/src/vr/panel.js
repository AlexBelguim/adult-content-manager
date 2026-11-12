// The control panel: a floating panel you can grab by its handle bar and put anywhere (it then faces you).
// Clicked with either controller's ray. Origin = the centre of the panel.
// Built from a spec, rebuilt when the level or a setting changes; setSub() only repaints the sub line.
import * as THREE from 'three';
import { C } from './palette';
import { makeText, makeButton, panel, disposeTree } from './kit';

const W = 0.33, PAD = 0.014, RES = 3400, IN = W - 2 * PAD, LABEL_W = 0.046;
const ROW_H = 0.034, BTN = { size: 0.0128, res: RES };

export function createPanel(app) {
  const root = new THREE.Group();
  root.name = 'panel';
  let content = null, regs = [], refs = {};
  let H = 0.2, handle = null, onHandle = null;

  function clear() {
    for (const m of regs) app.pointer.remove(m);
    regs = []; refs = {}; handle = null;
    if (content) { disposeTree(content); root.remove(content); content = null; }
  }
  const reg = (m, onClick) => { app.pointer.add(m, { onClick }); regs.push(m); return m; };

  /**
   * spec: { title, sub, back: fn|null, rows: [{ label, items: [{ id, label, active, onClick, size? }] }],
   *         actions: [{ id, label, onClick }], legend: [str] }
   */
  function build(spec) {
    clear();
    content = new THREE.Group();
    root.add(content);
    const inner = new THREE.Group();
    content.add(inner);
    let y = -PAD;
    const place = (obj, h, x = 0) => { obj.position.set(x, y - h / 2, 0.002); inner.add(obj); y -= h; return obj; };
    const gap = (g) => { y -= g; };

    // header: Back + title
    {
      const row = new THREE.Group();
      const hasBack = !!spec.back;
      const bw = 0.074;
      const title = makeText(spec.title || '', { w: IN - (hasBack ? bw + 0.008 : 0), h: 0.03, size: 0.0175, weight: 700, res: RES, pad: 0 });
      title.position.x = hasBack ? (bw + 0.008) / 2 : 0;
      row.add(title);
      if (hasBack) {
        const b = makeButton('‹  Back', { w: bw, h: ROW_H, ...BTN });
        b.position.x = -IN / 2 + bw / 2; row.add(b); reg(b, spec.back);
      }
      place(row, ROW_H);
      refs.title = title;
    }
    refs.sub = place(makeText(spec.sub || '', { w: IN, h: 0.022, size: 0.0125, color: C.dim, res: RES, pad: 0 }), 0.022);
    gap(0.008);
    const items = {};
    refs.items = items;
    for (const r of spec.rows) {
      const row = new THREE.Group();
      const lab = makeText(r.label, { w: LABEL_W, h: ROW_H, size: 0.0115, color: C.muted, weight: 600, res: RES, pad: 0 });
      lab.position.x = -IN / 2 + LABEL_W / 2; row.add(lab);
      const avail = IN - LABEL_W, g = 0.005, n = r.items.length;
      // widths follow the labels, so a long one ("Most pictures") gets the room it needs
      const wt = r.items.map((it) => it.label.length + 7), sum = wt.reduce((a, b) => a + b, 0);
      let x = -IN / 2 + LABEL_W;
      r.items.forEach((it, i) => {
        const bw = ((avail - g * (n - 1)) * wt[i]) / sum;
        const b = makeButton(it.label, { w: bw, h: ROW_H, ...BTN, size: it.size || BTN.size });
        b.position.x = x + bw / 2; x += bw + g;
        b.setActive(it.active);
        row.add(b); reg(b, it.onClick);
        items[it.id] = b;
      });
      place(row, ROW_H);
      gap(0.006);
    }
    if (spec.actions?.length) {
      gap(0.002);
      const row = new THREE.Group(), n = spec.actions.length, g = 0.006, bw = (IN - g * (n - 1)) / n;
      spec.actions.forEach((a, i) => {
        const b = makeButton(a.label, { w: bw, h: 0.038, ...BTN, base: C.action, hover: C.actionHover });
        b.position.x = -IN / 2 + bw / 2 + i * (bw + g); row.add(b); reg(b, a.onClick); items[a.id] = b;
      });
      place(row, 0.038);
      gap(0.008);
    }
    for (const l of spec.legend || []) place(makeText(l, { w: IN, h: 0.019, size: 0.0112, color: C.dim, res: RES, pad: 0 }), 0.019);
    y -= PAD - 0.003;
    H = -y;
    inner.position.y = H;
    const bg = panel(W, H, { r: 0.018, color: C.surface, opacity: 0.97 });
    const rim = panel(W + 0.004, H + 0.004, { r: 0.02, color: C.line });
    bg.position.set(0, H / 2, 0); rim.position.set(0, H / 2, -0.0008);
    const accent = panel(0.05, 0.004, { r: 0.002, color: C.accent });
    accent.position.set(-W / 2 + PAD + 0.025, H - 0.006, 0.001);
    content.add(rim, bg, accent);
    reg(bg, () => {}); // the ray stops on the panel
    // the handle bar on top: grab here (grip or trigger) to move the panel
    const HH = 0.032;
    handle = panel(W, HH, { r: 0.012, color: C.handle, opacity: 0.97 });
    handle.position.set(0, H + 0.006 + HH / 2, 0);
    const grip = makeText('', { w: 0.2, h: HH, size: 0.012, res: RES, pad: 0, align: 'center', color: C.dim });
    grip.setText('Move', C.dim);
    grip.position.z = 0.001; handle.add(grip);
    for (const x0 of [-W / 2 + 0.02, W / 2 - 0.036]) for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      const d = panel(0.004, 0.004, { r: 0.002, color: C.dim }); d.position.set(x0 + i * 0.008, (j - 0.5) * 0.009, 0.001); handle.add(d);
    }
    const h0 = handle;
    handle.userData.hover = (on) => { h0.material.color.set(on ? C.handleHover : C.handle); grip.setText('Move', on ? C.accent : C.dim); };
    content.add(handle);
    app.pointer.add(handle, { onClick: (hit, src) => onHandle?.(src, hit) }); regs.push(handle);
    content.traverse((o) => { if (o.isMesh) o.renderOrder = Math.max(o.renderOrder, 12); });
    rim.renderOrder = 10; bg.renderOrder = 11;
    content.position.y = -(H + 0.038) / 2; // centre the whole panel (with its handle) on the origin
  }

  return {
    root, build,
    get H() { return H; }, W,
    get handle() { return handle; },
    set onHandle(fn) { onHandle = fn; },
    setSub(s) { refs.sub?.setText(s); },
    setTitle(s) { refs.title?.setText(s); },
    setActive(id, on) { refs.items?.[id]?.setActive(on); },
    setLabel(id, s) { refs.items?.[id]?.setLabel(s); },
    contains(o) { while (o) { if (o === root) return true; o = o.parent; } return false; },
    dispose() { clear(); root.parent?.remove(root); },
  };
}
