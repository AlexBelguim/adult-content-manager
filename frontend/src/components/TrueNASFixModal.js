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
  Chip,
  Box,
  CircularProgress,
  Alert
} from '@mui/material';
import { Build, CheckCircle, Warning } from '@mui/icons-material';

const TrueNASFixModal = ({ open, onClose }) => {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [fixResults, setFixResults] = useState(null);

  const checkStatus = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/truenas/truenas-status');
      const data = await response.json();
      setStatus(data);
    } catch (error) {
      console.error('Error checking TrueNAS status:', error);
      setStatus({ error: 'Failed to check status' });
    }
    setLoading(false);
  };

  const runFixes = async () => {
    setFixing(true);
    try {
      const response = await fetch('/api/truenas/run-truenas-fixes', {
        method: 'POST'
      });
      const data = await response.json();
      setFixResults(data);
      // Refresh status after fixes
      await checkStatus();
    } catch (error) {
      console.error('Error running TrueNAS fixes:', error);
      setFixResults({ error: 'Failed to run fixes' });
    }
    setFixing(false);
  };

  React.useEffect(() => {
    if (open) {
      checkStatus();
    }
  }, [open]);

  const handleClose = () => {
    setStatus(null);
    setFixResults(null);
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Build />
        TrueNAS Compatibility
      </DialogTitle>
      
      <DialogContent>
        {loading ? (
          <Box display="flex" justifyContent="center" p={2}>
            <CircularProgress />
            <Typography variant="body2" sx={{ ml: 2 }}>
              Checking compatibility status...
            </Typography>
          </Box>
        ) : status ? (
          <Box>
            {status.error ? (
              <Alert severity="error">{status.error}</Alert>
            ) : (
              <>
                <Box display="flex" alignItems="center" gap={1} mb={2}>
                  {status.compatible ? (
                    <CheckCircle color="success" />
                  ) : (
                    <Warning color="warning" />
                  )}
                  <Typography variant="h6">
                    {status.compatible ? 'System Compatible' : 'Issues Detected'}
                  </Typography>
                </Box>

                {!status.compatible && (
                  <Box mb={3}>
                    <Typography variant="subtitle1" gutterBottom>
                      Issues Summary:
                    </Typography>
                    <Box display="flex" gap={1} mb={2}>
                      {status.issues.duplicateFunscriptFolders > 0 && (
                        <Chip 
                          label={`${status.issues.duplicateFunscriptFolders} Duplicate Funscript Folders`}
                          color="warning"
                          size="small"
                        />
                      )}
                      {status.issues.missingFolders > 0 && (
                        <Chip 
                          label={`${status.issues.missingFolders} Missing Folders`}
                          color="error"
                          size="small"
                        />
                      )}
                      {status.issues.pathCaseIssues > 0 && (
                        <Chip 
                          label={`${status.issues.pathCaseIssues} Path Casing Issues`}
                          color="warning"
                          size="small"
                        />
                      )}
                    </Box>

                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      {status.recommendedAction}
                    </Typography>

                    {status.detailedIssues && status.detailedIssues.length > 0 && (
                      <Box>
                        <Typography variant="subtitle2" gutterBottom>
                          Detailed Issues (showing first 10):
                        </Typography>
                        <List dense>
                          {status.detailedIssues.slice(0, 10).map((issue, index) => (
                            <ListItem key={index}>
                              <ListItemText 
                                primary={issue}
                                primaryTypographyProps={{ variant: 'body2' }}
                              />
                            </ListItem>
                          ))}
                        </List>
                        {status.detailedIssues.length > 10 && (
                          <Typography variant="caption" color="text.secondary">
                            ... and {status.detailedIssues.length - 10} more issues
                          </Typography>
                        )}
                      </Box>
                    )}
                  </Box>
                )}

                {fixResults && (
                  <Box mt={2}>
                    {fixResults.error ? (
                      <Alert severity="error">{fixResults.error}</Alert>
                    ) : (
                      <Alert severity="success">
                        Fixes completed! Fixed {fixResults.fixedPerformers} performers.
                        {fixResults.errors?.length > 0 && (
                          <Typography variant="body2" sx={{ mt: 1 }}>
                            {fixResults.errors.length} errors encountered during fixes.
                          </Typography>
                        )}
                      </Alert>
                    )}
                  </Box>
                )}
              </>
            )}
          </Box>
        ) : null}
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose}>Close</Button>
        {status && !status.compatible && !status.error && (
          <Button
            onClick={runFixes}
            variant="contained"
            disabled={fixing}
            startIcon={fixing ? <CircularProgress size={20} /> : <Build />}
          >
            {fixing ? 'Running Fixes...' : 'Run Fixes'}
          </Button>
        )}
        <Button onClick={checkStatus} disabled={loading}>
          Refresh Status
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default TrueNASFixModal;
