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
  Typography,
  Box,
  Alert,
  CircularProgress,
  Stepper,
  Step,
  StepLabel,
  Paper,
} from '@mui/material';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';

const CheckHashModal = ({ open, onClose, basePath, performerId, onRunCreated }) => {
  const [performers, setPerformers] = useState([]);
  const [sourcePerformer, setSourcePerformer] = useState(performerId || '');
  const [targetPerformer, setTargetPerformer] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [activeStep, setActiveStep] = useState(0);

  const steps = ['Select Performers', 'Comparing', 'Results'];

  useEffect(() => {
    if (open) {
      loadPerformers();
      setActiveStep(0);
      setResult(null);
      setError(null);
    }
  }, [open]);

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

  const handleCheck = async () => {
    if (!sourcePerformer || !targetPerformer) {
      setError('Please select both source and target performers');
      return;
    }

    if (sourcePerformer === targetPerformer) {
      setError('Source and target performers must be different');
      return;
    }

    // If the two entries have the same canonical name (case-insensitive) but different ids,
    // warn the user and ask for confirmation because this is likely the same performer in two folders
    const src = performers.find(p => p.id === sourcePerformer);
    const tgt = performers.find(p => p.id === targetPerformer);
    if (src && tgt) {
      const srcName = (src.name || '').toLowerCase().trim();
      const tgtName = (tgt.name || '').toLowerCase().trim();
      if (srcName === tgtName && src.id !== tgt.id) {
        const proceed = window.confirm(
          `The selected source and target look like the same performer name (${src.name}) but different folders/records.\nDo you really want to compare these two instances? Press OK to continue.`
        );
        if (!proceed) return;
      }
    }

    setLoading(true);
    setError(null);
    setActiveStep(1);

    try {
      const response = await fetch('/api/hashes/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_performer_id: sourcePerformer,
          target_performer_id: targetPerformer,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setResult(data);
        setActiveStep(2);
        
        // Notify parent component that a run was created
        if (onRunCreated) {
          onRunCreated(data.runId);
        }
      } else {
        throw new Error(data.error || 'Failed to check for duplicates');
      }
    } catch (err) {
      console.error('Error checking duplicates:', err);
      setError(err.message);
      setActiveStep(0);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setSourcePerformer(performerId || '');
    setTargetPerformer('');
    setResult(null);
    setError(null);
    setActiveStep(0);
    onClose();
  };

  const handleViewResults = () => {
    if (result && result.runId) {
      // Notify parent to switch to results view
      onClose();
      // You can add navigation logic here to show the results modal
    }
  };

  const sourcePerformerName = performers.find(p => p.id === sourcePerformer)?.name || '';
  const targetPerformerName = performers.find(p => p.id === targetPerformer)?.name || '';

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1}>
          <CompareArrowsIcon />
          Check for Duplicates
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

        {activeStep === 0 && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Compare files from one performer against another performer's hash database
              to find duplicates.
            </Typography>

            <FormControl fullWidth sx={{ mt: 3 }}>
              <InputLabel>Source Performer</InputLabel>
              <Select
                value={sourcePerformer}
                onChange={(e) => setSourcePerformer(e.target.value)}
                label="Source Performer"
              >
                {performers.map((p) => {
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

            <FormControl fullWidth sx={{ mt: 2 }}>
              <InputLabel>Target Performer (to check against)</InputLabel>
              <Select
                value={targetPerformer}
                onChange={(e) => setTargetPerformer(e.target.value)}
                label="Target Performer (to check against)"
              >
                {performers
                  .filter(p => p.id !== sourcePerformer)
                  .map((p) => {
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
          </Box>
        )}

        {activeStep === 1 && (
          <Box sx={{ mt: 2, textAlign: 'center' }}>
            <CircularProgress sx={{ mb: 2 }} />
            <Typography variant="body2" color="text.secondary">
              Comparing {sourcePerformerName} files against {targetPerformerName}...
            </Typography>
          </Box>
        )}

        {activeStep === 2 && result && (
          <Box sx={{ mt: 2 }}>
            <Alert severity="success" sx={{ mb: 2 }}>
              Comparison complete!
            </Alert>

            <Paper sx={{ p: 2 }}>
              <Typography variant="h6" gutterBottom>
                Results Summary
              </Typography>

              <Box sx={{ mt: 2 }}>
                <Typography variant="body2">
                  <strong>Source:</strong> {sourcePerformerName}
                </Typography>
                <Typography variant="body2">
                  <strong>Target:</strong> {targetPerformerName}
                </Typography>
              </Box>

              <Box sx={{ mt: 2 }}>
                <Typography variant="body1" color="primary">
                  <strong>Total Matches:</strong> {result.matchCount}
                </Typography>
                <Typography variant="body2">
                  Exact matches: {result.exactMatches}
                </Typography>
                <Typography variant="body2">
                  Perceptual matches: {result.perceptualMatches}
                </Typography>
              </Box>

              {result.matchCount === 0 && (
                <Alert severity="info" sx={{ mt: 2 }}>
                  No duplicates found. All files are unique!
                </Alert>
              )}

              {result.matchCount > 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                  You can now review the matches and decide which files to keep or remove.
                </Typography>
              )}
            </Paper>
          </Box>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose}>
          {activeStep === 2 ? 'Close' : 'Cancel'}
        </Button>
        {activeStep === 0 && (
          <Button
            variant="contained"
            onClick={handleCheck}
            disabled={!sourcePerformer || !targetPerformer || loading}
          >
            Check for Duplicates
          </Button>
        )}
        {activeStep === 2 && result && result.matchCount > 0 && (
          <Button variant="contained" onClick={handleViewResults}>
            View Results
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default CheckHashModal;
