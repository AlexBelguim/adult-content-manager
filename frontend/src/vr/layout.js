// The band's shapes. Mapping from the band's flat layout (nominal metres: u across, v up) onto the surface around the head.
//   yaw = u / R for both shapes, so scrolling is a rotation about the vertical axis
//   Dome:     pitch = atan(sinh(v / R))  (Mercator: conformal, so true aspect and even gaps are kept)
//   Cylinder: y = v (vertical columns at radius R; each piece tilts to face the eyes)

export const R = 2.6;

export const SHAPES = {
  dome: { vOf: (p) => R * Math.asinh(Math.tan(p)), pOf: (v) => Math.atan(Math.sinh(v / R)) },
  cylinder: { vOf: (p) => R * Math.tan(p), pOf: (v) => Math.atan2(v, R) },
};

/** where a piece sits: { yaw, pitch, dist, w, h } in physical metres; its plane faces the head */
export function mapPiece(pc, shape) {
  const yaw = pc.u / R;
  if (shape === 'cylinder') return { yaw, pitch: Math.atan2(pc.v, R), dist: Math.hypot(R, pc.v), w: pc.w, h: pc.h };
  const S = SHAPES.dome;
  const pt = S.pOf(pc.vTop), pb = S.pOf(pc.vBot);
  const h = 2 * R * Math.tan((pt - pb) / 2);
  return { yaw, pitch: (pt + pb) / 2, dist: R, w: h * (pc.w / pc.h), h };
}
