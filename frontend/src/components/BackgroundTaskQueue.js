import React from 'react';
import {
  Box,
  Paper,
  Typography,
  LinearProgress,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Chip,
  Collapse,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DeleteIcon from '@mui/icons-material/Delete';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';

const BackgroundTaskQueue = ({ tasks, onClose, onCancelTask }) => {
  const [expanded, setExpanded] = React.useState(true);

  if (!tasks || tasks.length === 0) {
    return null;
  }

  const activeTasks = tasks.filter(t => t.status === 'processing' || t.status === 'queued');
  const completedTasks = tasks.filter(t => t.status === 'completed');
  const errorTasks = tasks.filter(t => t.status === 'error');

  return (
    <Paper
      elevation={8}
      sx={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        width: 400,
        maxHeight: '60vh',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 2000,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <Box
        sx={{
          p: 2,
          bgcolor: 'primary.main',
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="h6" sx={{ fontSize: '1rem' }}>
            Background Tasks
          </Typography>
          <Chip
            label={activeTasks.length}
            size="small"
            sx={{
              bgcolor: 'rgba(255,255,255,0.2)',
              color: 'white',
              height: 20,
              fontSize: '0.75rem',
            }}
          />
        </Box>
        <Box>
          <IconButton
            size="small"
            onClick={() => setExpanded(!expanded)}
            sx={{ color: 'white', mr: 0.5 }}
          >
            {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          </IconButton>
          <IconButton
            size="small"
            onClick={onClose}
            sx={{ color: 'white' }}
            disabled={activeTasks.length > 0}
          >
            <CloseIcon />
          </IconButton>
        </Box>
      </Box>

      <Collapse in={expanded}>
        <Box sx={{ maxHeight: 'calc(60vh - 64px)', overflow: 'auto' }}>
          <List sx={{ p: 0 }}>
            {tasks.map((task) => (
              <ListItem
                key={task.id}
                sx={{
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  py: 1.5,
                  bgcolor:
                    task.status === 'error'
                      ? 'error.lighter'
                      : task.status === 'completed'
                      ? 'success.lighter'
                      : 'transparent',
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  {task.status === 'processing' && (
                    <Box
                      sx={{
                        width: 16,
                        height: 16,
                        border: '2px solid',
                        borderColor: 'primary.main',
                        borderTopColor: 'transparent',
                        borderRadius: '50%',
                        animation: 'spin 0.8s linear infinite',
                        '@keyframes spin': {
                          '0%': { transform: 'rotate(0deg)' },
                          '100%': { transform: 'rotate(360deg)' },
                        },
                      }}
                    />
                  )}
                  {task.status === 'completed' && (
                    <CheckCircleIcon sx={{ color: 'success.main', fontSize: 20 }} />
                  )}
                  {task.status === 'error' && (
                    <ErrorIcon sx={{ color: 'error.main', fontSize: 20 }} />
                  )}
                  {task.status === 'queued' && (
                    <Chip label="Queued" size="small" variant="outlined" />
                  )}

                  <ListItemText
                    primary={
                      <Typography variant="body2" fontWeight="medium">
                        {task.title}
                      </Typography>
                    }
                    secondary={
                      <Typography variant="caption" color="text.secondary">
                        {task.description}
                      </Typography>
                    }
                    sx={{ flex: 1, m: 0 }}
                  />

                  {task.status === 'processing' && typeof onCancelTask === 'function' && (
                    <IconButton size="small" onClick={() => onCancelTask(task.id)}>
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  )}
                </Box>

                {task.status === 'processing' && task.progress !== undefined && (
                  <Box sx={{ width: '100%', mt: 1 }}>
                    <LinearProgress
                      variant={task.progress > 0 ? 'determinate' : 'indeterminate'}
                      value={task.progress}
                      sx={{ height: 6, borderRadius: 1 }}
                    />
                    {task.progress > 0 && (
                      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                        {Math.round(task.progress)}% {task.progressText && `• ${task.progressText}`}
                      </Typography>
                    )}
                  </Box>
                )}

                {task.status === 'error' && (
                  <Typography variant="caption" color="error" sx={{ mt: 0.5 }}>
                    Error: {task.error || 'Unknown error'}
                  </Typography>
                )}

                {task.status === 'completed' && task.result && (
                  <Typography variant="caption" color="success.main" sx={{ mt: 0.5 }}>
                    {task.result}
                  </Typography>
                )}
              </ListItem>
            ))}
          </List>
        </Box>
      </Collapse>
    </Paper>
  );
};

export default BackgroundTaskQueue;
