/**
 * Import (/local-import): new pictures and videos into the library, two ways.
 *
 *   From the server folder  the folders in "<library>/before upload" (components/import/ServerTab.js)
 *   From this computer      a folder picked or dropped here, uploaded in batches (components/import/ComputerTab.js;
 *                           the uploads themselves run in components/import/UploadsProvider.js, app-wide)
 *
 * The tab is in the URL (?from=server|computer); without one, the tab used last. Both tabs stay mounted, so a pick or
 * a search survives a switch. The page is in the normal document flow: the window scrolls, and the server tab's
 * action bar is sticky at the bottom. Queued imports are jobs: the header links to /jobs with the import counts.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { PageShell, PageHeader, EmptyState } from '../components/layout';
import { TabBar, SmallButton } from '../components/discover/shared';
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

/** 'Jobs · 2 running · 1 failed' from the import rows of /api/jobs (browser uploads included). */
function JobsButton() {
  const { jobs } = useJobs();
  const imports = jobs.filter(j => j.type === 'import');
  const running = imports.filter(j => j.status === 'running' || j.status === 'queued').length;
  const failed = imports.filter(j => j.status === 'failed').length;
  return (
    <SmallButton component={RouterLink} to="/jobs">
      Jobs{running ? ` · ${running} running` : ''}{failed ? ` · ${failed} failed` : ''}
    </SmallButton>
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
  const tabs = [
    { id: 'server', label: 'From the server folder', count: folderCount || null },
    { id: 'computer', label: 'From this computer', count: activeUploads || null }
  ];

  return (
    <PageShell>
      <PageHeader title="Import" back actions={<JobsButton />} />
      <TabBar label="Import from" tabs={tabs} value={tab} onChange={setTab} />

      {noLibrary
        ? (
          <EmptyState
            title="No library folder set up"
            description="Import needs a library folder to move files into."
            action={<SmallButton primary onClick={() => shell.openSettings('library')}>Open Settings</SmallButton>}
          />
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
    </PageShell>
  );
}
