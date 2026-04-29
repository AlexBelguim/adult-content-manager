import React, { useMemo } from 'react';
import {
  Box,
  Card,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  Chip,
  Stack,
  Alert,
  Collapse,
  IconButton,
  CircularProgress,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  Storage as StorageIcon,
  CompareArrows as CompareArrowsIcon,
} from '@mui/icons-material';

const darkCardStyle = {
  bgcolor: '#252525',
  borderRadius: 2,
  border: '1px solid #444',
  overflow: 'hidden',
  mb: 3
};

const gradientButtonStyle = {
  background: 'linear-gradient(135deg, var(--primary-main, #7e57c2) 0%, var(--primary-dark, #5e35b1) 100%)',
  color: '#fff',
  fontWeight: 'bold',
  textTransform: 'none',
  boxShadow: '0 3px 5px 2px rgba(126, 87, 194, .3)',
  '&:hover': {
    background: 'linear-gradient(135deg, #8e67d2 0%, #6e45c1 100%)',
    boxShadow: '0 3px 10px 2px rgba(126, 87, 194, .4)',
  },
  '&:disabled': {
    background: '#444',
    color: '#777',
    boxShadow: 'none'
  }
};

function DuplicatePerformersSection({ performers, onCreateHashDB, onCompare, processingActions = new Set(), hashQueue = [] }) {
  const [expanded, setExpanded] = React.useState(true);

  // Check if performer is in hash creation queue
  const isPerformerInQueue = (performerId) => {
    return hashQueue.some(job =>
      job.performerId === performerId &&
      (job.status === 'queued' || job.status === 'processing')
    );
  };

  // Find performers that exist in both before and after
  const duplicatePerformers = useMemo(() => {
    const performersByName = {};

    // Group performers by name
    performers.forEach(p => {
      const name = p.canonical_name.toLowerCase();
      if (!performersByName[name]) {
        performersByName[name] = [];
      }
      performersByName[name].push(p);
    });

    // Find performers with both before and after versions
    const duplicates = [];
    Object.entries(performersByName).forEach(([name, perfList]) => {
      const beforePerf = perfList.find(p => p.location === 'before');
      const afterPerf = perfList.find(p => p.location === 'after');

      if (beforePerf && afterPerf) {
        duplicates.push({
          name: beforePerf.canonical_name,
          before: beforePerf,
          after: afterPerf,
        });
      }
    });

    // Sort by name
    return duplicates.sort((a, b) => a.name.localeCompare(b.name));
  }, [performers]);

  if (duplicatePerformers.length === 0) {
    return null;
  }

  const handleCreateBoth = (dup) => {
    // Create hash DB for before version
    onCreateHashDB(dup.before.id);

    // After a short delay, create for after version
    setTimeout(() => {
      onCreateHashDB(dup.after.id);
    }, 1000);
  };

  const handleCompareVersions = (dup) => {
    // If both have hash DBs, start comparison
    if (dup.before.has_hash_db && dup.after.has_hash_db) {
      // Pass both IDs to parent
      onCompare(dup.before.id, dup.after.id);
    } else {
      alert('Both versions need hash databases before comparing. Please create them first.');
    }
  };

  return (
    <Card sx={darkCardStyle}>
      <Box sx={{ display: 'flex', alignItems: 'center', p: 3, cursor: 'pointer', '&:hover': { bgcolor: 'rgba(255,255,255,0.02)' } }} onClick={() => setExpanded(!expanded)}>
        <IconButton
          size="small"
          sx={{
            transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
            transition: 'transform 0.3s',
            mr: 2,
            bgcolor: 'rgba(255,255,255,0.05)',
            '&:hover': { bgcolor: 'rgba(255,255,255,0.1)' }
          }}
        >
          <ExpandMoreIcon />
        </IconButton>
        <Typography variant="h6" component="h2" sx={{ fontWeight: 600 }}>
          Performers in Both Locations
        </Typography>
        <Chip
          label={duplicatePerformers.length}
          color="warning"
          size="small"
          sx={{ ml: 2, fontWeight: 'bold' }}
        />
      </Box>

      <Collapse in={expanded}>
        <Box sx={{ p: 3, pt: 0 }}>
          <Alert severity="info" sx={{ mb: 2 }}>
            These performers exist in both "Before Filter" and "After Filter" folders.
            You can create hash databases for both versions and compare them to find duplicates.
            <br />
            <strong>Note:</strong> When comparing, files from "Before Filter" will be marked for removal,
            and files from "After Filter" will be kept.
          </Alert>

          <TableContainer sx={{ border: '1px solid #333', borderRadius: 2 }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'rgba(255,255,255,0.05)' }}>
                  <TableCell sx={{ color: '#e0e0e0', borderBottom: '1px solid #333' }}>Performer Name</TableCell>
                  <TableCell align="center" sx={{ color: '#e0e0e0', borderBottom: '1px solid #333' }}>Before Status</TableCell>
                  <TableCell align="center" sx={{ color: '#e0e0e0', borderBottom: '1px solid #333' }}>After Status</TableCell>
                  <TableCell align="right" sx={{ color: '#e0e0e0', borderBottom: '1px solid #333' }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {duplicatePerformers.map((dup) => {
                  const bothHaveHashDB = dup.before.has_hash_db && dup.after.has_hash_db;
                  const neitherHasHashDB = !dup.before.has_hash_db && !dup.after.has_hash_db;

                  return (
                    <TableRow key={`${dup.before.id}-${dup.after.id}`} hover sx={{ '&:hover': { bgcolor: 'rgba(255,255,255,0.03) !important' } }}>
                      <TableCell sx={{ borderBottom: '1px solid #333', color: '#fff' }}>
                        <Typography variant="body2" fontWeight="medium">
                          {dup.name}
                        </Typography>
                      </TableCell>
                      <TableCell align="center" sx={{ borderBottom: '1px solid #333' }}>
                        <Stack direction="row" spacing={1} alignItems="center" justifyContent="center">
                          <Chip
                            label={dup.before.has_hash_db ? `✓ ${dup.before.file_count} files` : 'No Hash DB'}
                            color={dup.before.has_hash_db ? 'success' : 'default'}
                            size="small"
                            variant={dup.before.has_hash_db ? 'filled' : 'outlined'}
                          />
                        </Stack>
                      </TableCell>
                      <TableCell align="center" sx={{ borderBottom: '1px solid #333' }}>
                        <Stack direction="row" spacing={1} alignItems="center" justifyContent="center">
                          <Chip
                            label={dup.after.has_hash_db ? `✓ ${dup.after.file_count} files` : 'No Hash DB'}
                            color={dup.after.has_hash_db ? 'success' : 'default'}
                            size="small"
                            variant={dup.after.has_hash_db ? 'filled' : 'outlined'}
                          />
                        </Stack>
                      </TableCell>
                      <TableCell align="right" sx={{ borderBottom: '1px solid #333' }}>
                        <Stack direction="row" spacing={1} justifyContent="flex-end">
                          {neitherHasHashDB && (
                            <Button
                              variant="contained"
                              size="small"
                              startIcon={<StorageIcon />}
                              onClick={(e) => { e.stopPropagation(); handleCreateBoth(dup); }}
                              sx={gradientButtonStyle}
                            >
                              Create Both
                            </Button>
                          )}
                          {!neitherHasHashDB && !bothHaveHashDB && (
                            <>
                              {!dup.before.has_hash_db && (
                                <Button
                                  variant="outlined"
                                  size="small"
                                  color="primary"
                                  onClick={(e) => { e.stopPropagation(); onCreateHashDB(dup.before.id); }}
                                  disabled={isPerformerInQueue(dup.before.id)}
                                  startIcon={isPerformerInQueue(dup.before.id) ? <CircularProgress size={16} /> : undefined}
                                  sx={{
                                    color: '#90caf9',
                                    borderColor: 'rgba(144, 202, 249, 0.5)',
                                    '&:hover': { borderColor: '#90caf9', bgcolor: 'rgba(144, 202, 249, 0.08)' }
                                  }}
                                >
                                  {isPerformerInQueue(dup.before.id) ? 'In Queue' : 'Create Before'}
                                </Button>
                              )}
                              {!dup.after.has_hash_db && (
                                <Button
                                  variant="outlined"
                                  size="small"
                                  color="primary"
                                  onClick={(e) => { e.stopPropagation(); onCreateHashDB(dup.after.id); }}
                                  disabled={isPerformerInQueue(dup.after.id)}
                                  startIcon={isPerformerInQueue(dup.after.id) ? <CircularProgress size={16} /> : undefined}
                                  sx={{
                                    color: '#90caf9',
                                    borderColor: 'rgba(144, 202, 249, 0.5)',
                                    '&:hover': { borderColor: '#90caf9', bgcolor: 'rgba(144, 202, 249, 0.08)' }
                                  }}
                                >
                                  {isPerformerInQueue(dup.after.id) ? 'In Queue' : 'Create After'}
                                </Button>
                              )}
                            </>
                          )}
                          {bothHaveHashDB && (
                            <Button
                              variant="contained"
                              color="secondary"
                              size="small"
                              startIcon={processingActions.has(`compare-${dup.before.id}-${dup.after.id}`) ? <CircularProgress size={16} /> : <CompareArrowsIcon />}
                              onClick={(e) => { e.stopPropagation(); handleCompareVersions(dup); }}
                              disabled={processingActions.has(`compare-${dup.before.id}-${dup.after.id}`)}
                            >
                              {processingActions.has(`compare-${dup.before.id}-${dup.after.id}`) ? 'Processing...' : 'Compare Versions'}
                            </Button>
                          )}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      </Collapse>
    </Card >
  );
}

export default DuplicatePerformersSection;
