import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Checkbox,
  Alert,
  Box,
  Chip
} from '@mui/material';
import { Warning as WarningIcon, Delete as DeleteIcon } from '@mui/icons-material';

const OrphanedPerformersModal = ({ open, onClose, orphanedPerformers, onDelete }) => {
  const [selectedPerformers, setSelectedPerformers] = useState([]);
  const [deleting, setDeleting] = useState(false);

  const handleTogglePerformer = (performerId) => {
    setSelectedPerformers(prev => 
      prev.includes(performerId) 
        ? prev.filter(id => id !== performerId)
        : [...prev, performerId]
    );
  };

  const handleSelectAll = () => {
    if (selectedPerformers.length === orphanedPerformers.length) {
      setSelectedPerformers([]);
    } else {
      setSelectedPerformers(orphanedPerformers.map(p => p.id));
    }
  };

  const handleDelete = async () => {
    if (selectedPerformers.length === 0) return;
    
    setDeleting(true);
    try {
      const response = await fetch('/api/folders/delete-orphaned', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ performerIds: selectedPerformers })
      });

      if (response.ok) {
        const result = await response.json();
        onDelete(selectedPerformers, result.message);
        onClose();
        setSelectedPerformers([]);
      } else {
        const error = await response.json();
        console.error('Failed to delete orphaned performers:', error);
      }
    } catch (error) {
      console.error('Error deleting orphaned performers:', error);
    } finally {
      setDeleting(false);
    }
  };

  const handleClose = () => {
    setSelectedPerformers([]);
    onClose();
  };

  if (!orphanedPerformers || orphanedPerformers.length === 0) {
    return null;
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <WarningIcon color="warning" />
        Orphaned Performers Detected
      </DialogTitle>
      
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 3 }}>
          Found {orphanedPerformers.length} performer(s) in the database whose folders no longer exist. 
          This usually happens when folders are manually deleted or moved outside the app.
        </Alert>

        <Box sx={{ mb: 2 }}>
          <Button
            variant="outlined"
            size="small"
            onClick={handleSelectAll}
            sx={{ mr: 1 }}
          >
            {selectedPerformers.length === orphanedPerformers.length ? 'Deselect All' : 'Select All'}
          </Button>
          <Typography variant="caption" color="text.secondary">
            {selectedPerformers.length} of {orphanedPerformers.length} selected
          </Typography>
        </Box>

        <List sx={{ maxHeight: 400, overflow: 'auto' }}>
          {orphanedPerformers.map((performer) => (
            <ListItem 
              key={performer.id}
              sx={{ 
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                mb: 1 
              }}
            >
              <ListItemIcon>
                <Checkbox
                  checked={selectedPerformers.includes(performer.id)}
                  onChange={() => handleTogglePerformer(performer.id)}
                />
              </ListItemIcon>
              <ListItemText
                primary={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {performer.name}
                    <Chip 
                      label={performer.location}
                      size="small" 
                      color={performer.moved_to_after ? 'success' : 'primary'}
                      variant="outlined"
                    />
                  </Box>
                }
                secondary={
                  <Typography variant="caption" color="text.secondary">
                    Expected location: {performer.expectedPath}
                  </Typography>
                }
              />
            </ListItem>
          ))}
        </List>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} disabled={deleting}>
          Cancel
        </Button>
        <Button
          onClick={handleDelete}
          disabled={selectedPerformers.length === 0 || deleting}
          color="error"
          variant="contained"
          startIcon={<DeleteIcon />}
        >
          {deleting ? 'Deleting...' : `Delete Selected (${selectedPerformers.length})`}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default OrphanedPerformersModal;