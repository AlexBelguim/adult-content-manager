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
  Backdrop
} from '@mui/material';
import {
  Close as CloseIcon
} from '@mui/icons-material';

import TagManager from './TagManager';
import { DEFAULT_SHORTCUTS, loadShortcuts, saveShortcuts } from '../utils/settings';

const ShortcutSettingsModal = ({ open = false, onClose = null, basePath = null, onFolderDeleted = null }) => {
  const [shortcuts, setShortcuts] = useState(DEFAULT_SHORTCUTS);
  const [originalShortcuts, setOriginalShortcuts] = useState(DEFAULT_SHORTCUTS);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('info');
  const [recordingKey, setRecordingKey] = useState(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [saveDeletedForTraining, setSaveDeletedForTraining] = useState(false);

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
    }
  }, [open]);

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

  // Debug logging
  console.log('ShortcutSettingsModal props:', { open, onClose, basePath, onFolderDeleted });

  // Don't render if required props are missing
  if (!open) {
    return null;
  }

  return (
    <>
      <Backdrop
        sx={{ color: '#fff', zIndex: (theme) => theme.zIndex.drawer + 1 }}
        open={true}
        onClick={recordingKey ? undefined : handleCancel}
      />
      <Box sx={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: { xs: '90%', sm: '80%', md: '60%' },
        maxWidth: 600,
        maxHeight: '90vh',
        overflow: 'auto',
        bgcolor: '#ffffff',
        borderRadius: 3,
        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        border: '1px solid #e0e0e0',
        p: 0,
        zIndex: (theme) => theme.zIndex.drawer + 2
      }}>

        {/* Header */}
        <Box sx={{
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          p: 3,
          pb: 2,
          borderBottom: '2px solid #e0e0e0',
          bgcolor: '#f8f9fa',
          position: 'relative'
        }}>
          <Box>
            <Typography variant="h6" sx={{ color: '#1976d2', fontWeight: 'bold', mb: 0.5, letterSpacing: 0.5 }}>
              Shortcuts & Tags
            </Typography>
          </Box>
          <IconButton onClick={recordingKey ? undefined : handleCancel} sx={{
            color: '#666666',
            position: 'absolute',
            top: 16,
            right: 16,
            zIndex: 2,
            '&:hover': { bgcolor: '#e0e0e0' }
          }}>
            <CloseIcon />
          </IconButton>
        </Box>

        {/* TagManager in its own row/section */}
        {basePath && (
          <Box sx={{ px: 3, pt: 2, pb: 0 }}>
            <TagManager basePath={basePath} />
          </Box>
        )}

        <Box sx={{ p: 3 }}>
          {message && (
            <Alert severity={messageType} sx={{ mb: 2 }}>
              {message}
            </Alert>
          )}

          {/* Shortcuts Section */}
          <Box sx={{ mb: 4 }}>
            <Typography variant="h6" sx={{ color: '#1976d2', fontWeight: 'bold', mb: 2 }}>
              Keyboard Shortcuts
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {Object.entries(shortcutDescriptions).map(([action, description]) => (
                <Box key={action} sx={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 3,
                  p: 2,
                  bgcolor: '#f8f9fa',
                  borderRadius: 2,
                  border: '1px solid #e0e0e0'
                }}>
                  <Typography sx={{ 
                    minWidth: 180,
                    fontWeight: 'medium',
                    color: '#1a1a1a'
                  }}>
                    {description}:
                  </Typography>
                  <Button
                    variant={recordingKey === action ? "contained" : "outlined"}
                    size="medium"
                    onClick={() => startRecording(action)}
                    disabled={recordingKey && recordingKey !== action}
                    sx={{ 
                      minWidth: 120,
                      fontWeight: 'bold',
                      textTransform: 'none',
                      backgroundColor: recordingKey === action ? '#ff9800' : undefined,
                      '&:hover': {
                        backgroundColor: recordingKey === action ? '#f57c00' : undefined
                      }
                    }}
                  >
                    {recordingKey === action ? 'Recording...' : (shortcuts[action] || 'Click to set')}
                  </Button>
                  {shortcuts[action] && recordingKey !== action && (
                    <Button
                      size="medium"
                      color="error"
                      variant="outlined"
                      onClick={() => handleShortcutChange(action, '')}
                      sx={{ 
                        minWidth: 80,
                        fontWeight: 'bold',
                        textTransform: 'none'
                      }}
                    >
                      Clear
                    </Button>
                  )}
                </Box>
              ))}
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 3, mb: 0, fontStyle: 'italic', textAlign: 'center' }}>
              <strong>Instructions:</strong> Click a button and press any key to set a shortcut. Press Escape to cancel recording.
            </Typography>
          </Box>

          <Divider sx={{ my: 3 }} />

          {/* ML Training Section */}
          <Box sx={{ mb: 4 }}>
            <Typography variant="h6" sx={{ color: '#1976d2', fontWeight: 'bold', mb: 2 }}>
              Machine Learning Training
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Save deleted files to train local vision-language models (LLaVA, Deepseek-VL) on your preferences.
            </Typography>
            <Box sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              p: 2,
              bgcolor: '#f0f7ff',
              borderRadius: 2,
              border: '1px solid #e3f2fd'
            }}>
              <Box sx={{ flex: 1 }}>
                <Typography variant="body1" sx={{ fontWeight: 'medium', mb: 0.5 }}>
                  Save deleted files for ML training
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  When enabled, deleted files are moved to "deleted keep for training" folder organized by performer instead of being permanently deleted.
                </Typography>
              </Box>
              <Button
                variant={saveDeletedForTraining ? "contained" : "outlined"}
                color={saveDeletedForTraining ? "success" : "primary"}
                size="large"
                onClick={() => setSaveDeletedForTraining(!saveDeletedForTraining)}
                disabled={!!recordingKey}
                sx={{
                  minWidth: 120,
                  fontWeight: 'bold',
                  textTransform: 'none'
                }}
              >
                {saveDeletedForTraining ? 'ON' : 'OFF'}
              </Button>
            </Box>
            {saveDeletedForTraining && (
              <Alert severity="info" sx={{ mt: 2 }}>
                <strong>Folder structure:</strong> {basePath || '{basePath}'}/deleted keep for training/{'{'}<em>performer</em>{'}'}/pics/ or /vids/
              </Alert>
            )}
          </Box>

          <Divider sx={{ my: 3 }} />

          {/* Danger Zone Section */}
          <Box sx={{ mb: 4 }}>
            <Typography variant="h6" sx={{ color: '#d32f2f', fontWeight: 'bold', mb: 2 }}>
              Danger Zone
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Permanently remove the current folder and all its saved data from the app. 
              This will not delete files from your system.
            </Typography>
            {basePath ? (
              <Button
                variant="outlined"
                color="error"
                size="large"
                disabled={!!recordingKey}
                onClick={handleDeleteFolder}
                sx={{
                  fontWeight: 'bold',
                  textTransform: 'none',
                  borderWidth: 2,
                  '&:hover': {
                    borderWidth: 2,
                    backgroundColor: '#ffebee'
                  }
                }}
              >
                Delete Current Folder from App
              </Button>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                No folder selected
              </Typography>
            )}
          </Box>

          <Divider sx={{ my: 3 }} />

          {/* Note at the very bottom */}
          <Typography variant="body2" color="text.secondary" sx={{ 
            fontStyle: 'italic',
            textAlign: 'center',
            p: 2,
            bgcolor: '#f0f7ff',
            borderRadius: 2,
            border: '1px solid #e3f2fd',
            mb: 0
          }}>
            <strong>Note:</strong> Changes take effect after saving. Click a button and press any key to record a shortcut.
          </Typography>
        </Box>

        {/* Actions */}
        <Box sx={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 2,
          p: 3,
          borderTop: '1px solid #e0e0e0',
          bgcolor: '#f8f9fa'
        }}>
          <Button 
            onClick={handleReset} 
            color="warning" 
            disabled={!!recordingKey}
            sx={{
              fontWeight: 'bold',
              textTransform: 'none',
              px: 3,
              py: 1
            }}
          >
            Reset to Defaults
          </Button>
          <Button 
            onClick={handleCancel} 
            disabled={!!recordingKey}
            sx={{
              fontWeight: 'bold',
              textTransform: 'none',
              px: 3,
              py: 1
            }}
          >
            Cancel
          </Button>
          <Button 
            onClick={handleSave} 
            variant="contained" 
            disabled={!!recordingKey}
            sx={{
              fontWeight: 'bold',
              textTransform: 'none',
              px: 3,
              py: 1
            }}
          >
            Save
          </Button>
        </Box>
      </Box>
      
      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteConfirmOpen}
        onClose={handleDeleteCancel}
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-description"
      >
        <DialogTitle id="delete-dialog-title" sx={{ color: '#d32f2f' }}>
          Delete Folder from App
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="delete-dialog-description">
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
          <Button onClick={handleDeleteCancel} color="primary">
            Cancel
          </Button>
          <Button onClick={handleDeleteConfirm} color="error" variant="contained">
            Delete from App
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default ShortcutSettingsModal;
