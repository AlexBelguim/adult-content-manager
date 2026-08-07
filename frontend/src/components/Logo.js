import React from 'react';

/**
 * The Darkroom mark: three frames, the middle one lit.
 *
 * Inline SVG rather than an <img src="logo.svg"> on purpose — the fills are
 * var(--dim) and var(--accent), so the mark follows whichever theme is active
 * instead of being a fixed-colour image that goes wrong on a light shell. An
 * <img> gets its own document and cannot see the page's custom properties.
 *
 * Geometry lives on a 32x32 grid so it stays aligned at every size the app
 * uses, down to a 16px favicon. scripts/build-icons.mjs rasterises the same
 * numbers for the PNG/ICO set — if these rects change, that file changes too.
 */
function Logo({ size = 26, title = 'Darkroom', ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label={title}
      focusable="false"
      style={{ display: 'block', flex: 'none' }}
      {...props}
    >
      <rect x="3" y="9" width="7" height="15" rx="2" fill="var(--dim)" fillOpacity="0.5" />
      <rect x="12.5" y="5" width="7" height="23" rx="2" fill="var(--accent)" />
      <rect x="22" y="9" width="7" height="15" rx="2" fill="var(--dim)" fillOpacity="0.5" />
    </svg>
  );
}

export default Logo;
