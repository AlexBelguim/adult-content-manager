import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AppBar, Toolbar as MuiToolbar, Button, IconButton, InputBase, Box, Tooltip, ButtonGroup } from '@mui/material';
import { Settings, Image, FilterList, Add, FolderOpen, Videocam, People, Difference, Science } from '@mui/icons-material';
import ShortcutSettingsModal from './ShortcutSettingsModal';

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
  isScanning = false,
  onThemeChange = null,
  currentThemeId = 'default'
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [localHandyCode, setLocalHandyCode] = useState(() => localStorage.getItem('handyConnectionCode') || handyCode || '');
  const [showSettings, setShowSettings] = useState(false);

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
      <MuiToolbar sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap', minHeight: { xs: 56, sm: 64 }, py: { xs: 0.5, sm: 0 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <ButtonGroup variant="contained" aria-label="outlined primary button group" size="small">
            <Button 
              color={mode === 'gallery' ? 'primary' : 'inherit'} 
              onClick={() => handleModeChange('gallery')}
              startIcon={<Image />}
              sx={{ fontSize: { xs: '0.7rem', sm: '0.8125rem' }, px: { xs: 1, sm: 2 } }}
            >
              Gallery
            </Button>
            <Button 
              color={mode === 'filter' ? 'primary' : 'inherit'} 
              onClick={() => handleModeChange('filter')}
              startIcon={<FilterList />}
              sx={{ fontSize: { xs: '0.7rem', sm: '0.8125rem' }, px: { xs: 1, sm: 2 } }}
            >
              Filter
            </Button>
          </ButtonGroup>

        {/* Upload Folder button - only show in filter mode */}
        {mode === 'filter' && (
          <>
            <Button
              variant="contained"
              color="secondary"
              onClick={() => navigate('/upload-queue')}
              startIcon={<FolderOpen />}
              size="small"
              sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
            >
              Upload Folder
            </Button>
            <Tooltip title="Upload Folder">
              <IconButton color="secondary" onClick={() => navigate('/upload-queue')} sx={{ display: { xs: 'inline-flex', sm: 'none' } }}>
                <FolderOpen />
              </IconButton>
            </Tooltip>
            <Button
              variant="contained"
              onClick={() => navigate('/local-import')}
              startIcon={<Add />}
              sx={{ background: 'linear-gradient(135deg, #4CAF50 0%, #66BB6A 100%)', color: 'white', display: { xs: 'none', sm: 'inline-flex' } }}
              size="small"
            >
              Local Import
            </Button>
            <Tooltip title="Local Import">
              <IconButton sx={{ color: '#66BB6A', display: { xs: 'inline-flex', sm: 'none' } }} onClick={() => navigate('/local-import')}>
                <Add />
              </IconButton>
            </Tooltip>
          </>
        )}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Tooltip title="Scene Editor - Open Video File">
            <IconButton color="inherit" onClick={() => setShowVideoPathModal(true)} size="small">
              <Videocam />
            </IconButton>
          </Tooltip>

          <Tooltip title="Performer Management">
            <IconButton color="inherit" onClick={() => window.open('/performer-management', '_blank')} size="small">
              <People />
            </IconButton>
          </Tooltip>

          <Tooltip title="Hash-Based Duplicate Detection">
            <IconButton color="inherit" onClick={() => window.open('/hash-management', '_blank')} size="small">
              <Difference />
            </IconButton>
          </Tooltip>

          <Tooltip title="Pairwise Labeler - Train Image Preference Model">
            <IconButton color="inherit" onClick={() => navigate('/pairwise')} size="small">
              <Science />
            </IconButton>
          </Tooltip>

          <Tooltip title="Keyboard Shortcuts Settings">
            <IconButton color="inherit" onClick={() => setShowSettings(true)} size="small">
              <Settings />
            </IconButton>
          </Tooltip>



          <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: 1, ml: 1, bgcolor: 'background.paper', p: 0.5, borderRadius: 1 }}>
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