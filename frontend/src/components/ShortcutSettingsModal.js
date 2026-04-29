import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Alert,
  Divider,
  IconButton,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  CircularProgress,
  Chip,
  List,
  ListItem,
  ListItemText
} from '@mui/material';
import {
  Close as CloseIcon,
  Build as BuildIcon,
  CheckCircle,
  Warning
} from '@mui/icons-material';

import TagManager from './TagManager';
import { DEFAULT_SHORTCUTS, loadShortcuts, saveShortcuts } from '../utils/settings';
import { themes } from '../theme';

const ShortcutSettingsModal = ({ open = false, onClose = null, basePath = null, onFolderDeleted = null, onThemeChange = null, currentThemeId = 'default' }) => {
  const [shortcuts, setShortcuts] = useState(DEFAULT_SHORTCUTS);
  const [originalShortcuts, setOriginalShortcuts] = useState(DEFAULT_SHORTCUTS);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('info');
  const [recordingKey, setRecordingKey] = useState(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [saveDeletedForTraining, setSaveDeletedForTraining] = useState(false);

  // TrueNAS state
  const [trueNASStatus, setTrueNASStatus] = useState(null);
  const [trueNASLoading, setTrueNASLoading] = useState(false);
  const [trueNASFixing, setTrueNASFixing] = useState(false);
  const [trueNASFixResults, setTrueNASFixResults] = useState(null);

  useEffect(() => {
    if (open) {
      loadShortcuts().then(loadedShortcuts => {
        setShortcuts(loadedShortcuts);
        setOriginalShortcuts(loadedShortcuts);
      });
      
      // Load training setting
      fetch('/api/settings/save_deleted_for_training')
        .then(res => res.json())
        .then(data => {
          setSaveDeletedForTraining(data.value === 'true');
        })
        .catch(err => console.error('Error loading training setting:', err));

      // Check TrueNAS status
      checkTrueNASStatus();
    }
  }, [open]);

  const checkTrueNASStatus = async () => {
    setTrueNASLoading(true);
    try {
      const response = await fetch('/api/truenas/truenas-status');
      const data = await response.json();
      setTrueNASStatus(data);
    } catch (error) {
      console.error('Error checking TrueNAS status:', error);
      setTrueNASStatus({ error: 'Failed to check status' });
    }
    setTrueNASLoading(false);
  };

  const runTrueNASFixes = async () => {
    setTrueNASFixing(true);
    try {
      const response = await fetch('/api/truenas/run-truenas-fixes', { method: 'POST' });
      const data = await response.json();
      setTrueNASFixResults(data);
      await checkTrueNASStatus();
    } catch (error) {
      console.error('Error running TrueNAS fixes:', error);
      setTrueNASFixResults({ error: 'Failed to run fixes' });
    }
    setTrueNASFixing(false);
  };

  const handleShortcutChange = (action, value) => {
    setShortcuts(prev => ({
      ...prev,
      [action]: value
    }));
  };

  const startRecording = (action) => {
    setRecordingKey(action);
    setMessage(`Press any key for "${shortcutDescriptions[action]}"...`);
    setMessageType('info');
  };

  const stopRecording = () => {
    setRecordingKey(null);
    setMessage('');
  };

  // Handle key press recording
  useEffect(() => {
    if (!recordingKey) return;

    const handleKeyPress = (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      let keyValue = e.key;
      
      // Handle special keys
      if (e.key === ' ') keyValue = 'Space';
      if (e.key === 'Enter') keyValue = 'Enter';
      if (e.key === 'Escape') {
        stopRecording();
        return;
      }
      
      // Update the shortcut
      handleShortcutChange(recordingKey, keyValue);
      setMessage(`Shortcut set to: ${keyValue}`);
      setMessageType('success');
      
      // Stop recording after a short delay
      setTimeout(() => {
        stopRecording();
      }, 1000);
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [recordingKey]);

  const handleSave = async () => {
    const success = await saveShortcuts(shortcuts);
    
    // Save training setting
    try {
      await fetch('/api/settings/save_deleted_for_training', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: saveDeletedForTraining.toString() })
      });
    } catch (err) {
      console.error('Error saving training setting:', err);
    }
    
    if (success) {
      setMessage('Settings saved successfully!');
      setMessageType('success');
      setOriginalShortcuts(shortcuts);
      setTimeout(() => {
        if (onClose) {
          onClose();
        }
      }, 1500);
    } else {
      setMessage('Failed to save settings');
      setMessageType('error');
    }
  };

  const handleCancel = () => {
    setShortcuts(originalShortcuts);
    setMessage('');
    setRecordingKey(null);
    setTrueNASFixResults(null);
    if (onClose) {
      onClose();
    }
  };

  const handleReset = () => {
    setShortcuts(DEFAULT_SHORTCUTS);
    setMessage('Shortcuts reset to defaults');
    setMessageType('info');
    setRecordingKey(null);
  };

  const handleDeleteFolder = () => {
    if (!basePath) {
      setMessage('No folder selected');
      setMessageType('error');
      return;
    }
    setDeleteConfirmOpen(true);
  };

  const handleDeleteConfirm = async () => {
    try {
      // First, get the folder ID from the API
      const foldersResponse = await fetch('/api/folders');
      const folders = await foldersResponse.json();
      const currentFolder = folders.find(f => f.path === basePath);
      
      if (!currentFolder) {
        setMessage('Current folder not found in database');
        setMessageType('error');
        setDeleteConfirmOpen(false);
        return;
      }

      // Delete the folder from the app
      const response = await fetch(`/api/folders/${currentFolder.id}`, {
        method: 'DELETE'
      });

      const result = await response.json();
      
      if (result.success) {
        setMessage('Folder deleted successfully from app');
        setMessageType('success');
        setDeleteConfirmOpen(false);
        
        // Call the callback to update the parent component
        if (onFolderDeleted) {
          onFolderDeleted();
        }
        
        // Close the modal after a short delay
        setTimeout(() => {
          if (onClose) {
            onClose();
          }
        }, 1500);
      } else {
        setMessage(result.error || 'Failed to delete folder');
        setMessageType('error');
        setDeleteConfirmOpen(false);
      }
    } catch (error) {
      console.error('Error deleting folder:', error);
      setMessage('Error deleting folder');
      setMessageType('error');
      setDeleteConfirmOpen(false);
    }
  };

  const handleDeleteCancel = () => {
    setDeleteConfirmOpen(false);
  };

  const shortcutDescriptions = {
    keep: 'Keep file',
    delete: 'Delete file',
    move_to_funscript: 'Move to funscript folder',
    undo: 'Undo last action',
    prev: 'Previous file',
    next: 'Next file'
  };

  if (!open) {
    return null;
  }

  const SectionTitle = ({ children, color = 'primary.main' }) => (
    <Typography variant="h6" sx={{ color, fontWeight: 'bold', mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
      {children}
    </Typography>
  );

  return (
    <>
      <Dialog
        open={true}
        onClose={recordingKey ? undefined : handleCancel}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            bgcolor: 'background.paper',
            backgroundImage: 'none',
            maxHeight: '90vh',
          }
        }}
      >
        {/* Header */}
        <DialogTitle sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid',
          borderColor: 'divider',
          pb: 2,
        }}>
          <Typography variant="h5" sx={{ color: 'primary.main', fontWeight: 'bold' }}>
            ⚙️ Settings
          </Typography>
          <IconButton onClick={recordingKey ? undefined : handleCancel} sx={{ color: 'text.secondary' }}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>

        <DialogContent sx={{ p: 3, '&:first-of-type': { pt: 3 } }}>
          {/* TagManager */}
          {basePath && (
            <Box sx={{ mb: 3 }}>
              <TagManager basePath={basePath} />
            </Box>
          )}

          {message && (
            <Alert severity={messageType} sx={{ mb: 2 }}>
              {message}
            </Alert>
          )}

          {/* Theme Picker */}
          <Box sx={{ mb: 3 }}>
            <SectionTitle>🎨 App Theme</SectionTitle>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 1.5 }}>
              {Object.entries(themes).map(([id, { label, emoji, desc, theme: t }]) => {
                const isActive = id === currentThemeId;
                const primary = t.palette.primary.main;
                const secondary = t.palette.secondary?.main || t.palette.primary.light;
                const bg = t.palette.background.paper;
                return (
                  <Box
                    key={id}
                    onClick={() => onThemeChange && onThemeChange(id)}
                    sx={{
                      cursor: 'pointer',
                      p: 1.5,
                      borderRadius: 2,
                      border: '2px solid',
                      borderColor: isActive ? 'primary.main' : 'divider',
                      bgcolor: isActive ? 'rgba(255,255,255,0.05)' : 'transparent',
                      transition: 'all 0.2s',
                      '&:hover': { borderColor: primary, bgcolor: 'rgba(255,255,255,0.03)' },
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <Typography sx={{ fontSize: '1.2rem' }}>{emoji}</Typography>
                      <Typography variant="body2" sx={{ fontWeight: isActive ? 700 : 500, color: isActive ? 'primary.main' : 'text.primary', fontSize: '0.8rem' }}>
                        {label}
                      </Typography>
                    </Box>
                    {/* Color swatches */}
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      <Box sx={{ width: 20, height: 12, borderRadius: 0.5, bgcolor: primary }} />
                      <Box sx={{ width: 20, height: 12, borderRadius: 0.5, bgcolor: secondary }} />
                      <Box sx={{ width: 20, height: 12, borderRadius: 0.5, bgcolor: bg, border: '1px solid rgba(255,255,255,0.1)' }} />
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block', fontSize: '0.65rem' }}>
                      {desc}
                    </Typography>
                  </Box>
                );
              })}
            </Box>
          </Box>

          <Divider sx={{ my: 2 }} />

          {/* Shortcuts Section */}
          <Box sx={{ mb: 3 }}>
            <SectionTitle>⌨️ Keyboard Shortcuts</SectionTitle>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {Object.entries(shortcutDescriptions).map(([action, description]) => (
                <Box key={action} sx={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 2,
                  p: 1.5,
                  bgcolor: 'rgba(255,255,255,0.03)',
                  borderRadius: 2,
                  border: '1px solid',
                  borderColor: recordingKey === action ? 'primary.main' : 'divider',
                  transition: 'border-color 0.2s',
                }}>
                  <Typography sx={{ 
                    flex: 1,
                    fontWeight: 500,
                    color: 'text.primary',
                    fontSize: '0.9rem',
                  }}>
                    {description}
                  </Typography>
                  <Button
                    variant={recordingKey === action ? "contained" : "outlined"}
                    size="small"
                    onClick={() => startRecording(action)}
                    disabled={recordingKey && recordingKey !== action}
                    sx={{ 
                      minWidth: 100,
                      fontWeight: 'bold',
                      fontFamily: 'monospace',
                      ...(recordingKey === action ? {
                        animation: 'pulse 1s infinite',
                        '@keyframes pulse': {
                          '0%, 100%': { opacity: 1 },
                          '50%': { opacity: 0.7 },
                        },
                      } : {}),
                    }}
                  >
                    {recordingKey === action ? '● Recording' : (shortcuts[action] || 'Set key')}
                  </Button>
                  {shortcuts[action] && recordingKey !== action && (
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => handleShortcutChange(action, '')}
                      sx={{ p: 0.5 }}
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  )}
                </Box>
              ))}
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block', textAlign: 'center' }}>
              Click a button and press any key. Press Escape to cancel.
            </Typography>
          </Box>

          <Divider sx={{ my: 2 }} />

          {/* ML Training Section */}
          <Box sx={{ mb: 3 }}>
            <SectionTitle>🧠 Machine Learning Training</SectionTitle>
            <Box sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              p: 2,
              bgcolor: 'rgba(126, 87, 194, 0.08)',
              borderRadius: 2,
              border: '1px solid',
              borderColor: 'divider',
            }}>
              <Box sx={{ flex: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  Save deleted files for ML training
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Moves deleted files to a training folder instead of permanently deleting.
                </Typography>
              </Box>
              <Button
                variant={saveDeletedForTraining ? "contained" : "outlined"}
                color={saveDeletedForTraining ? "success" : "primary"}
                size="small"
                onClick={() => setSaveDeletedForTraining(!saveDeletedForTraining)}
                disabled={!!recordingKey}
                sx={{ minWidth: 60, fontWeight: 'bold' }}
              >
                {saveDeletedForTraining ? 'ON' : 'OFF'}
              </Button>
            </Box>
            {saveDeletedForTraining && (
              <Alert severity="info" sx={{ mt: 1 }} variant="outlined">
                <strong>Path:</strong> {basePath || '{basePath}'}/deleted keep for training/<em>performer</em>/
              </Alert>
            )}
          </Box>

          <Divider sx={{ my: 2 }} />

          {/* TrueNAS Compatibility Section */}
          <Box sx={{ mb: 3 }}>
            <SectionTitle>
              <BuildIcon fontSize="small" /> TrueNAS Compatibility
            </SectionTitle>
            {trueNASLoading ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 2 }}>
                <CircularProgress size={20} />
                <Typography variant="body2" color="text.secondary">Checking status...</Typography>
              </Box>
            ) : trueNASStatus ? (
              <Box>
                {trueNASStatus.error ? (
                  <Alert severity="error">{trueNASStatus.error}</Alert>
                ) : (
                  <>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                      {trueNASStatus.compatible ? (
                        <Chip icon={<CheckCircle />} label="System Compatible" color="success" size="small" />
                      ) : (
                        <Chip icon={<Warning />} label="Issues Detected" color="warning" size="small" />
                      )}
                    </Box>

                    {!trueNASStatus.compatible && (
                      <Box>
                        <Box sx={{ display: 'flex', gap: 1, mb: 1, flexWrap: 'wrap' }}>
                          {trueNASStatus.issues?.duplicateFunscriptFolders > 0 && (
                            <Chip label={`${trueNASStatus.issues.duplicateFunscriptFolders} Duplicate Funscript Folders`} color="warning" size="small" variant="outlined" />
                          )}
                          {trueNASStatus.issues?.missingFolders > 0 && (
                            <Chip label={`${trueNASStatus.issues.missingFolders} Missing Folders`} color="error" size="small" variant="outlined" />
                          )}
                          {trueNASStatus.issues?.pathCaseIssues > 0 && (
                            <Chip label={`${trueNASStatus.issues.pathCaseIssues} Path Casing Issues`} color="warning" size="small" variant="outlined" />
                          )}
                        </Box>

                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                          {trueNASStatus.recommendedAction}
                        </Typography>

                        {trueNASStatus.detailedIssues?.length > 0 && (
                          <Box sx={{ maxHeight: 120, overflow: 'auto', bgcolor: 'rgba(255,255,255,0.03)', borderRadius: 1, p: 1 }}>
                            {trueNASStatus.detailedIssues.slice(0, 5).map((issue, i) => (
                              <Typography key={i} variant="caption" color="text.secondary" display="block">• {issue}</Typography>
                            ))}
                            {trueNASStatus.detailedIssues.length > 5 && (
                              <Typography variant="caption" color="text.secondary">... and {trueNASStatus.detailedIssues.length - 5} more</Typography>
                            )}
                          </Box>
                        )}

                        <Button
                          onClick={runTrueNASFixes}
                          variant="contained"
                          size="small"
                          disabled={trueNASFixing}
                          startIcon={trueNASFixing ? <CircularProgress size={16} /> : <BuildIcon />}
                          sx={{ mt: 1.5 }}
                        >
                          {trueNASFixing ? 'Running Fixes...' : 'Run Fixes'}
                        </Button>
                      </Box>
                    )}

                    {trueNASFixResults && (
                      <Alert severity={trueNASFixResults.error ? "error" : "success"} sx={{ mt: 1 }}>
                        {trueNASFixResults.error || `Fixed ${trueNASFixResults.fixedPerformers} performers.`}
                      </Alert>
                    )}
                  </>
                )}
              </Box>
            ) : null}
            <Button onClick={checkTrueNASStatus} disabled={trueNASLoading} size="small" sx={{ mt: 1 }}>
              Refresh Status
            </Button>
          </Box>

          <Divider sx={{ my: 2 }} />

          {/* Danger Zone */}
          <Box>
            <SectionTitle color="error.main">⚠️ Danger Zone</SectionTitle>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              Remove the current folder and all its data from the app. Files on disk are not deleted.
            </Typography>
            {basePath ? (
              <Button
                variant="outlined"
                color="error"
                size="small"
                disabled={!!recordingKey}
                onClick={handleDeleteFolder}
                sx={{ fontWeight: 'bold' }}
              >
                Delete Current Folder from App
              </Button>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                No folder selected
              </Typography>
            )}
          </Box>
        </DialogContent>

        {/* Actions */}
        <DialogActions sx={{ borderTop: '1px solid', borderColor: 'divider', p: 2 }}>
          <Button onClick={handleReset} color="warning" disabled={!!recordingKey} size="small">
            Reset Defaults
          </Button>
          <Box sx={{ flex: 1 }} />
          <Button onClick={handleCancel} disabled={!!recordingKey}>
            Cancel
          </Button>
          <Button onClick={handleSave} variant="contained" disabled={!!recordingKey}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
      
      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteConfirmOpen}
        onClose={handleDeleteCancel}
      >
        <DialogTitle sx={{ color: 'error.main' }}>
          Delete Folder from App
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to remove the current folder and all its saved data from the app?
            <br /><br />
            <strong>Folder:</strong> {basePath || 'No folder selected'}
            <br /><br />
            <strong>This will permanently delete:</strong>
            <br />
            • All performer data and statistics
            <br />
            • All filter actions and history
            <br />
            • All tags and settings for this folder
            <br />
            • Content genre information
            <br /><br />
            <strong style={{ color: '#4caf50' }}>Your files will NOT be deleted from the system.</strong>
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteCancel}>Cancel</Button>
          <Button onClick={handleDeleteConfirm} color="error" variant="contained">
            Delete from App
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default ShortcutSettingsModal;
