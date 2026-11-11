/**
 * Settings as a page: /settings and /settings/<section>.
 *
 * Desktop (900px and wider): /settings goes to /settings/library. SidebarPage: the sections are its View list (the
 * links replace, so Back leaves Settings in one step); a section may add its own sidebar group while it is shown
 * (Space: its figures).
 * Phone: /settings is a list of the sections (links push); /settings/<id> shows one section in SidebarPage, titled by
 * it, with the sections as the tab row (links replace).
 * Every setting saves when it changes (components/settings/kit: useSave, SaveNote).
 */
import React, { useEffect } from 'react';
import { Navigate, Link as RouterLink, useParams } from 'react-router-dom';
import { Box } from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined';
import KeyboardOutlinedIcon from '@mui/icons-material/KeyboardOutlined';
import MemoryOutlinedIcon from '@mui/icons-material/MemoryOutlined';
import StorageOutlinedIcon from '@mui/icons-material/StorageOutlined';
import PaletteOutlinedIcon from '@mui/icons-material/PaletteOutlined';
import SettingsSuggestOutlinedIcon from '@mui/icons-material/SettingsSuggestOutlined';
import { PageShell, PageHeader, SidebarPage, ContentLine } from '../components/layout';
import { useIsPhone } from '../nav';
import { Rows } from '../components/settings/kit';
import LibrarySection from '../components/settings/LibrarySection';
import TagsSection from '../components/settings/TagsSection';
import ShortcutsSection from '../components/settings/ShortcutsSection';
import WorkersSection from '../components/settings/WorkersSection';
import SpacePage from './SpacePage';
import AppearanceSection from '../components/settings/AppearanceSection';
import SystemSection from '../components/settings/SystemSection';

export const SETTINGS_SECTIONS = [
  { id: 'library', label: 'Library', hint: 'Folder, what Delete does, folder check', Component: LibrarySection },
  { id: 'tags', label: 'Tags', hint: 'Content folders and their rules', Component: TagsSection },
  { id: 'shortcuts', label: 'Shortcuts', hint: 'Keys in the Filter view', Component: ShortcutsSection },
  { id: 'workers', label: 'Workers', hint: 'Coordinator, acm-gpu, scenetest, re-encode workers', Component: WorkersSection },
  { id: 'space', label: 'Space', hint: 'Disk use and re-encodes', Component: SpacePage },
  { id: 'appearance', label: 'Appearance', hint: 'Theme, this browser only', Component: AppearanceSection },
  { id: 'system', label: 'System', hint: 'Server status, database, rating snapshots, restart', Component: SystemSection }
];

const SUBTITLE = 'Saved on the server for every browser unless a row says this browser only.';
const LINE_META = 'Each change saves at once · saved on the server for every browser unless a row says this browser only';

const SECTION_ICON = {
  library: FolderOutlinedIcon,
  tags: LocalOfferOutlinedIcon,
  shortcuts: KeyboardOutlinedIcon,
  workers: MemoryOutlinedIcon,
  space: StorageOutlinedIcon,
  appearance: PaletteOutlinedIcon,
  system: SettingsSuggestOutlinedIcon
};

/** The sections as the View list (desktop) and the tab row (phone). The links replace. */
const VIEWS = SETTINGS_SECTIONS.map(s => {
  const Icon = SECTION_ICON[s.id];
  return { id: s.id, label: s.label, title: s.hint, icon: <Icon />, to: `/settings/${s.id}`, replace: true };
});

const phoneRowSx = {
  display: 'flex',
  alignItems: 'center',
  gap: 1.5,
  height: 56,
  px: 1.5,
  minWidth: 0,
  textDecoration: 'none',
  borderBottom: '1px solid var(--line)',
  '&:last-of-type': { borderBottom: 0 },
  '&:hover': { bgcolor: 'var(--raised)' },
  '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: -2 }
};

export default function SettingsPage() {
  const params = useParams();
  const isPhone = useIsPhone();
  const parts = (params['*'] || '').split('/').filter(Boolean);
  const id = parts[0] || null;
  const section = id ? SETTINGS_SECTIONS.find(s => s.id === id) : null;

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [id]);

  if (parts.length > 1) return <Navigate to={`/settings/${parts[0]}`} replace />;
  if (id && !section) return <Navigate to="/settings" replace />;

  if (!isPhone && !section) return <Navigate to="/settings/library" replace />;

  if (section) {
    const { Component } = section;
    return (
      <SidebarPage title={isPhone ? section.label : 'Settings'} views={VIEWS} view={id}>
        <ContentLine title={section.label} meta={LINE_META} />
        <Component key={id} />
      </SidebarPage>
    );
  }

  return (
    <PageShell full>
      <PageHeader title="Settings" subtitle={SUBTITLE} />
      <Rows>
        {SETTINGS_SECTIONS.map(s => (
          <Box key={s.id} component={RouterLink} to={`/settings/${s.id}`} sx={phoneRowSx}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ fontSize: 14, color: 'var(--text)', fontWeight: 550 }}>{s.label}</Box>
              <Box sx={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {s.hint}
              </Box>
            </Box>
            <ChevronRightIcon sx={{ color: 'var(--muted)', fontSize: 20, flexShrink: 0 }} />
          </Box>
        ))}
      </Rows>
    </PageShell>
  );
}
