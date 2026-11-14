// The search keyboard: a floating QWERTY with digits, Space, Backspace, Clear and Done, big keys you point at. A field
// on top shows what is typed and how many match. On a screen a real keyboard types into it while it is open (the
// runtime hands it the keys: see app.captureKeys). It lives in the stage, in front of you and a little below.
import * as THREE from 'three';
import { C } from './palette';
import { makeButton, makeText, panel, disposeTree } from './kit';

const ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const K = 0.058, GAP = 0.008, PAD = 0.016, MAX_LEN = 40;

export class Keyboard {
  /** onChange(text) on every key; onDone() for Done (or Enter / Escape on a real keyboard) */
  constructor(app, parent, { onChange, onDone }) {
    this.app = app; this.onChange = onChange; this.onDone = onDone;
    this.root = new THREE.Group(); this.root.name = 'keyboard'; this.root.visible = false;
    parent.add(this.root);
    this.value = ''; this.count = null; this.regs = [];
    const W = 10 * K + 9 * GAP + 2 * PAD;
    this.W = W;
    let y = -PAD;
    // the field: what is typed, and the matches
    this.field = makeText('', { w: W - 2 * PAD - 0.13, h: 0.06, size: 0.028, res: 2600, pad: 0.012 });
    const fieldBg = panel(W - 2 * PAD, 0.064, { r: 0.012, color: C.bg, opacity: 1 });
    fieldBg.position.set(0, y - 0.032, 0.001);
    this.field.position.set(-0.065, y - 0.032, 0.003);
    this.matches = makeText('', { w: 0.13, h: 0.06, size: 0.02, res: 2600, align: 'right', color: C.dim, pad: 0.012 });
    this.matches.position.set((W - 2 * PAD) / 2 - 0.065, y - 0.032, 0.003);
    this.root.add(fieldBg, this.field, this.matches);
    y -= 0.064 + 0.014;
    const key = (label, w, onClick, o = {}) => {
      const b = makeButton(label, { w, h: K, size: o.size || 0.03, res: 2600, r: 0.01, weight: 600, ...o });
      b.position.z = 0.002;
      this.root.add(b);
      app.pointer.add(b, { onClick: () => { if (this.root.visible) onClick(); } });
      this.regs.push(b);
      return b;
    };
    ROWS.forEach((row, r) => {
      const rw = row.length * K + (row.length - 1) * GAP + (r === 3 ? GAP + 2 * K + GAP : 0);
      let x = -rw / 2;
      for (const ch of row) { const b = key(ch, K, () => this.type(ch)); b.position.set(x + K / 2, y - K / 2, 0.002); x += K + GAP; }
      if (r === 3) { const b = key('⌫', 2 * K + GAP, () => this.back(), { size: 0.03 }); b.position.set(x + K + GAP / 2, y - K / 2, 0.002); }
      y -= K + GAP;
    });
    // the last row: Clear, Space, Done
    const cw = 2 * K + GAP, dw = 2 * K + GAP, sw = 10 * K + 9 * GAP - cw - dw - 2 * GAP;
    let x = -(10 * K + 9 * GAP) / 2;
    const clear = key('Clear', cw, () => this.set(''), { size: 0.022, base: C.action, hover: C.actionHover });
    clear.position.set(x + cw / 2, y - K / 2, 0.002); x += cw + GAP;
    const space = key('Space', sw, () => this.type(' '), { size: 0.022 });
    space.position.set(x + sw / 2, y - K / 2, 0.002); x += sw + GAP;
    const done = key('Done', dw, () => this.onDone?.(), { size: 0.024, base: C.accent, hover: C.accentHover, textColor: C.onAccent });
    done.position.set(x + dw / 2, y - K / 2, 0.002);
    y -= K + PAD;
    const H = -y;
    const bg = panel(W, H, { r: 0.02, color: C.surface, opacity: 0.97 });
    const rim = panel(W + 0.004, H + 0.004, { r: 0.022, color: C.line });
    bg.position.set(0, -H / 2, 0); rim.position.set(0, -H / 2, -0.0008);
    this.root.add(rim, bg);
    app.pointer.add(bg, { onClick: () => {} }); this.regs.push(bg); // the ray stops on it
    // centre it on its origin
    this.root.children.forEach((o) => { o.position.y += H / 2; });
    this.root.traverse((o) => { if (o.isMesh) o.renderOrder = Math.max(o.renderOrder, 22); });
    rim.renderOrder = 20; bg.renderOrder = 21;
    this.H = H;
    this.paint();
  }

  get open() { return this.root.visible; }
  show(value = '') { this.value = value; this.root.visible = true; this.paint(); }
  hide() { this.root.visible = false; }
  setCount(n) { this.count = n; this.paint(); }

  type(ch) { if (this.value.length >= MAX_LEN) return; this.set(this.value + ch); }
  back() { if (this.value) this.set(this.value.slice(0, -1)); }
  set(v) { this.value = v; this.paint(); this.onChange?.(this.value); }

  /** a real keyboard key while open (flat mode): true when it was used */
  key(e) {
    if (e.key === 'Enter' || e.key === 'Escape') { this.onDone?.(); return true; }
    if (e.key === 'Backspace') { this.back(); return true; }
    if (e.key === 'Delete') { this.set(''); return true; }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { this.type(e.key.toLowerCase()); return true; }
    return false;
  }

  paint() {
    const v = this.value;
    this.field.setText(v ? [{ t: v, c: C.text }, { t: '|', c: C.accent, w: 400 }] : [{ t: 'Type a name', c: C.muted }, { t: ' |', c: C.accent, w: 400 }]);
    this.matches.setText(v && this.count != null ? (this.count === 1 ? '1 match' : `${this.count} matches`) : '', this.count === 0 ? C.bad : C.dim);
  }

  dispose() {
    for (const m of this.regs) this.app.pointer.remove(m);
    disposeTree(this.root);
    this.root.parent?.remove(this.root);
  }
}
