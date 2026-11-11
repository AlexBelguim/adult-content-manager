import React, { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import FolderAdder from '../components/FolderAdder';
import FilterView from '../components/FilterView';
import GalleryView from '../components/GalleryView';
import { PageShell, EmptyState, LoadingState, SidebarPage } from '../components/layout';
import { SmallButton } from '../components/discover/shared';
import { useNotify, errorText } from '../components/ui';
import { useLibraryViews, libraryViewOf } from '../components/home/homeData';
import './MainPage.css';

async function fetchFolders() {
  const res = await fetch('/api/folders');
  if (!res.ok) throw new Error(`The server answered ${res.status}`);
  const list = await res.json();
  if (!Array.isArray(list)) throw new Error('The server sent no folder list');
  return list;
}

// The last folder list, kept across remounts (Back from a gallery remounts this page): shown at once, then refetched.
let lastFolders = null;

/** The Library frame of '/' and '/filter': one SidebarPage, so the sidebar stays mounted across the switch. */
function LibraryFrame({ root, children }) {
  const location = useLocation();
  const views = useLibraryViews({ root });
  return (
    <SidebarPage title="Library" views={views} view={libraryViewOf(location.pathname, location.search)}>
      {children}
    </SidebarPage>
  );
}

/**
 * The library home at 900px and wider: the folder check, then Filter or the Gallery inside one SidebarPage (the
 * View list switches Performers, Genres and Filter), which stays mounted across / and /filter. One performer's
 * filter view (/filter/:id) is a work view with its own left column: no sidebar there. The library is never
 * scanned here: onFolderAdded (which runs scan-after) is called only after a folder was added.
 */
function MainPage({ mode, performerId = null, basePath, handyIntegration, handyConnected, onFolderAdded }) {
  const [folders, setFoldersState] = useState(lastFolders);
  const [foldersError, setFoldersError] = useState(null);
  const [filterCache, setFilterCache] = useState(null);
  const notify = useNotify();

  const setFolders = useCallback((list) => { lastFolders = list; setFoldersState(list); }, []);

  const loadFolders = useCallback(async () => {
    setFoldersError(null);
    try {
      setFolders(await fetchFolders());
    } catch (err) {
      // with a list already shown the gallery keeps it; its own refresh says when the server is away
      if (!lastFolders) setFoldersError(errorText(err, 'The folder list did not load'));
    }
  }, [setFolders]);

  useEffect(() => { loadFolders(); }, [loadFolders]);

  const handleAddFolder = async (folderPath) => {
    try {
      const res = await fetch('/api/folders/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: folderPath })
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result.success) {
        notify({ severity: 'error', message: `Could not add the folder: ${result.error || 'the server did not answer'}` });
        return;
      }
      setFolders(await fetchFolders());
      if (onFolderAdded) onFolderAdded(folderPath);
    } catch (err) {
      notify({ severity: 'error', message: `Could not add the folder: ${errorText(err, 'the server did not answer')}` });
    }
  };

  if (foldersError) {
    return (
      <PageShell full>
        <EmptyState title="Could not reach the server" description={foldersError}
          action={<SmallButton onClick={loadFolders}>Retry</SmallButton>} />
      </PageShell>
    );
  }
  if (folders === null) {
    return <PageShell full><LoadingState label="Loading the library…" /></PageShell>;
  }
  if (folders.length === 0) {
    return (
      <div className="main-page">
        <FolderAdder onAdd={handleAddFolder} />
      </div>
    );
  }

  const root = basePath || folders[0].path;

  const filterView = (
    <FilterView
      performerId={performerId}
      basePath={root}
      handyIntegration={handyIntegration}
      handyConnected={handyConnected}
      cachedPerformers={filterCache}
      onPerformersUpdate={setFilterCache}
    />
  );

  // Her filter view fills the window under the app bar by itself.
  if (mode === 'filter' && performerId) return filterView;

  return (
    <LibraryFrame root={root}>
      {mode === 'filter' ? filterView : <GalleryView basePath={root} />}
    </LibraryFrame>
  );
}

export default MainPage;
