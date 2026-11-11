/**
 * The View list of the Rate section: Smart Compare | Group Rate | Rank pictures.
 *
 *   <SidebarPage views={RATE_VIEWS} view="compare" | "list" | "pictures">
 *   <SidebarPage views={rateViews({ list: performers.length })} view="list">   (a page that knows its own count)
 *
 * Each item replaces the history entry, so Back never walks through the views.
 */
import React from 'react';
import CompareArrows from '@mui/icons-material/CompareArrows';
import FormatListNumbered from '@mui/icons-material/FormatListNumbered';
import Collections from '@mui/icons-material/Collections';

export const RATE_VIEWS = [
  { id: 'compare', label: 'Smart Compare', to: '/smart-compare', replace: true, icon: <CompareArrows /> },
  { id: 'list', label: 'Group Rate', to: '/group-rate', replace: true, icon: <FormatListNumbered /> },
  { id: 'pictures', label: 'Rank pictures', to: '/ranking-insight', replace: true, icon: <Collections /> }
];

/** RATE_VIEWS with the counts a page knows: { compare?, list?, pictures? } (a number, or null for none). */
export function rateViews(counts = {}) {
  return RATE_VIEWS.map((v) => (counts[v.id] != null ? { ...v, count: counts[v.id] } : v));
}
