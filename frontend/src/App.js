import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ThemeProvider } from '@mui/material';
import Toolbar from './components/Toolbar';
import MainPage from './pages/MainPage';
import PhoneLibrary from './mobile/PhoneLibrary';
import PhoneFrame from './mobile/PhoneFrame';
import UnifiedGalleryPage from './pages/UnifiedGalleryPage';

import HashResultsPage from './pages/HashResultsPage';
import PerformerManagementPage from './pages/PerformerManagementPageNew';
import ThumbnailSelectorWrapper from './components/ThumbnailSelectorWrapper';
import { Provider } from 'react-redux';
import store from './redux/store';
import { HandyIntegration } from './utils/HandyIntegration';
import SceneManagerPage from './pages/SceneManagerPage';
import './App.css';
// One token-driven stylesheet for the shared component classes (the per-theme files are gone).
import './styles/components.css';
import './styles/darkPanel.css';
import LocalImportPage from './pages/LocalImportPage';
import RankingInsightPage from './pages/RankingInsightPage';
import GroupRatePage from './pages/GroupRatePage';
import SmartComparePage from './pages/SmartComparePage';
import AiTrainingPage from './pages/AiTrainingPage';
import PairwiseRankPage from './pages/PairwiseRankPage';
import FunpipePage from './pages/FunpipePage';
import VRPage from './pages/VRPage';
import PlayerPage from './pages/PlayerPage';
import JobsPage from './pages/JobsPage';
import SettingsPage from './pages/SettingsPage';
import DiscoverPage from './pages/DiscoverPage';
import NotFoundPage from './pages/NotFoundPage';
import UpdateNotice from './pwa/UpdateNotice';
import { FeedbackProvider, CloseAsksOnRouteChange } from './components/ui';
import { UploadsProvider } from './components/import/UploadsProvider';
import { LoadingState, PageShell } from './components/layout';
import { ShellProvider, ChromeProvider, useShell, useIsPhone, libraryState } from './nav';


import CssBaseline from '@mui/material/CssBaseline';
import { getThemeById, getStoredThemeId, setStoredThemeId, getTokensById } from './theme';
import { applyTokens } from './styles/tokens';

const PHONE_LANDSCAPE = '(max-height:500px) and (orientation: landscape)';

// Like MUI's useMediaQuery, but also re-checks on window resize: a rotation
// always fires the media-query change event, some embedded webviews do not.
function usePhoneLandscape() {
  const [matches, setMatches] = useState(() => window.matchMedia(PHONE_LANDSCAPE).matches);
  useEffect(() => {
    const mq = window.matchMedia(PHONE_LANDSCAPE);
    const update = () => setMatches(mq.matches);
    mq.addEventListener('change', update);
    window.addEventListener('resize', update);
    return () => {
      mq.removeEventListener('change', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return matches;
}

/**
 * The chrome around one page (nav/routes.js has the kind of every route):
 *   'page'    desktop: the app bar; phone: page bar, bottom navigation and More sheet (PhoneFrame)
 *   'bare'    nothing; the page draws its own Back
 *   'compare' like 'page', but bare on a phone held sideways (Smart Compare needs the height)
 * The page always sits at the same place in the tree, so a chrome flip (a rotation, a resize) never
 * remounts it.
 */
function Frame({ kind = 'page', children }) {
  const isPhone = useIsPhone();
  const phoneLandscape = usePhoneLandscape();
  const isBare = kind === 'bare' || (kind === 'compare' && phoneLandscape);
  const chrome = isBare ? 'bare' : isPhone ? 'phone' : 'desktop';
  return (
    <ChromeProvider value={chrome}>
      {chrome === 'desktop' ? <Toolbar /> : null}
      <PhoneFrame active={chrome === 'phone'}>{children}</PhoneFrame>
    </ChromeProvider>
  );
}

const page = (el) => <Frame kind="page">{el}</Frame>;
const bare = (el) => <Frame kind="bare">{el}</Frame>;

/** /p/:id on desktop: the desktop has no per-performer gallery route, so replace to the unified gallery. */
function PerformerGalleryRedirect({ id }) {
  const navigate = useNavigate();
  const { basePath } = useShell();
  const [performer, setPerformer] = useState(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let alive = true;
    setPerformer(null);
    setMissing(false);
    fetch(`/api/performers/${encodeURIComponent(id)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((p) => {
        if (!alive) return;
        if (p && p.name) setPerformer(p);
        else setMissing(true);
      })
      .catch(() => { if (alive) setMissing(true); });
    return () => { alive = false; };
  }, [id]);

  // The performer's own library folder; else the app's, once /api/folders has answered.
  const root = performer ? (performer.folder_path || basePath) : null;
  useEffect(() => {
    if (!performer || !root) return;
    navigate(
      `/unified-gallery?performer=${encodeURIComponent(performer.name)}&basePath=${encodeURIComponent(root)}`,
      { replace: true }
    );
  }, [performer, root, navigate]);

  if (missing) return <NotFoundPage />;
  return <PageShell><LoadingState label="Opening the gallery…" /></PageShell>;
}

/**
 * The library routes (/, /filter, /filter/:performerId, /pairs, /p/:performerId) share this one
 * element, so the phone library (its list, scroll and search) stays mounted while its sub-views
 * open and close, and the desktop MainPage stays mounted across a Gallery/Filter switch.
 */
function LibraryRoute({ mainProps }) {
  const { pathname } = useLocation();
  const isPhone = useIsPhone();
  const lib = libraryState(pathname) || { list: 'gallery', performerId: null, galleryId: null };

  if (isPhone) {
    return (
      <ChromeProvider value="phone">
        <PhoneLibrary />
      </ChromeProvider>
    );
  }
  if (lib.list === 'pairs') return <Navigate to="/" replace />;
  return (
    <ChromeProvider value="desktop">
      <Toolbar />
      {lib.galleryId ? (
        <PerformerGalleryRedirect id={lib.galleryId} />
      ) : (
        <MainPage
          mode={lib.list}
          performerId={lib.performerId}
          subMode="performer"
          {...mainProps}
        />
      )}
    </ChromeProvider>
  );
}

/** The old scene-editor address: /scene-manager?filePath=<path>&videoSrc=/api/files/raw?path=<path>. */
function SceneManagerRedirect() {
  const [sp] = useSearchParams();
  let p = sp.get('filePath');
  if (!p) {
    const src = sp.get('videoSrc');
    if (src) {
      try {
        p = new URL(src, window.location.origin).searchParams.get('path');
      } catch {
        p = null;
      }
    }
  }
  return <Navigate to={p ? `/scene-editor?video=${encodeURIComponent(p)}` : '/scene-editor'} replace />;
}

/** Hands the router's navigate to the shell value, which is built above the Router (openSettings). */
function NavBridge({ navRef }) {
  const navigate = useNavigate();
  useEffect(() => {
    navRef.current = navigate;
    return () => { if (navRef.current === navigate) navRef.current = null; };
  }, [navigate, navRef]);
  return null;
}

// Component that uses the theme
function AppContent({ onThemeChange, currentThemeId }) {
  const [handyCode, setHandyCode] = useState('');
  const [handyConnected, setHandyConnected] = useState(false);
  // The connection only lives in this component's state, so a fresh document
  // (the player opened in a new tab, a reload on /player) came up "not
  // connected" while the main page still was. Read what the last session
  // left in localStorage before the persist effect below overwrites it with
  // `false`, and reconnect with it once the SDK is up.
  const [restoreHandyCode] = useState(() => {
    try {
      if (localStorage.getItem('handyConnected') !== 'true') return '';
      return localStorage.getItem('handyCode') || localStorage.getItem('handyConnectionCode') || '';
    } catch {
      return '';
    }
  });
  const [basePath, setBasePath] = useState(null);
  const [handyIntegration, setHandyIntegration] = useState(null);
  // MainPage hands these up; nothing reads them since the app bar lost its scan button.
  const [, setOnScanPerformers] = useState(null);
  const [, setIsScanning] = useState(false);
  const navRef = useRef(null);

  // Expose Handy connection state globally for web components
  useEffect(() => {
    window.appHandyConnected = handyConnected;
    // Also persist to localStorage for cross-page navigation
    localStorage.setItem('handyConnected', handyConnected.toString());
    console.log('🌐 Global Handy connection state updated:', handyConnected);
  }, [handyConnected]);

  // Expose HandyIntegration instance globally for web components
  useEffect(() => {
    if (handyIntegration) {
      window.appHandyIntegration = handyIntegration;
      console.log('🌐 Global HandyIntegration instance exposed:', handyIntegration);
    } else {
      window.appHandyIntegration = null;
    }
  }, [handyIntegration]);

  // Expose Handy code globally for restoration
  useEffect(() => {
    if (handyCode) {
      localStorage.setItem('handyCode', handyCode);
      console.log('🔑 Handy code stored:', handyCode);
    }
  }, [handyCode]);

  // The connection is the shared Handy control's (the toolbar's <handy-control>, public/handy-control.js): follow it.
  useEffect(() => {
    const control = window.HandyControl;
    if (!control) return undefined;
    const follow = () => {
      setHandyConnected(control.connected);
      if (control.connected) setHandyCode(control.key);
    };
    follow();
    control.addEventListener('change', follow);
    return () => control.removeEventListener('change', follow);
  }, []);

  useEffect(() => {
    // Initialize HandyIntegration - wait for SDK to load
    const initHandyIntegration = async () => {
      if (typeof window !== 'undefined' && window.Handy) {
        console.log('✅ Handy SDK loaded, initializing HandyIntegration');
        const integration = new HandyIntegration();
        const success = await integration.initialize();
        if (success) {
          setHandyIntegration(integration);
          if (restoreHandyCode) {
            try {
              const reconnected = await integration.connect(restoreHandyCode);
              if (reconnected) {
                setHandyCode(restoreHandyCode);
                setHandyConnected(true);
                console.log('🔄 Restored Handy connection from the previous page');
              } else {
                console.warn('⚠️ Could not restore the Handy connection; connect again from the toolbar');
              }
            } catch (error) {
              console.warn('⚠️ Could not restore the Handy connection:', error);
            }
          }
        }
        return success;
      }
      return false;
    };

    // Try to initialize immediately
    initHandyIntegration().then(success => {
      if (!success) {
        // If not available, poll for it
        console.log('⏳ Waiting for Handy SDK to load...');
        const interval = setInterval(async () => {
          const success = await initHandyIntegration();
          if (success) {
            clearInterval(interval);
          }
        }, 100);

        // Clear interval after 10 seconds to prevent infinite polling
        setTimeout(() => {
          clearInterval(interval);
          if (!handyIntegration) {
            console.error('❌ Handy SDK failed to load after 10 seconds');
          }
        }, 10000);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per restore; the timer checks the SDK itself
  }, [restoreHandyCode]);

  useEffect(() => {
    // Check if folders exist on startup
    fetch('/api/folders')
      .then(res => res.json())
      .then(folders => {
        if (folders.length > 0) {
          setBasePath(folders[0].path);
        }
      })
      .catch(err => console.error('Error loading folders:', err));
  }, []);

  const handleFolderAdded = (path) => {
    setBasePath(path);
    // Trigger a scan of the after folder to pick up existing performers
    fetch('/api/folders/scan-after')
      .then(res => res.json())
      .then(result => {
        if (result.success) {
          console.log(`Found ${result.count} existing performers in after filter folder`);
        }
      })
      .catch(err => console.error('Error scanning after folder:', err));
  };

  const reloadFolders = useCallback(() => {
    // Reset the basePath and check if any folders remain
    setBasePath(null);
    fetch('/api/folders')
      .then(res => res.json())
      .then(folders => {
        if (folders.length > 0) {
          setBasePath(folders[0].path);
        }
      })
      .catch(err => console.error('Error loading folders after deletion:', err));
  }, []);

  const openSettings = useCallback((section) => {
    const to = typeof section === 'string' && section ? `/settings/${section}` : '/settings';
    if (navRef.current) navRef.current(to); else window.location.assign(to);
  }, []);

  // What every page can read through useShell() (nav/shell.js).
  const shellValue = useMemo(() => ({
    basePath,
    handy: { integration: handyIntegration, code: handyCode, connected: handyConnected },
    openSettings,
    reloadFolders,
    themeId: currentThemeId,
    setTheme: onThemeChange
  }), [basePath, handyIntegration, handyCode, handyConnected, openSettings, reloadFolders, currentThemeId, onThemeChange]);

  const handyProps = { handyIntegration, handyCode, handyConnected };
  const mainProps = {
    basePath,
    ...handyProps,
    onFolderAdded: handleFolderAdded,
    setOnScanPerformers,
    setIsScanning
  };

  // nav/routes.js holds each route's title, section, chrome and parent: keep the two in step.
  return (
    <Router>
      <ShellProvider value={shellValue}>
        {/* Browser uploads (Import page) keep going on every route: the provider sits above the routes. */}
        <UploadsProvider basePath={basePath}>
          <div className="App">
            <Routes>
              <Route element={<LibraryRoute mainProps={mainProps} />}>
                <Route index />
                <Route path="filter" />
                <Route path="filter/:performerId" />
                <Route path="pairs" />
                <Route path="p/:performerId" />
              </Route>

              <Route path="/unified-gallery" element={page(<UnifiedGalleryPage {...handyProps} />)} />
              {/* Bare: it replaced the gallery's fullscreen modal, so it takes the whole viewport. */}
              <Route path="/player" element={bare(<PlayerPage {...handyProps} />)} />
              <Route path="/thumbnail-selector/:performerId" element={bare(<ThumbnailSelectorWrapper />)} />
              <Route path="/local-import" element={page(<LocalImportPage basePath={basePath} />)} />
              <Route path="/performer-management" element={page(<PerformerManagementPage basePath={basePath} />)} />
              <Route path="/hash-results/:runId" element={page(<HashResultsPage />)} />
              <Route path="/discover/*" element={page(<DiscoverPage />)} />
              {/* A phone held sideways has ~390px of height: Smart Compare drops the chrome there. */}
              <Route path="/smart-compare" element={<Frame kind="compare"><SmartComparePage /></Frame>} />
              <Route path="/group-rate" element={page(<GroupRatePage />)} />
              {/* Bare: on the Fold's cover screen in landscape a bar pushes the Undo/Skip row off the bottom. */}
              <Route path="/pairwise-rank" element={bare(<PairwiseRankPage />)} />
              <Route path="/ai-training" element={page(<AiTrainingPage />)} />
              <Route path="/ranking-insight" element={page(<RankingInsightPage />)} />
              <Route path="/funpipe" element={page(<FunpipePage />)} />
              <Route path="/scene-editor" element={bare(<SceneManagerPage />)} />
              <Route path="/vr" element={bare(<VRPage />)} />
              <Route path="/jobs" element={page(<JobsPage />)} />
              <Route path="/settings/*" element={page(<SettingsPage />)} />

              {/* Old addresses: nothing links to them, bookmarks still work. */}
              <Route path="/admin" element={<Navigate to="/settings/system" replace />} />
              <Route path="/scene-manager" element={<SceneManagerRedirect />} />
              <Route path="/hash-management" element={<Navigate to="/performer-management?view=duplicates" replace />} />
              <Route path="/upload-queue" element={<Navigate to="/local-import" replace />} />
              <Route path="/taste-dashboard" element={<Navigate to="/ai-training" replace />} />
              {/* The old pairwise service's pages (Labeler, Threshold, Health) are retired. */}
              <Route path="/pairwise/*" element={<Navigate to="/ranking-insight" replace />} />
              <Route path="/pairwise-mobile" element={<Navigate to="/ranking-insight" replace />} />

              <Route path="*" element={page(<NotFoundPage />)} />
            </Routes>
            <NavBridge navRef={navRef} />
            <CloseAsksOnRouteChange />
            <UpdateNotice />
          </div>
        </UploadsProvider>
      </ShellProvider>
    </Router>
  );
}

// Main App component with providers
function App() {
  const [themeId, setThemeId] = useState(getStoredThemeId());
  const currentTheme = getThemeById(themeId);

  const handleThemeChange = useCallback((newId) => { setThemeId(newId); setStoredThemeId(newId); }, []);

  // Publish the design tokens as CSS custom properties on <html>.
  //
  // This is what makes a theme reach the WHOLE app. MUI's palette only
  // resolves inside `sx`; plain `style={{}}` and .css files cannot see it.
  // CSS variables resolve in all three, so every call site references
  // var(--…) and a single switch restyles everything.
  useEffect(() => {
    const root = document.documentElement;
    applyTokens(getTokensById(themeId));

    // Legacy variable names, still referenced by ~9 older components.
    // Mapped onto the active theme so they can't drift from the tokens.
    const p = currentTheme.palette;
    root.style.setProperty('--primary-main', p.primary.main);
    root.style.setProperty('--primary-light', p.primary.light);
    root.style.setProperty('--primary-dark', p.primary.dark);
    root.style.setProperty('--secondary-main', p.secondary.main);
    root.style.setProperty('--bg-default', p.background.default);
    root.style.setProperty('--bg-paper', p.background.paper);
    root.style.setProperty('--text-primary', p.text.primary);
    root.style.setProperty('--text-secondary', p.text.secondary);

    // The installed app's title bar and the phone's status bar follow the theme.
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', getTokensById(themeId).bg);
  }, [currentTheme, themeId]);

  return (
    <Provider store={store}>
      <ThemeProvider theme={currentTheme}>
        <CssBaseline />
        <FeedbackProvider>
          <AppContent onThemeChange={handleThemeChange} currentThemeId={themeId} />
        </FeedbackProvider>
      </ThemeProvider>
    </Provider>
  );
}

export default App;