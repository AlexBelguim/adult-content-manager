import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  LinearProgress,
  Typography,
  Box,
  Alert,
  Stepper,
  Step,
  StepLabel,
} from '@mui/material';
import StorageIcon from '@mui/icons-material/Storage';

const CreateHashDBModal = ({ open, onClose, basePath, performerId, onComplete, mode = 'append' }) => {
  const [performers, setPerformers] = useState([]);
  const [selectedPerformer, setSelectedPerformer] = useState(performerId || '');
  const [loading, setLoading] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [progress, setProgress] = useState({ processed: 0, total: 0 });
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [activeStep, setActiveStep] = useState(0);

  const steps = performerId ? ['Creating Hashes', 'Complete'] : ['Select Performer', 'Creating Hashes', 'Complete'];

  useEffect(() => {
    if (open) {
      // Reset state when opening
      setError(null);
      setSuccess(false);
      setJobId(null);
      setProgress({ processed: 0, total: 0 });
      
      // If performerId is provided, skip selection and go straight to creating
      if (performerId) {
        setSelectedPerformer(performerId);
        setActiveStep(performerId ? 0 : 0); // Adjust for different step arrays
      } else {
        setActiveStep(0);
        loadPerformers();
      }
    }
  }, [open, performerId]);

  // Auto-start hash creation if performerId is provided
  useEffect(() => {
    if (open && performerId && selectedPerformer === performerId && !jobId && !success && !loading) {
      // Start creation automatically
      setTimeout(() => {
        handleCreateWithId(performerId);
      }, 300);
    }
  }, [open, performerId, selectedPerformer]);

  useEffect(() => {
    if (jobId) {
      const interval = setInterval(() => {
        checkJobStatus(jobId);
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [jobId]);

  const loadPerformers = async () => {
    try {
      // Load both filter and gallery performers
      const [filterResponse, galleryResponse] = await Promise.all([
        fetch('/api/performers/filter'),
        fetch('/api/performers/gallery')
      ]);
      
      const filterData = await filterResponse.json();
      const galleryData = await galleryResponse.json();
      
      // Combine and deduplicate by ID
      const allPerformers = [...filterData, ...galleryData];
      const uniquePerformers = Array.from(
        new Map(allPerformers.map(p => [p.id, p])).values()
      );
      
      setPerformers(uniquePerformers);
    } catch (err) {
      console.error('Error loading performers:', err);
      setError('Failed to load performers: ' + err.message);
    }
  };

  const checkJobStatus = async (jid) => {
    try {
      const response = await fetch(`/api/hashes/status/${jid}`);
      const data = await response.json();

      if (data.success && data.status) {
        setProgress({
          processed: data.status.processed || 0,
          total: data.status.total || 0,
        });

        if (data.status.status === 'completed') {
          setSuccess(true);
          setActiveStep(performerId ? 1 : 2); // Adjust for different step arrays
          setJobId(null);
          
          // Notify parent component if callback provided
          if (onComplete) {
            onComplete();
          }
        } else if (data.status.status === 'failed') {
          setError(data.status.error || 'Hash creation failed');
          setJobId(null);
        }
      }
    } catch (err) {
      console.error('Error checking job status:', err);
    }
  };

  const handleCreateWithId = async (perfId) => {
    if (!perfId) {
      setError('Performer ID is required');
      return;
    }

    setLoading(true);
    setError(null);
    setActiveStep(performerId ? 0 : 1); // Adjust for different step arrays

    try {
      // Get base path
      let actualBasePath = basePath;
      
      if (!actualBasePath) {
        try {
          const settingsResponse = await fetch('/api/settings/base-path');
          if (settingsResponse.ok) {
            const data = await settingsResponse.json();
            actualBasePath = data.basePath;
          }
        } catch (err) {
          console.warn('Could not fetch base path from settings:', err);
        }
        
        if (!actualBasePath) {
          actualBasePath = '';
        }
      }

      const response = await fetch('/api/hashes/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          performer_id: perfId,
          basePath: actualBasePath,
          mode,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setJobId(data.jobId);
      } else {
        throw new Error(data.error || 'Failed to start hash creation');
      }
    } catch (err) {
      console.error('Error creating hash DB:', err);
      setError(err.message);
      setActiveStep(0);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!selectedPerformer) {
      setError('Please select a performer');
      return;
    }

    setLoading(true);
    setError(null);
    setActiveStep(1);

    try {
      // Get performer data from loaded performers
      const performerObj = performers.find(p => p.id === selectedPerformer);
      
      // If basePath is provided use it, otherwise try to get from API
      let actualBasePath = basePath;
      
      if (!actualBasePath) {
        // Try to fetch the base path from settings or use performer's folder
        try {
          const settingsResponse = await fetch('/api/settings/base-path');
          if (settingsResponse.ok) {
            const data = await settingsResponse.json();
            actualBasePath = data.basePath;
          }
        } catch (err) {
          console.warn('Could not fetch base path from settings:', err);
        }
        
        // Fallback to empty string if still not found
        if (!actualBasePath) {
          actualBasePath = '';
        }
      }

      const response = await fetch('/api/hashes/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          performer_id: selectedPerformer,
          basePath: actualBasePath,
          mode,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setJobId(data.jobId);
      } else {
        throw new Error(data.error || 'Failed to start hash creation');
      }
    } catch (err) {
      console.error('Error creating hash DB:', err);
      setError(err.message);
      setActiveStep(0);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setSelectedPerformer(performerId || '');
    setJobId(null);
    setProgress({ processed: 0, total: 0 });
    setError(null);
    setSuccess(false);
    setActiveStep(0);
    onClose();
  };

  const progressPercent = progress.total > 0
    ? Math.round((progress.processed / progress.total) * 100)
    : 0;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1}>
          <StorageIcon />
          Create Hash Database
        </Box>
      </DialogTitle>

      <DialogContent>
        <Stepper activeStep={activeStep} sx={{ mb: 3 }}>
          {steps.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {success && (
          <Alert severity="success" sx={{ mb: 2 }}>
            Hash database created successfully! Processed {progress.processed} files.
          </Alert>
        )}

        {!performerId && activeStep === 0 && (
          <FormControl fullWidth sx={{ mt: 2 }}>
            <InputLabel>Performer</InputLabel>
            <Select
              value={selectedPerformer}
              onChange={(e) => setSelectedPerformer(e.target.value)}
              label="Performer"
            >
              {performers.map((p) => {
                // Build a descriptive label including folder path and moved_to_after flag
                const location = p.moved_to_after ? 'after' : 'before';
                const folder = p.folder_path || p.path || '';
                const label = folder ? `${p.name} — ${folder} (${location})` : `${p.name} (${location})`;
                return (
                  <MenuItem key={p.id} value={p.id}>
                    {label}
                  </MenuItem>
                );
              })}
            </Select>
          </FormControl>
        )}

        {((performerId && activeStep === 0) || (!performerId && activeStep === 1)) && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Processing files... {progress.processed} / {progress.total}
            </Typography>
            <LinearProgress
              variant="determinate"
              value={progressPercent}
              sx={{ mt: 1, mb: 1 }}
            />
            <Typography variant="caption" color="text.secondary">
              {progressPercent}% complete
            </Typography>
          </Box>
        )}

        {((performerId && activeStep === 1) || (!performerId && activeStep === 2)) && success && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="body1" gutterBottom>
              Hash database successfully created!
            </Typography>
            <Typography variant="body2" color="text.secondary">
              You can now check for duplicates against other performers.
            </Typography>
          </Box>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose}>
          {success ? 'Close' : 'Cancel'}
        </Button>
        {!performerId && activeStep === 0 && (
          <Button
            variant="contained"
            onClick={handleCreate}
            disabled={!selectedPerformer || loading}
          >
            Create Hash DB
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default CreateHashDBModal;
