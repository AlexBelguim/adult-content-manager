import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ThemeProvider, createTheme, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, Link, Typography, CircularProgress, Box, Alert, Divider } from '@mui/material';
import Toolbar from './components/Toolbar';
import MainPage from './pages/MainPage';
import UnifiedGalleryPage from './pages/UnifiedGalleryPage';

import HashManagementPage from './pages/HashManagementPage';
import HashResultsPage from './pages/HashResultsPage';
import PerformerManagementPage from './pages/PerformerManagementPageNew';
import ThumbnailSelectorWrapper from './components/ThumbnailSelectorWrapper';
import AdminPage from './pages/AdminPage';
import { Provider } from 'react-redux';
import store from './redux/store';
import { HandyIntegration } from './utils/HandyIntegration';
import SceneManagerWrapper from './utils/SceneManagerWrapper';
import SceneManagerPage from './pages/SceneManagerPage';
import HashCreationQueue from './components/HashCreationQueue';
// Pairwise Labeler (integrated from vision-llm-pairwise)
import PairwisePage from './pages/PairwisePage';
import './App.css';
// One token-driven stylesheet replaces the five per-theme files
// (gamerEdge / gamer / tokyoNight / cinematic / cleanSplit), which declared
// the same 26 selectors five times over with hardcoded colours. Those files
// are still on disk but no longer imported — delete them once you're happy.
import './styles/components.css';
import './styles/darkPanel.css';
import BatchQueuePage from './pages/BatchQueuePage';
import UploadQueuePage from './pages/UploadQueuePage';
import LocalImportPage from './pages/LocalImportPage';
import TinderSortingPage from './pages/TinderSortingPage';
import PairwiseMobilePage from './pages/PairwiseMobilePage';
import RankingInsightPage from './pages/RankingInsightPage';
import PairwiseRefinePage from './pages/PairwiseRefinePage';
import PairwiseAutoLabelPage from './pages/PairwiseAutoLabelPage';
import GroupRatePage from './pages/GroupRatePage';
import SmartComparePage from './pages/SmartComparePage';
import SmartFilterPage from './pages/SmartFilterPage';
import TasteDashboardPage from './pages/TasteDashboardPage';
import PairwiseRankPage from './pages/PairwiseRankPage';
import TrainingHubPage from './pages/TrainingHubPage';
import FunpipePage from './pages/FunpipePage';
import VRPage from './pages/VRPage';


import CssBaseline from '@mui/material/CssBaseline';
import { getThemeById, getStoredThemeId, setStoredThemeId, getTokensById } from './theme';
import { applyTokens } from './styles/tokens';

function LicenseModal({ open, onSubmit, onCancel, defaultKey, verifying, error }) {
  const [key, setKey] = useState(defaultKey || '');
  useEffect(() => setKey(defaultKey || ''), [defaultKey]);

  const isOverLimit = error && error.includes('limit exceeded');

  return (
    <Dialog open={open} disableEscapeKeyDown>
      <DialogTitle>
        {isOverLimit ? '⚠️ Activation Limit Exceeded' : 'Activate Your License'}
      </DialogTitle>
      <DialogContent>
        {isOverLimit ? (
          <>
            <Alert severity="error" sx={{ mb: 2 }}>
              <strong>{error}</strong>
            </Alert>
            <Typography gutterBottom>
              This license key has been activated on too many devices. To continue:
            </Typography>
            <Box sx={{ mt: 2, mb: 2 }}>
              <Typography variant="body2" sx={{ mb: 1 }}>
                1. Manage your device activations through Gumroad:
              </Typography>
              <Button
                variant="outlined"
                size="small"
                href="https://app.gumroad.com/library"
                target="_blank"
                rel="noopener noreferrer"
                fullWidth
                sx={{ mb: 2 }}
              >
                Open Gumroad Library →
              </Button>
              <Typography variant="body2" sx={{ mb: 1 }}>
                2. Or view activation details in the admin dashboard:
              </Typography>
              <Button
                variant="outlined"
                size="small"
                href="/admin"
                target="_blank"
                fullWidth
              >
                Open Admin Dashboard →
              </Button>
            </Box>
            <Divider sx={{ my: 2 }} />
            <Typography variant="body2" color="text.secondary">
              If you believe this is an error, try entering your license key again:
            </Typography>
          </>
        ) : (
          <>
            <Typography gutterBottom>
              Please enter your Gumroad license key to continue. You can get or purchase a key here:
            </Typography>
            <Link href="https://leakscriptsieve.gumroad.com/l/wrjde" target="_blank" rel="noopener">
              https://leakscriptsieve.gumroad.com/l/wrjde
            </Link>
          </>
        )}
        <Box mt={2}>
          <TextField
            label="License Key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            fullWidth
            autoFocus={!isOverLimit}
            error={!!error && !isOverLimit}
            helperText={!isOverLimit && error ? error : ''}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={verifying}>Quit</Button>
        <Button onClick={() => onSubmit(key)} variant="contained" disabled={!key || verifying}>
          {verifying ? <><CircularProgress size={18} sx={{ mr: 1 }} /> Validating...</> : 'Validate'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// Component that uses the theme
function AppContent({ onThemeChange, currentThemeId }) {
  const [mode, setMode] = useState('gallery'); // 'gallery' or 'filter'
  const [subMode, setSubMode] = useState('performer'); // 'performer' or 'content'
  const [handyCode, setHandyCode] = useState('');
  const [handyConnected, setHandyConnected] = useState(false);
  const [basePath, setBasePath] = useState(null);
  const [handyIntegration, setHandyIntegration] = useState(null);
  // License check disabled
  const [licenseChecked, setLicenseChecked] = useState(true);
  const [licenseValid, setLicenseValid] = useState(true);
  const [showLicenseModal, setShowLicenseModal] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [licenseError, setLicenseError] = useState('');
  const [cachedKey, setCachedKey] = useState('');
  const [onScanPerformers, setOnScanPerformers] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [showUploadImport, setShowUploadImport] = useState(false);

  // Global queue state for hash and CLIP creation (persists across pages)
  const [hashQueue, setHashQueue] = useState(() => {
    try {
      const saved = localStorage.getItem('hashQueue');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [showGlobalQueue, setShowGlobalQueue] = useState(false);
  const currentJobRef = useRef(null);
  const pollingIntervalRef = useRef(null);



  // License: initial status check — DISABLED
  // useEffect(() => { ... }, []);

  // Silent license refresh — DISABLED
  // useEffect(() => { ... }, [licenseChecked, licenseValid]);

  const handleLicenseSubmit = async (key) => {
    setVerifying(true);
    setLicenseError('');
    try {
      const res = await fetch('/api/license/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey: key })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        const errorMsg = data.message || data.error || 'License validation failed';
        setLicenseError(errorMsg);
        setVerifying(false);
        // Keep modal open so user can see the error with links
        return;
      }
      setLicenseValid(true);
      setShowLicenseModal(false);
      setLicenseError('');
      localStorage.setItem('licenseKey', key);
    } catch (e) {
      setLicenseError('Network error validating license');
    } finally {
      setVerifying(false);
    }
  };

  const handleLicenseCancel = () => {
    window.close();
  };

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

  useEffect(() => {
    // Initialize HandyIntegration - wait for SDK to load
    const initHandyIntegration = async () => {
      if (typeof window !== 'undefined' && window.Handy) {
        console.log('✅ Handy SDK loaded, initializing HandyIntegration');
        const integration = new HandyIntegration();
        const success = await integration.initialize();
        if (success) {
          setHandyIntegration(integration);
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
  }, []);

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

  // Persist hash queue to localStorage
  useEffect(() => {
    localStorage.setItem('hashQueue', JSON.stringify(hashQueue));
  }, [hashQueue]);



  // Helper to poll job status
  const pollHashJobStatus = (frontendJobId, backendJobId, setHashQueue, currentJobRef, pollingIntervalRef, onComplete) => {
    currentJobRef.current = frontendJobId;

    if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);

    pollingIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/hashes/status/${backendJobId}`);
        const data = await res.json();

        if (data.success && data.status) {
          setHashQueue(prev => prev.map(j => {
            if (j.id !== frontendJobId) return j;
            return {
              ...j,
              progress: data.status.progress,
              processed: data.status.processed,
              total: data.status.total,
              status: data.status.state === 'completed' ? 'completed' :
                data.status.state === 'error' ? 'error' : 'processing',
              error: data.status.error
            };
          }));

          if (data.status.state === 'completed' || data.status.state === 'error') {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
            currentJobRef.current = null;
            if (onComplete) onComplete();
          }
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 1000);
  };

  // Helper to start hash creation
  const startHashCreation = async (job, basePath, setHashQueue, currentJobRef, onPollStart) => {
    // Optimistic update
    setHashQueue(prev => prev.map(j =>
      j.id === job.id ? { ...j, status: 'processing', progress: 0 } : j
    ));

    try {
      const response = await fetch('/api/hashes/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          performer_id: job.performerId,
          basePath,
          mode: job.mode || 'append'
        })
      });
      const data = await response.json();

      if (data.success) {
        // Update with backend ID
        setHashQueue(prev => prev.map(j =>
          j.id === job.id ? { ...j, backendJobId: data.jobId } : j
        ));

        // Start polling
        onPollStart(job.id, data.jobId);
      } else {
        throw new Error(data.error || 'Failed to start hash creation');
      }
    } catch (err) {
      console.error('Failed to start hash job:', err);
      setHashQueue(prev => prev.map(j =>
        j.id === job.id ? { ...j, status: 'error', error: err.message } : j
      ));
    }
  };

  // Clean up completed/error jobs on startup and restore polling for processing jobs
  useEffect(() => {
    // Remove completed and error jobs from queues on mount
    setHashQueue(prev => prev.filter(j => j.status === 'processing' || j.status === 'queued'));
    // FIXME: setClipQueue is not defined - commenting out to prevent crash
    // setClipQueue(prev => prev.filter(j => j.status === 'processing' || j.status === 'queued'));

    const processingHashJob = hashQueue.find(j => j.status === 'processing');
    if (processingHashJob && processingHashJob.backendJobId) {
      // Resume polling for this job
      currentJobRef.current = processingHashJob.id;
      pollHashJobStatus(
        processingHashJob.id,
        processingHashJob.backendJobId,
        setHashQueue,
        currentJobRef,
        pollingIntervalRef,
        null
      );
    }
  }, []); // Only run on mount

  // Process hash queue when it changes
  useEffect(() => {
    const processingJob = hashQueue.find(j => j.status === 'processing');
    if (!processingJob) {
      const nextJob = hashQueue.find(j => j.status === 'queued');
      if (nextJob) {
        startHashCreation(
          nextJob,
          basePath,
          setHashQueue,
          currentJobRef,
          (jobId, backendJobId) => pollHashJobStatus(
            jobId,
            backendJobId,
            setHashQueue,
            currentJobRef,
            pollingIntervalRef,
            null // onComplete callback not needed in global context
          )
        );
      }
    }
  }, [hashQueue, basePath]);



  const handleModeChange = (newMode) => {
    setMode(newMode);
  };

  const handleSubModeChange = (newSubMode) => {
    setSubMode(newSubMode);
  };

  const handleHandyConnect = async (code) => {
    if (!handyIntegration) {
      alert('Handy SDK not loaded. Please refresh the page and try again.');
      return;
    }

    if (!window.Handy) {
      alert('Handy SDK not available. Please check your internet connection and refresh the page.');
      return;
    }

    try {
      const success = await handyIntegration.connect(code);

      if (success) {
        setHandyCode(code);
        setHandyConnected(true);
        console.log('✅ Connected to Handy');
      } else {
        alert('Failed to connect to Handy. Please check your connection code and try again.');
      }
    } catch (error) {
      console.error('❌ Error connecting to Handy:', error);
      alert('Error connecting to Handy: ' + error.message);
    }
  };

  const handleHandyDisconnect = async () => {
    if (handyIntegration) {
      try {
        await handyIntegration.disconnect();
        setHandyConnected(false);
        setHandyCode('');
        console.log('✅ Disconnected from Handy');
      } catch (error) {
        console.error('Error disconnecting from Handy:', error);
      }
    }
  };

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

  const handleFolderDeleted = () => {
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
  };

  // Every route that keeps the app chrome renders the same Toolbar with the
  // same thirteen props. That block was copy-pasted five times, so adding a
  // prop meant editing five call sites and missing one failed silently. One
  // object, one helper — and adding chrome to a route is now a one-line change.
  const toolbarProps = {
    mode, subMode,
    onModeChange: handleModeChange, onSubModeChange: handleSubModeChange,
    onHandyConnect: handleHandyConnect, onHandyDisconnect: handleHandyDisconnect,
    handyCode, handyConnected,
    basePath, onFolderDeleted: handleFolderDeleted,
    onScanPerformers, isScanning,
    onThemeChange, currentThemeId
  };
  // Plain function, not a component — returning JSX inline keeps the element
  // identity React already had. A nested component defined here would remount
  // its whole subtree on every App render.
  const shell = (page, extra) => (
    <>
      <Toolbar {...toolbarProps} {...extra} />
      {page}
    </>
  );

  return (
    <Router>
      <div className="App">
        {!licenseChecked ? (
          <Box p={4} display="flex" alignItems="center" justifyContent="center">
            <CircularProgress />
          </Box>
        ) : (
          <Routes>
            {/* Chrome-free by design: immersive or standalone surfaces where the
                app bar would be in the way — /vr (WebXR), the scene editor and
                /pairwise-mobile (opened as tools, often in their own tab), and
                /thumbnail-selector (a picker). Everything else gets shell(). */}
            <Route path="/admin" element={shell(<AdminPage />)} />
            <Route path="/unified-gallery" element={shell(
              <UnifiedGalleryPage
                handyIntegration={handyIntegration}
                handyCode={handyCode}
                handyConnected={handyConnected}
              />
            )} />
            <Route path="/scene-manager" element={
              <SceneManagerPage />
            } />
            <Route path="/scene-editor" element={
              <SceneManagerPage />
            } />
            <Route path="/hash-management" element={shell(
              <HashManagementPage
                basePath={basePath}
                hashQueue={hashQueue}
                setHashQueue={setHashQueue}
                currentJobRef={currentJobRef}
                pollingIntervalRef={pollingIntervalRef}
                setShowGlobalQueue={setShowGlobalQueue}
              />
            )} />
            <Route path="/hash-results/:runId" element={shell(<HashResultsPage />)} />

            {/* /upload-queue is an alias — it renders the combined import page */}
            <Route path="/upload-queue" element={shell(<LocalImportPage basePath={basePath} />)} />
            <Route path="/local-import" element={shell(<LocalImportPage basePath={basePath} />)} />
            <Route path="/tindersorting" element={shell(<TinderSortingPage basePath={basePath} />)} />
            <Route path="/performer-management" element={shell(<PerformerManagementPage />)} />
            <Route path="/pairwise/*" element={shell(<PairwisePage />)} />
            <Route path="/pairwise-mobile" element={
              <PairwiseMobilePage />
            } />
            <Route path="/ranking-insight" element={shell(<RankingInsightPage />)} />
            {/* Kept top level rather than inside the Pairwise tabs, for now. */}
            <Route path="/active-learning" element={shell(
              <PairwiseRefinePage serverUrl={localStorage.getItem('pairwiseServerUrl') || 'http://localhost:3334'} />
            )} />
            <Route path="/auto-label" element={shell(
              <PairwiseAutoLabelPage serverUrl={localStorage.getItem('pairwiseServerUrl') || 'http://localhost:3334'} />
            )} />
            <Route path="/group-rate" element={shell(<GroupRatePage />)} />
            <Route path="/smart-compare" element={shell(<SmartComparePage />)} />
            <Route path="/smart-filter/:performerId" element={shell(<SmartFilterPage />)} />
            <Route path="/taste-dashboard" element={shell(<TasteDashboardPage />)} />
            {/* Chrome-free: a full-bleed comparison tool opened in its own tab
                from the gallery. On the Fold's cover screen in landscape the
                toolbar ate 64px of a 360px-tall viewport and pushed the
                Undo/Skip row off the bottom. */}
            <Route path="/pairwise-rank" element={<PairwiseRankPage />} />
            <Route path="/training-hub" element={shell(<TrainingHubPage />)} />
            <Route path="/funpipe" element={shell(<FunpipePage />)} />
            <Route path="/vr" element={
              <VRPage />
            } />

            <Route path="/thumbnail-selector/:performerId" element={
              <ThumbnailSelectorWrapper />
            } />
            <Route path="*" element={shell(
              <MainPage
                mode={mode}
                subMode={subMode}
                basePath={basePath}
                handyIntegration={handyIntegration}
                handyCode={handyCode}
                handyConnected={handyConnected}
                onFolderAdded={handleFolderAdded}
                setOnScanPerformers={setOnScanPerformers}
                setIsScanning={setIsScanning}
              />,
              { onUploadFolder: () => setShowUploadImport(true) }
            )} />
          </Routes >
        )
        }
        <SceneManagerWrapper />

        <LicenseModal
          open={showLicenseModal}
          onSubmit={handleLicenseSubmit}
          onCancel={handleLicenseCancel}
          defaultKey={cachedKey}
          verifying={verifying}
          error={licenseError}
        />

        {/* UploadImportModal removed - use /upload-queue page instead */}
      </div >
    </Router >
  );
}

// Main App component with providers
function App() {
  const [themeId, setThemeId] = useState(getStoredThemeId());
  const currentTheme = getThemeById(themeId);

  const handleThemeChange = (newId) => {
    setThemeId(newId);
    setStoredThemeId(newId);
  };

  // Publish the design tokens as CSS custom properties on <html>.
  //
  // This is what makes a theme reach the WHOLE app. MUI's palette only
  // resolves inside `sx`; plain `style={{}}` and .css files cannot see it.
  // CSS variables resolve in all three, so every call site references
  // var(--…) and a single switch restyles everything.
  useEffect(() => {
    const root = document.documentElement;
    applyTokens(getTokensById(themeId));

    // Legacy: styles/themes/*.css target [data-theme="id"]. Kept until those
    // files are retired so existing saved preferences keep working.
    root.setAttribute('data-theme', themeId);

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
  }, [currentTheme, themeId]);

  return (
    <Provider store={store}>
      <ThemeProvider theme={currentTheme}>
        <CssBaseline />
        <AppContent onThemeChange={handleThemeChange} currentThemeId={themeId} />
      </ThemeProvider>
    </Provider>
  );
}

export default App;