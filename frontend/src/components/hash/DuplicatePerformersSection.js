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
  Avatar,
  Chip,
  Stack,
  Alert,
  Collapse,
  IconButton,
  Tooltip,
  CircularProgress,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Storage as StorageIcon,
  CompareArrows as CompareArrowsIcon,
  Warning as WarningIcon,
} from '@mui/icons-material';
import { Panel, ICON, iconBtnSx } from '../layout';

/* Table-view styles. Kept verbatim from the original component: the point of
   the Cards/Table toggle is that Table is the OLD view, so this section has to
   switch with it the way the main list does. */
const darkCardStyle = {
  bgcolor: 'var(--surface)',
  borderRadius: 2,
  border: '1px solid #444',
  overflow: 'hidden',
  mb: 3
};

const gradientButtonStyle = {
  background: 'linear-gradient(135deg, var(--primary-main, var(--accent)) 0%, var(--primary-dark, #5e35b1) 100%)',
  color: 'var(--text)',
  fontWeight: 'bold',
  textTransform: 'none',
  boxShadow: '0 3px 5px 2px var(--accent-quiet)',
  '&:hover': {
    background: 'linear-gradient(135deg, #8e67d2 0%, #6e45c1 100%)',
    boxShadow: '0 3px 10px 2px var(--accent-quiet)',
  },
  '&:disabled': {
    background: 'var(--raised)',
    color: '#777',
    boxShadow: 'none'
  }
};

/* Same primitives as PerformerManagementPageNew's duplicate groups — this is
   the same concept (one name, two locations) and it should read the same. */
const pillSx = (tone) => ({
  flexShrink: 0,
  fontSize: '0.62rem',
  fontWeight: 700,
  letterSpacing: '.02em',
  color: tone,
  border: '1px solid',
  borderColor: tone,
  borderRadius: 'var(--radius-sm, 4px)',
  px: 0.75,
  py: '1px',
  lineHeight: 1.5,
  whiteSpace: 'nowrap'
});

const dotSx = (tone) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  fontSize: '0.68rem',
  color: 'var(--muted)',
  '&::before': {
    content: '""',
    width: 6, height: 6, borderRadius: '50%',
    background: tone, flexShrink: 0
  }
});

/* `thumbnail` is a file path; there is no GET /api/performers/:id/thumbnail.
   See the note in PerformerManagementPageNew. */
const thumbUrl = (p) =>
  (p?.thumbnail ? `/api/files/preview?path=${encodeURIComponent(p.thumbnail)}` : undefined);

function DuplicatePerformersSection({ performers, onCreateHashDB, onCompare, processingActions = new Set(), hashQueue = [], viewMode = 'cards' }) {
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
    // Both sides need a hash DB. The button is only rendered when they do, so
    // this is a guard rather than a path the UI can normally reach.
    if (dup.before.has_hash_db && dup.after.has_hash_db) {
      onCompare(dup.before.id, dup.after.id);
    }
  };

  const hashDot = (side, label) => (
    <Tooltip title={side.has_hash_db
      ? `${label}: ${side.file_count || 0} files hashed`
      : `${label}: no hash database yet`}>
      <Box component="span" sx={dotSx(side.has_hash_db ? 'var(--ok)' : 'var(--faint)')}>
        {label} {side.has_hash_db ? `${side.file_count || 0}` : '—'}
      </Box>
    </Tooltip>
  );

  // Table view = the original component, unchanged. The toggle means "show me
  // the old way", so this section has to switch with it exactly as the main
  // list does — on Performer Management the duplicate groups live inside both
  // branches, and this one was rendered outside the toggle entirely.
  if (viewMode === 'table') {
    return (
      <Card sx={darkCardStyle}>
        <Box sx={{ display: 'flex', alignItems: 'center', p: 3, cursor: 'pointer', '&:hover': { bgcolor: 'var(--raised)' } }} onClick={() => setExpanded(!expanded)}>
          <IconButton
            size="small"
            sx={{
              transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition: 'transform 0.3s',
              mr: 2,
              bgcolor: 'var(--raised)',
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
                  <TableRow sx={{ bgcolor: 'var(--raised)' }}>
                    <TableCell sx={{ color: 'var(--text)', borderBottom: '1px solid #333' }}>Performer Name</TableCell>
                    <TableCell align="center" sx={{ color: 'var(--text)', borderBottom: '1px solid #333' }}>Before Status</TableCell>
                    <TableCell align="center" sx={{ color: 'var(--text)', borderBottom: '1px solid #333' }}>After Status</TableCell>
                    <TableCell align="right" sx={{ color: 'var(--text)', borderBottom: '1px solid #333' }}>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {duplicatePerformers.map((dup) => {
                    const bothHaveHashDB = dup.before.has_hash_db && dup.after.has_hash_db;
                    const neitherHasHashDB = !dup.before.has_hash_db && !dup.after.has_hash_db;

                    return (
                      <TableRow key={`${dup.before.id}-${dup.after.id}`} hover sx={{ '&:hover': { bgcolor: 'rgba(255,255,255,0.03) !important' } }}>
                        <TableCell sx={{ borderBottom: '1px solid #333', color: 'var(--text)' }}>
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
                                      color: 'var(--info)',
                                      borderColor: 'var(--info-quiet)',
                                      '&:hover': { borderColor: 'var(--info)', bgcolor: 'var(--info-quiet)' }
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
                                      color: 'var(--info)',
                                      borderColor: 'var(--info-quiet)',
                                      '&:hover': { borderColor: 'var(--info)', bgcolor: 'var(--info-quiet)' }
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
      </Card>
    );
  }

  return (
    <Box sx={{ mb: 3 }}>
      <Panel
        padded={false}
        sx={{ mb: 0.75, borderColor: 'var(--warn)', bgcolor: 'var(--warn-quiet)' }}
      >
        <Box
          sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, cursor: 'pointer' }}
          onClick={() => setExpanded(!expanded)}
        >
          <IconButton size="small" sx={iconBtnSx()}>
            {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          </IconButton>
          <WarningIcon sx={{ fontSize: ICON.inline, color: 'var(--warn)' }} />
          <Typography sx={{ fontSize: '0.9rem', fontWeight: 620, color: 'var(--text)' }}>
            Performers in both locations
          </Typography>
          <Box component="span" sx={pillSx('var(--warn)')}>{duplicatePerformers.length}</Box>
        </Box>
      </Panel>

      <Collapse in={expanded}>
        <Alert severity="info" sx={{ mb: 1 }}>
          These exist in both “Before Filter” and “After Filter”. Hash both sides, then compare to
          find duplicates — files from Before are marked for removal, files from After are kept.
        </Alert>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {duplicatePerformers.map((dup) => {
            const bothHaveHashDB = dup.before.has_hash_db && dup.after.has_hash_db;
            const neitherHasHashDB = !dup.before.has_hash_db && !dup.after.has_hash_db;
            const comparing = processingActions.has(`compare-${dup.before.id}-${dup.after.id}`);

            return (
              <Panel
                key={`${dup.before.id}-${dup.after.id}`}
                padded={false}
                sx={{
                  // .App is a flex column; cards in a nested flex column
                  // collapse without this. See the note in FunpipePage.
                  flexShrink: 0,
                  '&:hover': { borderColor: 'var(--line-strong)' }
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, p: 1 }}>
                  {/* Both faces, overlapped — deciding whether the two folders
                      hold the same person is a visual call, and the old table
                      gave you a name and two status chips. */}
                  <Box sx={{ display: 'flex', alignItems: 'center', pl: 0.5 }}>
                    {[dup.before, dup.after].map((side, i) => (
                      <Avatar
                        key={side.id}
                        variant="rounded"
                        src={thumbUrl(side)}
                        sx={{
                          width: 44, height: 44, flexShrink: 0,
                          ml: i ? '-10px' : 0, zIndex: 2 - i,
                          border: '2px solid var(--surface)',
                          borderRadius: 'var(--radius-sm, 4px)',
                          bgcolor: 'var(--raised)', color: 'var(--muted)', fontSize: '0.9rem'
                        }}
                      >
                        {dup.name?.[0] || '?'}
                      </Avatar>
                    ))}
                  </Box>

                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                      title={dup.name}
                      sx={{
                        fontSize: '0.9rem', fontWeight: 620, color: 'var(--text)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                      }}
                    >
                      {dup.name}
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mt: 0.5, flexWrap: 'wrap' }}>
                      {hashDot(dup.before, 'before')}
                      {hashDot(dup.after, 'after')}
                    </Box>
                  </Box>

                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0, pr: 0.5 }}>
                    {neitherHasHashDB && (
                      <Button
                        variant="contained"
                        size="small"
                        startIcon={<StorageIcon />}
                        onClick={(e) => { e.stopPropagation(); handleCreateBoth(dup); }}
                        sx={{ fontSize: '0.7rem', py: 0.5 }}
                      >
                        Hash both
                      </Button>
                    )}
                    {!neitherHasHashDB && !bothHaveHashDB && (
                      <>
                        {!dup.before.has_hash_db && (
                          <Button
                            variant="outlined"
                            size="small"
                            onClick={(e) => { e.stopPropagation(); onCreateHashDB(dup.before.id); }}
                            disabled={isPerformerInQueue(dup.before.id)}
                            startIcon={isPerformerInQueue(dup.before.id) ? <CircularProgress size={14} /> : undefined}
                            sx={{ fontSize: '0.7rem', py: 0.5 }}
                          >
                            {isPerformerInQueue(dup.before.id) ? 'Queued' : 'Hash before'}
                          </Button>
                        )}
                        {!dup.after.has_hash_db && (
                          <Button
                            variant="outlined"
                            size="small"
                            onClick={(e) => { e.stopPropagation(); onCreateHashDB(dup.after.id); }}
                            disabled={isPerformerInQueue(dup.after.id)}
                            startIcon={isPerformerInQueue(dup.after.id) ? <CircularProgress size={14} /> : undefined}
                            sx={{ fontSize: '0.7rem', py: 0.5 }}
                          >
                            {isPerformerInQueue(dup.after.id) ? 'Queued' : 'Hash after'}
                          </Button>
                        )}
                      </>
                    )}
                    {bothHaveHashDB && (
                      <Button
                        variant="contained"
                        size="small"
                        startIcon={comparing ? <CircularProgress size={14} color="inherit" /> : <CompareArrowsIcon />}
                        onClick={(e) => { e.stopPropagation(); handleCompareVersions(dup); }}
                        disabled={comparing}
                        sx={{ fontSize: '0.7rem', py: 0.5 }}
                      >
                        {comparing ? 'Comparing…' : 'Compare'}
                      </Button>
                    )}
                  </Box>
                </Box>
              </Panel>
            );
          })}
        </Box>
      </Collapse>
    </Box>
  );
}

export default DuplicatePerformersSection;
