import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AppBar, Toolbar as MuiToolbar, Button, IconButton, InputBase, Box, Tooltip, ButtonGroup } from '@mui/material';
import { Settings, Build, Image, FilterList, Add, FolderOpen, Videocam, People, Difference, Science } from '@mui/icons-material';
import ShortcutSettingsModal from './ShortcutSettingsModal';
import TrueNASFixModal from './TrueNASFixModal';
import './Toolbar.css';

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
        backgroundColor: '#1e1e1e',
        padding: '24px',
        borderRadius: '12px',
        minWidth: '500px',
        maxWidth: '800px',
        border: '1px solid rgba(255,255,255,0.1)'
      }} onClick={e => e.stopPropagation()}>
        <h3 style={{ color: '#fff', marginTop: 0 }}>🎬 Open Video in Scene Editor</h3>
        <p style={{ color: '#aaa', fontSize: '14px' }}>
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
            backgroundColor: '#121212',
            border: '1px solid #444',
            borderRadius: '8px',
            color: '#fff',
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
  isScanning = false
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [localHandyCode, setLocalHandyCode] = useState(() => localStorage.getItem('handyConnectionCode') || handyCode || '');
  const [showSettings, setShowSettings] = useState(false);
  const [showTrueNASFix, setShowTrueNASFix] = useState(false);
  const [showVideoPathModal, setShowVideoPathModal] = useState(false);

  const handleModeChange = (newMode) => {
    onModeChange(newMode);
  };

  const handleSubModeChange = (newSubMode) => {
    onSubModeChange(newSubMode);
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
      <MuiToolbar sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <ButtonGroup variant="contained" aria-label="outlined primary button group" size="small">
            <Button 
              color={mode === 'gallery' ? 'primary' : 'inherit'} 
              onClick={() => handleModeChange('gallery')}
              startIcon={<Image />}
            >
              Gallery
            </Button>
            <Button 
              color={mode === 'filter' ? 'primary' : 'inherit'} 
              onClick={() => handleModeChange('filter')}
              startIcon={<FilterList />}
            >
              Filter
            </Button>
          </ButtonGroup>

        {/* Scan button - HIDDEN
        {mode === 'filter' && onScanPerformers && (
          <button
            className="scan-performers-btn"
            onClick={onScanPerformers}
            disabled={isScanning}
          >
            {isScanning ? '🔄 Scanning...' : '🔍 Scan Performers'}
          </button>
        )}
        */}

        {/* Upload Folder button - only show in filter mode */}
        {mode === 'filter' && (
          <>
            <Button
              variant="contained"
              color="secondary"
              onClick={() => navigate('/upload-queue')}
              startIcon={<FolderOpen />}
              size="small"
            >
              Upload Folder
            </Button>
            <Button
              variant="contained"
              onClick={() => navigate('/local-import')}
              startIcon={<Add />}
              sx={{ background: 'linear-gradient(135deg, #4CAF50 0%, #66BB6A 100%)', color: 'white' }}
              size="small"
            >
              Local Import
            </Button>
          </>
        )}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Tooltip title="Scene Editor - Open Video File">
            <IconButton color="inherit" onClick={() => setShowVideoPathModal(true)}>
              <Videocam />
            </IconButton>
          </Tooltip>

          <Tooltip title="Performer Management">
            <IconButton color="inherit" onClick={() => window.open('/performer-management', '_blank')}>
              <People />
            </IconButton>
          </Tooltip>

          <Tooltip title="Hash-Based Duplicate Detection">
            <IconButton color="inherit" onClick={() => window.open('/hash-management', '_blank')}>
              <Difference />
            </IconButton>
          </Tooltip>

          <Tooltip title="Pairwise Labeler - Train Image Preference Model">
            <IconButton color="inherit" onClick={() => navigate('/pairwise')}>
              <Science />
            </IconButton>
          </Tooltip>

          <Tooltip title="Keyboard Shortcuts Settings">
            <IconButton color="inherit" onClick={() => setShowSettings(true)}>
              <Settings />
            </IconButton>
          </Tooltip>

          <Tooltip title="TrueNAS Compatibility Fixes">
            <IconButton color="inherit" onClick={() => setShowTrueNASFix(true)}>
              <Build />
            </IconButton>
          </Tooltip>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: 2, bgcolor: 'background.paper', p: 0.5, borderRadius: 1 }}>
            <InputBase
              placeholder="Handy Code"
              value={localHandyCode}
              onChange={(e) => {
                setLocalHandyCode(e.target.value);
                localStorage.setItem('handyConnectionCode', e.target.value);
              }}
              disabled={handyConnected}
              sx={{ ml: 1, flex: 1, width: 120, fontSize: '0.875rem' }}
            />
            <Button
              variant={handyConnected ? "outlined" : "contained"}
              color={handyConnected ? "error" : "primary"}
              onClick={handleHandyConnect}
              size="small"
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
      />

      <TrueNASFixModal
        open={showTrueNASFix}
        onClose={() => setShowTrueNASFix(false)}
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