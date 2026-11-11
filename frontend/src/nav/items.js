/**
 * Navigation items: the sections (desktop bar, phone tabs) and the More groups (desktop More menu, phone More sheet).
 *
 * An item: { id, label, hint, to | href | action, icon, match?, phone?: 'yes' | 'disabled' | 'no', phoneReason? }
 *   to      an app route (a RouterLink)
 *   href    a static page of the app (/profile.html): a plain link in the same tab
 *   action  'sceneEditor', run by useNavAction (nav/actions.js still accepts 'settings')
 *   match   route patterns that make the item active (default [to])
 * Renderers add a first group "Pages" with the sections that are not visible elsewhere.
 */
import { matchPath } from 'react-router-dom';
import PhotoLibraryOutlined from '@mui/icons-material/PhotoLibraryOutlined';
import PeopleOutline from '@mui/icons-material/PeopleOutline';
import TravelExplore from '@mui/icons-material/TravelExplore';
import StarOutline from '@mui/icons-material/StarOutline';
import ScienceOutlined from '@mui/icons-material/ScienceOutlined';
import FolderOpen from '@mui/icons-material/FolderOpen';
import CompareArrows from '@mui/icons-material/CompareArrows';
import Collections from '@mui/icons-material/Collections';
import PersonSearch from '@mui/icons-material/PersonSearch';
import Compare from '@mui/icons-material/Compare';
import Waves from '@mui/icons-material/Waves';
import Videocam from '@mui/icons-material/Videocam';
import ViewInAr from '@mui/icons-material/ViewInAr';
import ListAlt from '@mui/icons-material/ListAlt';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import { ROUTES } from './routes';

export const MORE_GROUPS = Object.freeze([
  {
    id: 'library',
    label: 'Library',
    items: [
      { id: 'import', label: 'Import', hint: 'Folders from the server or this computer', to: '/local-import', icon: FolderOpen }
    ]
  },
  {
    id: 'rate',
    label: 'Rate',
    items: [
      { id: 'group-rate', label: 'Group Rate', hint: 'All performers, best first; each button records a duel', to: '/group-rate', icon: CompareArrows },
      { id: 'rank-pictures', label: 'Rank pictures', hint: 'Pick the better of two pictures; pairs train the models', to: '/ranking-insight', match: ['/ranking-insight', '/pairwise-rank'], icon: Collections }
    ]
  },
  {
    id: 'ai',
    label: 'AI',
    items: [
      { id: 'profile', label: 'Profile page', hint: 'Judge scraped profiles for the P model', href: '/profile.html', icon: PersonSearch },
      { id: 'duels', label: 'Profile duels', hint: 'Who do you like more', href: '/profile.html#duels', icon: Compare }
    ]
  },
  {
    id: 'tools',
    label: 'Tools',
    items: [
      { id: 'funpipe', label: 'Funscripts', hint: 'Funscript library and review', to: '/funpipe', icon: Waves },
      {
        id: 'scene-editor', label: 'Scene editor…', hint: 'Mark the scenes of a video', action: 'sceneEditor', icon: Videocam,
        match: ['/scene-editor'], phone: 'disabled', phoneReason: 'Desktop only: opens a video by its path'
      },
      {
        id: 'vr', label: 'VR', hint: 'Open this page on a headset', to: '/vr', icon: ViewInAr,
        phone: 'disabled', phoneReason: 'Open it on a headset'
      }
    ]
  },
  {
    id: 'system',
    label: 'System',
    items: [
      { id: 'jobs', label: 'Jobs', hint: 'Everything running in the background', to: '/jobs', icon: ListAlt },
      { id: 'settings', label: 'Settings', hint: 'Library, tags, keys, workers, space, system', to: '/settings', match: ['/settings', '/settings/:section'], icon: SettingsOutlined }
    ]
  }
]);

// Routes that have their own More item, so a section item is not active on them as well.
const OWN_ITEM = new Set(MORE_GROUPS.flatMap((g) => g.items.flatMap((it) => it.match || (it.to ? [it.to] : []))));

/** A section item is active on every route of its section that has no More item of its own. */
const sectionMatch = (id) => ROUTES.filter((rt) => rt.section === id && !OWN_ITEM.has(rt.pattern)).map((rt) => rt.pattern);

const section = (id, label, to, icon) => ({ id, label, to, icon, match: sectionMatch(id) });

export const SECTIONS = Object.freeze([
  section('library', 'Library', '/', PhotoLibraryOutlined),
  section('performers', 'Performers', '/performer-management', PeopleOutline),
  section('discover', 'Discover', '/discover', TravelExplore),
  section('rate', 'Rate', '/smart-compare', StarOutline),
  section('ai', 'AI & Training', '/ai-training', ScienceOutlined)
]);

/** The phone's bottom tabs, in order; More comes after them. */
export const PHONE_TABS = Object.freeze(['library', 'rate', 'discover']);

/** True when pathname matches item.match || [item.to]. href and action items are active only through match. */
export function itemActive(item, pathname) {
  if (!item) return false;
  const patterns = item.match || (item.to ? [item.to] : []);
  const path = pathname || '/';
  return patterns.some((p) => !!matchPath({ path: p, end: true }, path));
}
