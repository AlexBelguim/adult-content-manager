import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
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
        backgroundColor: '#2d2d30',
        padding: '24px',
        borderRadius: '8px',
        minWidth: '500px',
        maxWidth: '800px'
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
            backgroundColor: '#1a1a1a',
            border: '1px solid #444',
            borderRadius: '4px',
            color: '#fff',
            marginBottom: '16px',
            boxSizing: 'border-box'
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px',
              backgroundColor: '#444',
              border: 'none',
              borderRadius: '4px',
              color: '#fff',
              cursor: 'pointer'
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!videoPath.trim()}
            style={{
              padding: '8px 16px',
              backgroundColor: videoPath.trim() ? '#2196F3' : '#555',
              border: 'none',
              borderRadius: '4px',
              color: '#fff',
              cursor: videoPath.trim() ? 'pointer' : 'not-allowed'
            }}
          >
            Open
          </button>
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
    <div className="toolbar">
      <div className="toolbar-left">
        <div className="mode-toggle">
          <button
            className={mode === 'gallery' ? 'active' : ''}
            onClick={() => handleModeChange('gallery')}
          >
            Gallery
          </button>
          <button
            className={mode === 'filter' ? 'active' : ''}
            onClick={() => handleModeChange('filter')}
          >
            Filter
          </button>
        </div>

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
          <button
            className="upload-folder-btn"
            onClick={() => navigate('/upload-queue')}
            style={{
              marginLeft: '8px',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              color: 'white',
              border: 'none',
              padding: '8px 16px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: '600',
              fontSize: '14px'
            }}
            title="Upload a folder directly instead of scanning"
          >
            📁 Upload Folder
          </button>
        )}
      </div>

      <div className="toolbar-right">
        <div className="sidebar-controls">
          <button
            className="settings-btn"
            onClick={() => setShowVideoPathModal(true)}
            title="Scene Editor - Open Video File"
          >
            🎬
          </button>

          <button
            className="settings-btn"
            onClick={() => window.open('/performer-management', '_blank')}
            title="Performer Management"
          >
            👥
          </button>

          <button
            className="settings-btn"
            onClick={() => window.open('/hash-management', '_blank')}
            title="Hash-Based Duplicate Detection"
            style={{ marginLeft: '5px' }}
          >
            ⚖️
          </button>

          <button
            className="settings-btn"
            onClick={() => navigate('/pairwise')}
            title="Pairwise Labeler - Train Image Preference Model"
            style={{ marginLeft: '5px' }}
          >
            🎯
          </button>



          <button
            className="settings-btn"
            onClick={() => setShowSettings(true)}
            title="Keyboard Shortcuts Settings"
            style={{ marginLeft: '5px' }}
          >
            ⚙️
          </button>

          <button
            className="settings-btn"
            onClick={() => setShowTrueNASFix(true)}
            title="TrueNAS Compatibility Fixes"
            style={{ marginLeft: '5px' }}
          >
            🔧
          </button>

          <div className="handy-section">
            <input
              type="text"
              placeholder="Handy Connection Code"
              value={localHandyCode}
              onChange={(e) => {
                setLocalHandyCode(e.target.value);
                localStorage.setItem('handyConnectionCode', e.target.value);
              }}
              className="handy-input"
              disabled={handyConnected}
            />
            <button
              className={`handy-btn ${handyConnected ? 'connected' : ''}`}
              onClick={handleHandyConnect}
            >
              {handyConnected ? 'Disconnect' : 'Connect'}
            </button>
            {handyConnected && (
              <span className="handy-status">
                🔗 Connected
              </span>
            )}
          </div>
        </div>
      </div>

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
    </div>
  );
}

export default Toolbar;