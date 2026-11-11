/**
 * Import (/local-import): new pictures and videos into the library, two ways.
 *
 *   From the server folder  the folders in "<library>/before upload" (components/import/ServerTab.js)
 *   From this computer      a folder picked or dropped here, uploaded in batches (components/import/ComputerTab.js;
 *                           the uploads themselves run in components/import/UploadsProvider.js, app-wide)
 *
 * The tab is in the URL (?from=server|computer); without one, the tab used last. Both tabs stay mounted, so a pick or
 * a search survives a switch. SidebarPage: the two tabs are its View list (the phone's tab row); each tab adds its own
 * sidebar groups while it is shown. The page is in the normal document flow: the window scrolls, and the server tab's
 * action bar is sticky at the bottom of the content. Queued imports are jobs: the Imports group counts them and links
 * to /jobs.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import DnsOutlinedIcon from '@mui/icons-material/DnsOutlined';
import ComputerOutlinedIcon from '@mui/icons-material/ComputerOutlined';
import ListAltIcon from '@mui/icons-material/ListAlt';
import {
  SidebarPage, SideGroup, SideFacts, SideButtons, SideButton, ContentLine, EmptyState, SIDE
} from '../components/layout';
import { SmallButton } from '../components/discover/shared';
import ServerTab from '../components/import/ServerTab';
import ComputerTab from '../components/import/ComputerTab';
import { useUploads } from '../components/import/UploadsProvider';
import useJobs from '../hooks/useJobs';
import { useShell } from '../nav';
import '../components/import/import.css';

const TABS = ['server', 'computer'];
const TAB_KEY = 'import.tab';

function lastTab() {
  try {
    const t = window.localStorage.getItem(TAB_KEY);
    if (TABS.includes(t)) return t;
  } catch { /* private window: the default */ }
  return 'server';
}
function storeTab(tab) {
  try { window.localStorage.setItem(TAB_KEY, tab); } catch { /* the choice lasts for this visit */ }
}

const TAB_LABEL = { server: 'From the server folder', computer: 'From this computer' };
const IMPORTS_ICON = <ListAltIcon />;

/** The sidebar's Imports group: running (or queued) and failed import jobs from /api/jobs (browser uploads included). */
function ImportsGroup() {
  const { jobs } = useJobs();
  const imports = jobs.filter(j => j.type === 'import');
  const running = imports.filter(j => j.status === 'running' || j.status === 'queued').length;
  const failed = imports.filter(j => j.status === 'failed').length;
  const summary = [running ? `${running} running` : null, failed ? `${failed} failed` : null].filter(Boolean).join(' · ') || 'none running';
  return (
    <SideGroup id="jobs" title="Imports" icon={IMPORTS_ICON} order={SIDE.page + 1} dot={failed ? 'bad' : null} summary={summary}>
      <SideFacts rows={[
        { label: 'Running', value: running.toLocaleString(), tone: running ? 'accent' : undefined, title: 'Import jobs running or queued' },
        { label: 'Failed', value: failed.toLocaleString(), tone: failed ? 'bad' : undefined }
      ]} />
      <SideButtons>
        <SideButton component={RouterLink} to="/jobs?kind=import">Open Jobs</SideButton>
      </SideButtons>
    </SideGroup>
  );
}

/**
 * Whether there is a library at all. With a basePath: yes. Without one: ask /api/folders once (App.js sets basePath
 * from its first row, so an empty list means none); the scan's noLibrary also says no.
 */
function useNoLibrary(basePath) {
  const [none, setNone] = useState(false);
  useEffect(() => {
    if (basePath) { setNone(false); return undefined; }
    const ctl = new AbortController();
    fetch('/api/folders', { signal: ctl.signal })
      .then(r => (r.ok ? r.json() : null))
      .then(rows => { if (Array.isArray(rows) && rows.length === 0) setNone(true); })
      .catch(() => { /* unknown: the scan says so when it runs */ });
    return () => ctl.abort();
  }, [basePath]);
  return [none, setNone];
}

export default function LocalImportPage({ basePath: given }) {
  const shell = useShell();
  const basePath = given || shell.basePath || null;
  const { uploads, watchJobs } = useUploads();
  const [params, setParams] = useSearchParams();
  const fromParam = params.get('from');
  const [fallback] = useState(lastTab);
  const tab = TABS.includes(fromParam) ? fromParam : fallback;
  const [folderCount, setFolderCount] = useState(0);
  const [noLibrary, setNoLibrary] = useNoLibrary(basePath);

  useEffect(() => { storeTab(tab); }, [tab]);

  const setTab = useCallback((id) => {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('from', id);
      return next;
    }, { replace: true });
  }, [setParams]);

  const toComputer = useCallback(() => setTab('computer'), [setTab]);
  const onNoLibrary = useCallback(() => setNoLibrary(true), [setNoLibrary]);

  const activeUploads = uploads.filter(u => u.status !== 'importing').length;
  const views = [
    { id: 'server', label: TAB_LABEL.server, count: folderCount || null, icon: <DnsOutlinedIcon /> },
    { id: 'computer', label: TAB_LABEL.computer, count: activeUploads || null, icon: <ComputerOutlinedIcon /> }
  ].map(v => ({
    ...v,
    to: `/local-import?from=${v.id}`,
    replace: true,
    onClick: (e) => {
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;   // a new tab: the link's own way
      e.preventDefault();
      setTab(v.id);
    }
  }));

  return (
    <SidebarPage title="Import" views={views} view={tab}>
      {noLibrary
        ? (
          <>
            <ContentLine title={TAB_LABEL[tab]} />
            <EmptyState
              title="No library folder set up"
              description="Import needs a library folder to move files into."
              action={<SmallButton primary onClick={() => shell.openSettings('library')}>Open Settings</SmallButton>}
            />
          </>
        )
        : (
          <>
            <div style={{ display: tab === 'server' ? 'block' : 'none' }}>
              <ServerTab
                basePath={basePath}
                active={tab === 'server'}
                onCount={setFolderCount}
                onSwitchTab={toComputer}
                onNoLibrary={onNoLibrary}
                watchJobs={watchJobs}
              />
            </div>
            <div style={{ display: tab === 'computer' ? 'block' : 'none' }}>
              <ComputerTab basePath={basePath} active={tab === 'computer'} />
            </div>
          </>
        )}

      <ImportsGroup />
    </SidebarPage>
  );
}
