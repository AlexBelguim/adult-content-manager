import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AppBar, Toolbar as MuiToolbar, Button, IconButton, InputBase, Box, Tooltip, Divider } from '@mui/material';
import { Settings, Image, FilterList, Add, FolderOpen, Videocam, People, Difference, Science, ViewInAr, Waves, Swipe } from '@mui/icons-material';
import ShortcutSettingsModal from './ShortcutSettingsModal';
import Logo from './Logo';

// NOTE: ./Toolbar.css was imported here but every one of its 14 classes
// (.toolbar, .mode-toggle, .sidebar-controls, .handy-*, …) had zero usages —
// this component renders a MUI AppBar. The import is removed rather than
// tokenised; the file can be deleted.

// Simple modal for video path input
const VideoPathModal = ({ open, onClose, onSubmit }) => {
  const [videoPath, setVideoPath] = useState('');

  if (!open) return null;

  const handleSubmit = () => {
    if (videoPath.trim()) {
      onSubmit(videoPath.trim());
      setVideoPath('');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleSubmit();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000
    }} onClick={onClose}>
      <div style={{
        backgroundColor: 'var(--surface)',
        padding: '24px',
        borderRadius: '12px',
        minWidth: '500px',
        maxWidth: '800px',
        border: '1px solid rgba(255,255,255,0.1)'
      }} onClick={e => e.stopPropagation()}>
        <h3 style={{ color: 'var(--text)', marginTop: 0 }}>🎬 Open Video in Scene Editor</h3>
        <p style={{ color: 'var(--dim)', fontSize: '14px' }}>
          Enter the full path to the video file. Scene data will be saved as JSON in the same folder.
        </p>
        <input
          type="text"
          value={videoPath}
          onChange={(e) => setVideoPath(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g., F:\Videos\example.mp4"
          autoFocus
          style={{
            width: '100%',
            padding: '12px',
            fontSize: '14px',
            backgroundColor: 'var(--bg)',
            border: '1px solid #444',
            borderRadius: '8px',
            color: 'var(--text)',
            marginBottom: '16px',
            boxSizing: 'border-box'
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <Button onClick={onClose} variant="outlined" color="inherit">Cancel</Button>
          <Button onClick={handleSubmit} disabled={!videoPath.trim()} variant="contained" color="primary">Open</Button>
        </div>
      </div>
    </div>
  );
};

function Toolbar({
  mode,
  subMode,
  onModeChange,
  onSubModeChange,
  onHandyConnect,
  onHandyDisconnect,
  handyCode,
  handyConnected,
  basePath = null,
  onFolderDeleted = null,
  onScanPerformers = null,
  onUploadFolder = null,
  isScanning = false,
  onThemeChange = null,
  currentThemeId = 'default'
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [localHandyCode, setLocalHandyCode] = useState(() => localStorage.getItem('handyConnectionCode') || handyCode || '');
  const [showSettings, setShowSettings] = useState(false);
  // VR is only enterable on a WebXR headset; gate the toolbar entry on support.
  const [vrSupported, setVrSupported] = useState(null); // null = unknown yet

  const [showVideoPathModal, setShowVideoPathModal] = useState(false);

  useEffect(() => {
    let active = true;
    if (navigator.xr && navigator.xr.isSessionSupported) {
      navigator.xr
        .isSessionSupported('immersive-vr')
        .then((ok) => active && setVrSupported(ok))
        .catch(() => active && setVrSupported(false));
    } else {
      setVrSupported(false);
    }
    return () => { active = false; };
  }, []);

  const handleModeChange = (newMode) => {
    onModeChange(newMode);
    if (location.pathname !== '/') {
      navigate('/');
    }
  };

  const handleSubModeChange = (newSubMode) => {
    onSubModeChange(newSubMode);
    if (location.pathname !== '/') {
      navigate('/');
    }
  };

  const handleHandyConnect = () => {
    if (handyConnected) {
      onHandyDisconnect();
    } else {
      onHandyConnect(localHandyCode);
    }
  };

  const handleVideoPathSubmit = (videoPath) => {
    // Open scene editor in new tab with video path as query param
    const url = `/scene-editor?video=${encodeURIComponent(videoPath)}`;
    window.open(url, '_blank');
    setShowVideoPathModal(false);
  };

  return (
    <AppBar position="sticky">
      <MuiToolbar sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap', minHeight: { xs: 56, sm: 64 }, py: { xs: 0.5, sm: 0 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          {/* Home. The bar had no way back to the gallery — the only route was
              clicking a mode segment, which nobody reads as "home". Goes
              through handleModeChange so the mode resets too; navigating to '/'
              alone would land you on the main route still filtered. */}
          <Tooltip title="Gallery">
            <IconButton
              onClick={() => handleModeChange('gallery')}
              aria-label="Go to gallery"
              sx={{
                p: 0.75,
                borderRadius: 'var(--radius, 6px)',
                border: '1px solid transparent',
                '&:hover': { bgcolor: 'var(--raised)', borderColor: 'var(--line)' }
              }}
            >
              <Logo size={26} />
            </IconButton>
          </Tooltip>

          <Divider orientation="vertical" flexItem sx={{ mx: 0.25, my: 1.25, borderColor: 'var(--line)' }} />

          {/* Mode toggle. A segmented control on the page background, so only
              the SELECTED segment carries the accent — with ButtonGroup
              variant="contained" both segments were filled and the inactive
              one relied on 'inherit' to look different. */}
          <Box
            role="group"
            aria-label="View mode"
            sx={{
              display: 'flex', gap: '2px', p: '2px',
              bgcolor: 'var(--bg)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius, 6px)'
            }}
          >
            {[['gallery', 'Gallery', <Image key="g" />], ['filter', 'Filter', <FilterList key="f" />]].map(([key, label, icon]) => (
              <Button
                key={key}
                onClick={() => handleModeChange(key)}
                startIcon={icon}
                size="small"
                disableElevation
                sx={{
                  fontSize: { xs: '0.7rem', sm: '0.8125rem' },
                  px: { xs: 1, sm: 1.75 },
                  minWidth: 0,
                  borderRadius: 'var(--radius-sm, 4px)',
                  fontWeight: mode === key ? 650 : 550,
                  color: mode === key ? 'var(--on-accent)' : 'var(--dim)',
                  bgcolor: mode === key ? 'var(--accent)' : 'transparent',
                  '&:hover': {
                    bgcolor: mode === key ? 'var(--accent-hover)' : 'var(--raised)',
                    color: mode === key ? 'var(--on-accent)' : 'var(--text)'
                  }
                }}
              >
                {label}
              </Button>
            ))}
          </Box>

          {/* Upload Folder — a secondary action, so outlined rather than a
              second filled accent competing with the active mode segment. */}
          <Button
            variant="outlined"
            onClick={() => navigate('/local-import')}
            startIcon={<FolderOpen />}
            size="small"
            sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
          >
            Upload Folder
          </Button>
          <Tooltip title="Upload Folder">
            <IconButton onClick={() => navigate('/local-import')} sx={{ display: { xs: 'inline-flex', sm: 'none' }, color: 'var(--dim)' }}>
              <FolderOpen />
            </IconButton>
          </Tooltip>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
          {/* Seven identical icon buttons in a row read as one undifferentiated
              block. Grouped by what they do — library tools, then AI/media —
              with a hairline between, and a single shared style so hover is
              the only thing that changes. */}
          {[
            [
              ['Scene Editor — open video file', <Videocam key="v" />, () => setShowVideoPathModal(true)],
              ['Performer Management', <People key="p" />, () => window.open('/performer-management', '_blank')],
              ['Hash-based duplicate detection', <Difference key="d" />, () => window.open('/hash-management', '_blank')]
            ],
            [
              // /tindersorting was routed in App.js but nothing in the UI ever
              // linked to it, so the page was unreachable without typing the
              // URL. It picks its own performer, so a bare link is enough.
              ['Tinder Sort — swipe to keep or delete', <Swipe key="t" />, () => navigate('/tindersorting')],
              ['Taste Dashboard — system health & AI', <Science key="s" />, () => navigate('/taste-dashboard')],
              ['Funpipe — funscript queue & library', <Waves key="w" />, () => navigate('/funpipe')]
            ]
          ].map((group, gi) => (
            <React.Fragment key={gi}>
              {gi > 0 && (
                <Divider orientation="vertical" flexItem sx={{ mx: 0.75, my: 1.25, borderColor: 'var(--line)' }} />
              )}
              {group.map(([title, icon, onClick]) => (
                <Tooltip title={title} key={title}>
                  <IconButton
                    onClick={onClick}
                    size="small"
                    sx={{ color: 'var(--dim)', '&:hover': { color: 'var(--text)', bgcolor: 'var(--raised)' } }}
                  >
                    {icon}
                  </IconButton>
                </Tooltip>
              ))}
            </React.Fragment>
          ))}

          <Divider orientation="vertical" flexItem sx={{ mx: 0.75, my: 1.25, borderColor: 'var(--line)' }} />

          <Tooltip title={vrSupported === false ? 'Enter VR — open this page on a headset (e.g. Quest 3)' : 'Enter VR mode'}>
            <span>
              <IconButton
                onClick={() => navigate('/vr')}
                disabled={vrSupported === false}
                size="small"
                sx={{
                  color: vrSupported ? 'var(--accent)' : 'var(--dim)',
                  '&:hover': { bgcolor: 'var(--raised)' },
                  '&.Mui-disabled': { color: 'var(--faint)' }
                }}
              >
                <ViewInAr />
              </IconButton>
            </span>
          </Tooltip>

          <Tooltip title="Keyboard shortcuts & settings">
            <IconButton
              onClick={() => setShowSettings(true)}
              size="small"
              sx={{ color: 'var(--dim)', '&:hover': { color: 'var(--text)', bgcolor: 'var(--raised)' } }}
            >
              <Settings />
            </IconButton>
          </Tooltip>

          {/* Handy connection. Reads as one control rather than a loose
              input + button pair. */}
          <Box sx={{
            display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: 0.5,
            ml: 1, pl: 1.25, py: '3px', pr: '3px',
            bgcolor: 'var(--bg)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius, 6px)'
          }}>
            <Box sx={{
              width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
              bgcolor: handyConnected ? 'var(--ok)' : 'var(--faint)'
            }} />
            <InputBase
              placeholder="Handy code"
              value={localHandyCode}
              onChange={(e) => {
                setLocalHandyCode(e.target.value);
                localStorage.setItem('handyConnectionCode', e.target.value);
              }}
              disabled={handyConnected}
              sx={{ flex: 1, width: 108, fontSize: '0.8rem', color: 'var(--text)' }}
            />
            <Button
              variant={handyConnected ? 'outlined' : 'contained'}
              color={handyConnected ? 'error' : 'primary'}
              onClick={handleHandyConnect}
              size="small"
              sx={{ minWidth: 0, px: 1.25 }}
            >
              {handyConnected ? 'Disconnect' : 'Connect'}
            </Button>
          </Box>
        </Box>
      </MuiToolbar>

      <ShortcutSettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        basePath={basePath}
        onFolderDeleted={onFolderDeleted}
        onThemeChange={onThemeChange}
        currentThemeId={currentThemeId}
      />



      <VideoPathModal
        open={showVideoPathModal}
        onClose={() => setShowVideoPathModal(false)}
        onSubmit={handleVideoPathSubmit}
      />
    </AppBar>
  );
}

export default Toolbar;