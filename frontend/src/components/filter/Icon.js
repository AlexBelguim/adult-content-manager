import React from 'react';

const PATHS = {
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  back: 'M19 12H5M12 5l-7 7 7 7',
  check: 'M5 12l5 5 9-10',
  x: 'M6 6l12 12M18 6L6 18',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3',
  move: 'M3 7h6l2 2h10v10H3zM12 12v5M9.5 14.5L12 12l2.5 2.5',
  menu: 'M4 7h16M4 12h16M4 17h16'
};

/** Stroke icons used by the filter view (same set as the mock). */
export default function Icon({ name, size = 20 }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
