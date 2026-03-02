import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  Box,
  Typography,
  Button,
  FormGroup,
  FormControlLabel,
  Checkbox,
  IconButton,
  Divider,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions
} from '@mui/material';
import {
  Close as CloseIcon,
  CheckCircle as CheckIcon,
  Warning as WarningIcon,
  Delete as DeleteIcon,
  MoveUp as MoveIcon
} from '@mui/icons-material';

const phoneModalStyle = {
  position: 'absolute',
  top: '5%',
  left: '5%',
  width: '90%',
  maxHeight: '90%',
  bgcolor: 'background.paper',
  borderRadius: '12px',
  boxShadow: 24,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden'
};

const phoneHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  p: 2,
  borderBottom: '1px solid',
  borderColor: 'divider',
  bgcolor: 'primary.main',
  color: 'primary.contrastText'
};

const phoneContentStyle = {
  flex: 1,
  overflow: 'auto',
  p: 2
};

function PhonePerformerSettingsModal({ performer, open, onClose, onUpdate }) {
  const [settings, setSettings] = useState(null);
  const [completionState, setCompletionState] = useState({
    pics: false,
    vids: false,
    funscript_vids: false
  });
  const [confirmDialog, setConfirmDialog] = useState({ open: false, type: '', title: '', message: '' });
  const [handyCode, setHandyCode] = useState(() => localStorage.getItem('handyConnectionCode') || '');

  const fetchSettings = useCallback(async () => {
    if (!performer?.id) return;
    
    try {
      const response = await fetch(`/api/performers/${performer.id}/settings`);
      if (response.ok) {
        const data = await response.json();
        setSettings(data);
        setCompletionState({
          pics: data.filteringComplete.pics,
          vids: data.filteringComplete.vids,
          funscript_vids: data.filteringComplete.funscript_vids
        });
      }
    } catch (error) {
      console.error('Error fetching settings:', error);
    }
  }, [performer?.id]);

  useEffect(() => {
    if (open) {
      const savedCode = localStorage.getItem('handyConnectionCode') || '';
      setHandyCode(savedCode);
    }
  }, [open]);

  useEffect(() => {
    if (open && performer?.id) {
      fetchSettings();
    }
  }, [open, performer?.id, fetchSettings]);

  const handleMarkComplete = async () => {
    if (!performer?.id) return;
    
    const categories = Object.keys(completionState).filter(key => completionState[key]);
    
    if (categories.length === 0) {
      return;
    }

    try {
      const response = await fetch(`/api/performers/${performer.id}/mark-complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categories })
      });

      if (response.ok) {
        await fetchSettings();
        if (onUpdate) onUpdate();
      }
    } catch (error) {
      console.error('Error marking complete:', error);
    }
  };

  const handleDeleteData = async () => {
    if (!performer?.id) return;
    
    try {
      const response = await fetch(`/api/performers/${performer.id}/data`, {
        method: 'DELETE'
      });

      if (response.ok) {
        if (onUpdate) onUpdate();
        onClose();
      }
    } catch (error) {
      console.error('Error deleting data:', error);
    }
  };

  const handleDeleteFolder = async () => {
    if (!performer?.id) return;
    
    try {
      const response = await fetch(`/api/performers/${performer.id}/folder`, {
        method: 'DELETE'
      });

      if (response.ok) {
        if (onUpdate) onUpdate();
        onClose();
      }
    } catch (error) {
      console.error('Error deleting folder:', error);
    }
  };

  const handleMoveToAfter = async (merge = false) => {
    if (!performer?.id) return;
    
    try {
      const response = await fetch(`/api/performers/${performer.id}/move-to-after`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merge })
      });

      if (response.ok) {
        const result = await response.json();
        if (result.conflict && !merge) {
          setConfirmDialog({
            open: true,
            type: 'merge',
            title: 'Folder Conflict',
            message: `A folder with the name "${performer.name}" already exists in the "after filter performer" directory. Would you like to merge the contents?`
          });
        } else {
          if (onUpdate) onUpdate();
          onClose();
        }
      }
    } catch (error) {
      console.error('Error moving to after:', error);
    }
  };

  const showConfirmDialog = (type, title, message, action) => {
    setConfirmDialog({
      open: true,
      type,
      title,
      message,
      action
    });
  };

  const handleConfirmAction = () => {
    if (confirmDialog.type === 'merge') {
      handleMoveToAfter(true);
    } else if (confirmDialog.action) {
      confirmDialog.action();
    }
    setConfirmDialog({ open: false, type: '', title: '', message: '' });
  };

  const handleCancelAction = () => {
    setConfirmDialog({ open: false, type: '', title: '', message: '' });
  };

  if (!performer || !settings) return null;

  return (
    <>
      <Modal open={open} onClose={onClose}>
        <Box sx={phoneModalStyle}>
          {/* Header */}
          <Box sx={phoneHeaderStyle}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                Settings
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.9 }}>
                {performer.name}
              </Typography>
            </Box>
            <IconButton 
              onClick={onClose} 
              sx={{ 
                color: 'inherit',
                '& svg': { fontSize: '24px' }
              }}
            >
              <CloseIcon />
            </IconButton>
          </Box>

          <Box sx={phoneContentStyle}>
            {/* Handy Connection Code */}
            <Box sx={{ mb: 3 }}>
              <Typography variant="h6" gutterBottom sx={{ fontWeight: 'bold', fontSize: '1.1rem' }}>
                Handy Connection Code
              </Typography>
              <input
                type="text"
                value={handyCode}
                onChange={e => {
                  setHandyCode(e.target.value);
                  localStorage.setItem('handyConnectionCode', e.target.value);
                }}
                placeholder="Enter Handy connection code"
                style={{
                  width: '100%',
                  padding: '12px',
                  fontSize: '1rem',
                  borderRadius: '8px',
                  border: '1px solid #ccc',
                  marginBottom: '12px'
                }}
              />
            </Box>

            {/* Content Status */}
            <Box sx={{ mb: 3 }}>
              <Typography variant="h6" gutterBottom sx={{ fontWeight: 'bold', fontSize: '1.1rem' }}>
                Content Status
              </Typography>
              <Box sx={{ 
                display: 'flex',
                flexDirection: 'column',
                gap: 1
              }}>
                <Chip 
                  icon={settings.filteringComplete?.pics ? <CheckIcon /> : <WarningIcon />}
                  label={`Pics: ${settings.performer?.pics_filtered || 0}/${settings.performer?.pics_count || 0}`}
                  color={settings.filteringComplete?.pics ? 'success' : 'warning'}
                  size="medium"
                  sx={{ 
                    fontWeight: 'bold',
                    '& .MuiChip-label': { color: 'white' },
                    height: '40px',
                    fontSize: '1rem'
                  }}
                />
                <Chip 
                  icon={settings.filteringComplete?.vids ? <CheckIcon /> : <WarningIcon />}
                  label={`Vids: ${settings.performer?.vids_filtered || 0}/${settings.performer?.vids_count || 0}`}
                  color={settings.filteringComplete?.vids ? 'success' : 'warning'}
                  size="medium"
                  sx={{ 
                    fontWeight: 'bold',
                    '& .MuiChip-label': { color: 'white' },
                    height: '40px',
                    fontSize: '1rem'
                  }}
                />
                <Chip 
                  icon={settings.filteringComplete?.funscript_vids ? <CheckIcon /> : <WarningIcon />}
                  label={`Funscript: ${settings.performer?.funscript_vids_filtered || 0}/${settings.performer?.funscript_vids_count || 0}`}
                  color={settings.filteringComplete?.funscript_vids ? 'success' : 'warning'}
                  size="medium"
                  sx={{ 
                    fontWeight: 'bold',
                    '& .MuiChip-label': { color: 'white' },
                    height: '40px',
                    fontSize: '1rem'
                  }}
                />
              </Box>
            </Box>

            {/* Mark Complete Section */}
            <Box sx={{ mb: 3 }}>
              <Typography variant="h6" gutterBottom sx={{ fontWeight: 'bold', fontSize: '1.1rem' }}>
                Mark Complete
              </Typography>
              <Box sx={{ 
                bgcolor: '#f8f9fa',
                borderRadius: 2,
                p: 2,
                border: '1px solid #e0e0e0'
              }}>
                <FormGroup sx={{ gap: 1 }}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={completionState.pics}
                        onChange={(e) => setCompletionState(prev => ({ ...prev, pics: e.target.checked }))}
                        sx={{ 
                          color: '#1976d2',
                          '&.Mui-checked': { color: '#1976d2' }
                        }}
                      />
                    }
                    label={
                      <Typography variant="body1" sx={{ fontSize: '1rem' }}>
                        Pictures ({settings.performer?.pics_filtered || 0}/{settings.performer?.pics_count || 0})
                      </Typography>
                    }
                  />
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={completionState.vids}
                        onChange={(e) => setCompletionState(prev => ({ ...prev, vids: e.target.checked }))}
                        sx={{ 
                          color: '#1976d2',
                          '&.Mui-checked': { color: '#1976d2' }
                        }}
                      />
                    }
                    label={
                      <Typography variant="body1" sx={{ fontSize: '1rem' }}>
                        Videos ({settings.performer?.vids_filtered || 0}/{settings.performer?.vids_count || 0})
                      </Typography>
                    }
                  />
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={completionState.funscript_vids}
                        onChange={(e) => setCompletionState(prev => ({ ...prev, funscript_vids: e.target.checked }))}
                        sx={{ 
                          color: '#1976d2',
                          '&.Mui-checked': { color: '#1976d2' }
                        }}
                      />
                    }
                    label={
                      <Typography variant="body1" sx={{ fontSize: '1rem' }}>
                        Funscript Videos ({settings.performer?.funscript_vids_filtered || 0}/{settings.performer?.funscript_vids_count || 0})
                      </Typography>
                    }
                  />
                </FormGroup>
                
                <Box sx={{ mt: 2 }}>
                  <Button 
                    variant="contained" 
                    color="primary" 
                    onClick={handleMarkComplete}
                    disabled={!Object.values(completionState).some(Boolean)}
                    fullWidth
                    sx={{
                      height: '48px',
                      fontSize: '1.1rem',
                      fontWeight: 'bold'
                    }}
                  >
                    Mark Selected Complete
                  </Button>
                </Box>
              </Box>
            </Box>

            <Divider sx={{ my: 3 }} />

            {/* Action Buttons */}
            <Box sx={{ mb: 2 }}>
              <Typography variant="h6" gutterBottom sx={{ fontWeight: 'bold', fontSize: '1.1rem' }}>
                Actions
              </Typography>
              <Box sx={{ 
                display: 'flex',
                flexDirection: 'column',
                gap: 2
              }}>
                <Button
                  variant="contained"
                  color="success"
                  startIcon={<MoveIcon />}
                  onClick={() => handleMoveToAfter(false)}
                  fullWidth
                  sx={{
                    height: '48px',
                    fontSize: '1rem',
                    fontWeight: 'bold'
                  }}
                >
                  Move to After
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<DeleteIcon />}
                  onClick={() => showConfirmDialog(
                    'delete-data',
                    'Delete Data',
                    'Are you sure you want to delete all data for this performer? This action cannot be undone.',
                    handleDeleteData
                  )}
                  fullWidth
                  sx={{
                    height: '48px',
                    fontSize: '1rem',
                    fontWeight: 'bold'
                  }}
                >
                  Delete Data
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<DeleteIcon />}
                  onClick={() => showConfirmDialog(
                    'delete-folder',
                    'Delete Folder',
                    'Are you sure you want to delete the entire folder for this performer? This action cannot be undone.',
                    handleDeleteFolder
                  )}
                  fullWidth
                  sx={{
                    height: '48px',
                    fontSize: '1rem',
                    fontWeight: 'bold'
                  }}
                >
                  Delete Folder
                </Button>
              </Box>
            </Box>
          </Box>
        </Box>
      </Modal>

      {/* Confirmation Dialog */}
      <Dialog 
        open={confirmDialog.open} 
        onClose={handleCancelAction}
        PaperProps={{
          sx: {
            borderRadius: '12px',
            m: 2,
            maxWidth: '400px',
            width: '90%'
          }
        }}
      >
        <DialogTitle sx={{ fontSize: '1.2rem', fontWeight: 'bold' }}>
          {confirmDialog.title}
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: '1rem' }}>
            {confirmDialog.message}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 2, gap: 1 }}>
          <Button 
            onClick={handleCancelAction} 
            color="primary"
            variant="outlined"
            sx={{ 
              height: '44px',
              fontSize: '1rem',
              fontWeight: 'bold'
            }}
          >
            Cancel
          </Button>
          <Button 
            onClick={handleConfirmAction} 
            color="error" 
            variant="contained"
            sx={{ 
              height: '44px',
              fontSize: '1rem',
              fontWeight: 'bold'
            }}
          >
            Confirm
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export default PhonePerformerSettingsModal;
