import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Paper,
  Typography,
  IconButton,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  Chip,
  Collapse,
  Tooltip,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import MinimizeIcon from '@mui/icons-material/Minimize';
import MaximizeIcon from '@mui/icons-material/Maximize';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';

const HashCreationQueue = ({ queue, onClose, onCancel, title = "Hash Creation Queue" }) => {
  const [minimized, setMinimized] = useState(false);
  const abortControllerRef = useRef(null);

  // Cleanup on unmount - cancel current job
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      // Cancel current active jobs if exist
      const activeJobs = queue.filter(j => j.status === 'processing');
      activeJobs.forEach(job => {
        if (onCancel) {
          onCancel(job.id);
        }
      });
    };
  }, []);

  const handleClose = () => {
    // Cancel all active jobs
    const activeJobs = queue.filter(j => j.status === 'processing');
    activeJobs.forEach(job => {
      if (onCancel) {
        onCancel(job.id);
      }
    });
    onClose();
  };

  const handleCancelJob = (jobId) => {
    if (onCancel) {
      onCancel(jobId);
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'processing':
        return <HourglassEmptyIcon sx={{ fontSize: 20, color: '#1976d2' }} />;
      case 'completed':
        return <CheckCircleIcon sx={{ fontSize: 20, color: '#4caf50' }} />;
      case 'error':
        return <ErrorIcon sx={{ fontSize: 20, color: '#f44336' }} />;
      case 'queued':
      default:
        return <HourglassEmptyIcon sx={{ fontSize: 20, color: '#9e9e9e' }} />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'processing':
        return 'primary';
      case 'completed':
        return 'success';
      case 'error':
        return 'error';
      case 'queued':
      default:
        return 'default';
    }
  };

  const activeJobs = queue.filter(j => j.status === 'processing');
  const queuedJobs = queue.filter(j => j.status === 'queued');
  const completedJobs = queue.filter(j => j.status === 'completed' || j.status === 'error');

  return (
    <Paper
      elevation={8}
      sx={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        width: minimized ? 320 : 400,
        maxHeight: minimized ? 60 : '80vh',
        zIndex: 2000,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: 'all 0.3s ease',
      }}
    >
      {/* Header */}
      <Box
        sx={{
          p: 1.5,
          bgcolor: '#1976d2',
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
        }}
        onClick={() => setMinimized(!minimized)}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="subtitle2" fontWeight="bold">
            {title}
          </Typography>
          <Chip
            label={`${queue.filter(j => j.status !== 'completed' && j.status !== 'error').length} active`}
            size="small"
            sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: 'white', height: 20, fontSize: '0.7rem' }}
          />
        </Box>
        <Box>
          <Tooltip title={minimized ? 'Expand' : 'Minimize'}>
            <IconButton size="small" sx={{ color: 'white' }} onClick={(e) => { e.stopPropagation(); setMinimized(!minimized); }}>
              {minimized ? <MaximizeIcon fontSize="small" /> : <MinimizeIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
          <Tooltip title="Close (cancels all jobs)">
            <IconButton size="small" sx={{ color: 'white' }} onClick={(e) => { e.stopPropagation(); handleClose(); }}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <Collapse in={!minimized}>
        <Box sx={{ maxHeight: 'calc(80vh - 60px)', overflow: 'auto' }}>
          {/* Active Jobs */}
          {activeJobs.length > 0 && activeJobs.map((activeJob) => (
            <Box key={activeJob.id} sx={{ p: 2, borderBottom: '1px solid #e0e0e0', bgcolor: '#f5f5f5' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {getStatusIcon(activeJob.status)}
                  <Box>
                    <Typography variant="body2" fontWeight="bold">
                      {activeJob.performerName}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                      {activeJob.id?.startsWith('clip-') ? '🤖 CLIP Embeddings' : '🔑 Hash Database'} • {activeJob.location === 'before' ? '📥 Before Filter' : activeJob.location === 'after' ? '✅ After Filter' : 'Unknown'}
                    </Typography>
                  </Box>
                </Box>
                <IconButton size="small" onClick={() => handleCancelJob(activeJob.id)} color="error">
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Box>
              <LinearProgress
                variant={activeJob.progress !== undefined ? 'determinate' : 'indeterminate'}
                value={activeJob.progress || 0}
                sx={{ mb: 1, height: 6, borderRadius: 3 }}
              />
              <Typography variant="caption" color="text.secondary">
                {activeJob.processed || 0} / {activeJob.total || '?'} files
                {activeJob.mode && ` • Mode: ${activeJob.mode}`}
              </Typography>
            </Box>
          ))}

          {/* Queued Jobs */}
          {queuedJobs.length > 0 && (
            <Box sx={{ p: 2, borderBottom: '1px solid #e0e0e0' }}>
              <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 1, color: 'text.secondary' }}>
                Queue ({queuedJobs.length})
              </Typography>
              <List dense disablePadding>
                {queuedJobs.map((job, index) => (
                  <ListItem
                    key={job.id}
                    sx={{
                      px: 1,
                      py: 0.5,
                      bgcolor: index % 2 === 0 ? '#fafafa' : 'white',
                      borderRadius: 1,
                      mb: 0.5,
                    }}
                    secondaryAction={
                      <IconButton edge="end" size="small" onClick={() => handleCancelJob(job.id)}>
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    }
                  >
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                          <Typography variant="body2" sx={{ fontSize: '0.85rem', fontWeight: 500 }}>
                            {job.performerName}
                          </Typography>
                          <Chip
                            label={job.id?.startsWith('clip-') ? 'CLIP' : 'Hash'}
                            size="small"
                            color={job.id?.startsWith('clip-') ? 'secondary' : 'primary'}
                            sx={{ height: 18, fontSize: '0.7rem' }}
                          />
                          <Chip
                            label={job.location === 'before' ? 'Before' : job.location === 'after' ? 'After' : 'Unknown'}
                            size="small"
                            color={job.location === 'before' ? 'warning' : 'success'}
                            sx={{ height: 18, fontSize: '0.7rem' }}
                          />
                          <Chip
                            label={job.mode || 'append'}
                            size="small"
                            color={job.mode === 'rebuild' ? 'error' : 'default'}
                            sx={{ height: 18, fontSize: '0.7rem' }}
                          />
                        </Box>
                      }
                    />
                  </ListItem>
                ))}
              </List>
            </Box>
          )}

          {/* Completed/Error Jobs */}
          {completedJobs.length > 0 && (
            <Box sx={{ p: 2 }}>
              <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 1, color: 'text.secondary' }}>
                Completed ({completedJobs.length})
              </Typography>
              <List dense disablePadding>
                {completedJobs.map((job) => (
                  <ListItem
                    key={job.id}
                    sx={{
                      px: 1,
                      py: 0.5,
                      bgcolor: job.status === 'completed' ? '#e8f5e9' : '#ffebee',
                      borderRadius: 1,
                      mb: 0.5,
                    }}
                  >
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                          {getStatusIcon(job.status)}
                          <Typography variant="body2" sx={{ fontSize: '0.85rem', fontWeight: 500 }}>
                            {job.performerName}
                          </Typography>
                          <Chip
                            label={job.location === 'before' ? 'Before' : job.location === 'after' ? 'After' : 'Unknown'}
                            size="small"
                            color={job.location === 'before' ? 'warning' : 'success'}
                            sx={{ height: 18, fontSize: '0.7rem' }}
                          />
                          <Chip
                            label={job.status}
                            size="small"
                            color={getStatusColor(job.status)}
                            sx={{ height: 18, fontSize: '0.7rem' }}
                          />
                        </Box>
                      }
                      secondary={job.error || `Processed ${job.processed || 0} files`}
                      secondaryTypographyProps={{ sx: { fontSize: '0.7rem' } }}
                    />
                  </ListItem>
                ))}
              </List>
            </Box>
          )}

          {queue.length === 0 && (
            <Box sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>
              <Typography variant="body2">No jobs in queue</Typography>
            </Box>
          )}
        </Box>
      </Collapse>
    </Paper>
  );
};

export default HashCreationQueue;
