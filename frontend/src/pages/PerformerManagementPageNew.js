import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container,
  Typography,
  Box,
  Paper,
  Tabs,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  IconButton,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  CircularProgress,
  TextField,
  InputAdornment,
  Tooltip,
  Card,
  CardContent,
  Grid,
  Alert,
  LinearProgress,
  Collapse,
  RadioGroup,
  FormControlLabel,
  Radio,
  Badge
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
  CloudDone as CloudDoneIcon,
  Fingerprint as FingerprintIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Block as BlockIcon,
  CheckCircle as CheckCircleIcon,
  Warning as WarningIcon,
  MergeType as MergeIcon,
  CleaningServices as CleanIcon,
  ArrowUpward as ArrowUpwardIcon,
  ArrowDownward as ArrowDownwardIcon,
  Update as UpdateIcon,
  History as HistoryIcon,
  Notifications as NotificationsIcon,
  NotificationsActive as NotificationsActiveIcon,
  Edit as EditIcon
} from '@mui/icons-material';
import { offlineStorage } from '../services/OfflineStorage';
import { socketService } from '../services/SocketService';

// Helper function to calculate age from birth date
function calculateAge(birthDateStr) {
  if (!birthDateStr) return null;

  try {
    const birthDate = new Date(birthDateStr);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();

    // Adjust if birthday hasn't occurred yet this year
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }

    return age;
  } catch (e) {
    return null;
  }
}

function PerformerManagementPage() {
  const [performers, setPerformers] = useState([]);
  const [grouped, setGrouped] = useState({ before: [], after: [], 'missing-or-empty': [], blacklisted: [] });
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentTab, setCurrentTab] = useState(0); // 0=all, 1=before, 2=after, 3=missing-or-empty, 4=blacklisted
  const [searchTerm, setSearchTerm] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedPerformer, setSelectedPerformer] = useState(null);
  const [deleteOptions, setDeleteOptions] = useState([]);
  const [selectedDeleteOption, setSelectedDeleteOption] = useState('');
  const [blacklistReason, setBlacklistReason] = useState('');
  const [processing, setProcessing] = useState(false);
  const [expandedPerformer, setExpandedPerformer] = useState(null);
  const [expandedGroup, setExpandedGroup] = useState(null);
  const [sortConfig, setSortConfig] = useState([]); // Array of {field, direction} for multi-level sorting
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateCheckResults, setUpdateCheckResults] = useState(null);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renamePerformer, setRenamePerformer] = useState(null);
  const [newPerformerName, setNewPerformerName] = useState('');
  const [renameFolderToo, setRenameFolderToo] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    // Initial load: try offline first
    loadPerformers(true);

    // Connect socket and listen for updates
    socketService.connect();

    const handleUpdate = (data) => {
      console.log("Received update via socket", data);
      // Refresh data on update
      loadPerformers(false);
    };

    socketService.on('performers_updated', handleUpdate);

    return () => {
      socketService.off('performers_updated', handleUpdate);
    };
  }, []);

  const loadPerformers = async (loadOfflineFirst = false) => {
    try {
      setLoading(true);

      if (loadOfflineFirst) {
        try {
          const offlineData = await offlineStorage.getPerformerManagementData();
          if (offlineData) {
            setPerformers(offlineData.performers);
            setGrouped(offlineData.grouped);
            setSummary(offlineData.summary);
            // If we are offline, stop here
            if (!navigator.onLine) {
              setLoading(false);
              return;
            }
          }
        } catch (e) {
          console.warn("Failed to load offline data", e);
        }
      }

      if (!navigator.onLine) {
        setLoading(false);
        return;
      }

      const response = await fetch('/api/performer-management/all');
      const data = await response.json();

      if (data.success) {
        setPerformers(data.performers);
        setGrouped(data.grouped);
        setSummary(data.summary);

        // Save to offline storage
        offlineStorage.savePerformerManagementData(data);
      }
    } catch (error) {
      console.error('Error loading performers:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteClick = (performer) => {
    setSelectedPerformer(performer);
    setBlacklistReason('');

    // Determine available options based on location
    let options = [];

    if (performer.blacklisted === 1) {
      // Blacklisted: can unblacklist or delete completely
      options = ['unblacklist', 'delete-complete'];
      setSelectedDeleteOption('unblacklist');
    } else if (performer.location === 'after') {
      // In after: can cleanup before folder or delete completely
      options = ['cleanup-before', 'delete-complete'];
      setSelectedDeleteOption('cleanup-before');
    } else if (performer.location === 'before') {
      // In before: can blacklist, delete folder only, or delete completely
      options = ['blacklist', 'delete-folder-only', 'delete-complete'];
      setSelectedDeleteOption('blacklist');
    } else {
      // Missing/empty: only complete delete
      options = ['delete-complete'];
      setSelectedDeleteOption('delete-complete');
    }

    setDeleteOptions(options);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!selectedPerformer || !selectedDeleteOption) return;

    try {
      setProcessing(true);
      let response;

      switch (selectedDeleteOption) {
        case 'unblacklist':
          response = await fetch(`/api/performer-management/${selectedPerformer.id}/unblacklist`, {
            method: 'POST'
          });
          break;

        case 'blacklist':
          response = await fetch(`/api/performer-management/${selectedPerformer.id}/blacklist`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: blacklistReason })
          });
          break;

        case 'delete-folder-only':
          response = await fetch(`/api/performer-management/${selectedPerformer.id}/folder-only`, {
            method: 'DELETE'
          });
          break;

        case 'cleanup-before':
          response = await fetch(`/api/performer-management/${selectedPerformer.id}/before-cleanup`, {
            method: 'DELETE'
          });
          break;

        case 'delete-complete':
          response = await fetch(`/api/performer-management/${selectedPerformer.id}/complete`, {
            method: 'DELETE'
          });
          break;

        default:
          throw new Error('Invalid delete option');
      }

      const data = await response.json();

      if (data.success) {
        await loadPerformers();
        setDeleteDialogOpen(false);
        setSelectedPerformer(null);
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (error) {
      console.error('Error processing action:', error);
      alert('Failed to process action');
    } finally {
      setProcessing(false);
    }
  };

  const handleRescanPerformer = async (performer) => {
    try {
      const response = await fetch(`/api/performer-management/${performer.id}/rescan`, {
        method: 'POST'
      });
      const data = await response.json();

      if (data.success) {
        await loadPerformers();
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (error) {
      console.error('Error rescanning performer:', error);
      alert('Failed to rescan performer');
    }
  };

  const handleCheckUpdates = async () => {
    try {
      setCheckingUpdates(true);
      setUpdateCheckResults(null);

      const response = await fetch('/api/performer-management/check-updates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}) // Empty body to check all performers
      });

      const data = await response.json();

      if (data.success) {
        setUpdateCheckResults(data.summary);
        await loadPerformers(); // Reload to show updated data

        if (data.summary.newUpdates > 0) {
          alert(`Found ${data.summary.newUpdates} new content update${data.summary.newUpdates > 1 ? 's' : ''}!`);
        } else {
          alert('Update check complete. No new updates found.');
        }
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (error) {
      console.error('Error checking for updates:', error);
      alert('Failed to check for updates');
    } finally {
      setCheckingUpdates(false);
    }
  };

  const handleAcknowledgeUpdate = async (performerId, performerName) => {
    try {
      const response = await fetch(`/api/performer-management/${performerId}/acknowledge-update`, {
        method: 'POST'
      });

      const data = await response.json();

      if (data.success) {
        await loadPerformers(); // Reload to update UI
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (error) {
      console.error('Error acknowledging update:', error);
      alert('Failed to acknowledge update');
    }
  };

  const handleRenameClick = (performer) => {
    setRenamePerformer(performer);
    setNewPerformerName(performer.name);
    setRenameFolderToo(true);
    setRenameDialogOpen(true);
  };

  const handleRenameConfirm = async () => {
    if (!renamePerformer || !newPerformerName.trim()) return;

    if (newPerformerName.trim() === renamePerformer.name) {
      alert('New name is the same as the current name');
      return;
    }

    try {
      setProcessing(true);

      const response = await fetch(`/api/performer-management/${renamePerformer.id}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newName: newPerformerName.trim(),
          renameFolder: renameFolderToo
        })
      });

      const data = await response.json();

      if (data.success) {
        await loadPerformers();
        setRenameDialogOpen(false);
        setRenamePerformer(null);
        alert(`Successfully renamed performer from "${data.oldName}" to "${data.newName}"`);
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (error) {
      console.error('Error renaming performer:', error);
      alert('Failed to rename performer');
    } finally {
      setProcessing(false);
    }
  };

  const handleMergeNow = async (beforeId, afterId) => {
    try {
      // Move the before performer to after (will auto-merge)
      const response = await fetch(`/api/performers/${beforeId}/move-to-after`, {
        method: 'POST'
      });
      const data = await response.json();

      if (data.success) {
        alert('Performers merged successfully!');
        await loadPerformers();
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (error) {
      console.error('Error merging performers:', error);
      alert('Failed to merge performers');
    }
  };

  const handleOpenFolder = async (folderPath) => {
    if (!folderPath) return;

    try {
      const response = await fetch('/api/files/open-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: folderPath })
      });

      const data = await response.json();
      if (!data.success) {
        // show non-blocking console message and toast-style alert
        console.warn('Open folder failed:', data.error);
        // fallback: copy path to clipboard so user can paste into Explorer
        try { await navigator.clipboard.writeText(folderPath); } catch (e) { }
        alert('Failed to open folder automatically. Path copied to clipboard. You can paste it into Explorer.');
      }
    } catch (error) {
      console.error('Error opening folder:', error);
      try { await navigator.clipboard.writeText(folderPath); } catch (e) { }
      alert('Failed to open folder automatically. Path copied to clipboard. You can paste it into Explorer.');
    }
  };

  const handleOpenHashDB = (performerId) => {
    if (!performerId) return;
    // navigate to hash management, include performerId as query param
    navigate(`/hash-management?performerId=${performerId}`);
  };

  const handleScrape = async (performer) => {
    if (!performer || !performer.id) return;
    setProcessing(true);
    try {
      const response = await fetch(`/api/performers/${performer.id}/scrape`, { method: 'POST' });
      const data = await response.json();
      if (data.success) {
        // refresh performers to show scraped data
        await loadPerformers();
      } else {
        alert('Scrape failed: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      console.error('Error scraping performer:', err);
      alert('Failed to run scraper');
    } finally {
      setProcessing(false);
    }
  };

  const toggleExpandPerformer = (performerId) => {
    setExpandedPerformer(expandedPerformer === performerId ? null : performerId);
  };

  const toggleExpandGroup = (groupKey) => {
    setExpandedGroup(expandedGroup === groupKey ? null : groupKey);
  };

  const getLocationLabel = (location) => {
    switch (location) {
      case 'before': return 'Before Filter';
      case 'after': return 'After Filter';
      case 'missing-or-empty': return 'Missing or Empty';
      case 'blacklisted': return 'Blacklisted';
      default: return 'Unknown';
    }
  };

  const getLocationColor = (location) => {
    switch (location) {
      case 'before': return 'warning';
      case 'after': return 'success';
      case 'missing-or-empty': return 'error';
      case 'blacklisted': return 'default';
      default: return 'default';
    }
  };

  const handleSort = (field) => {
    setSortConfig(prevConfig => {
      // Check if this field is already in the sort config
      const existingIndex = prevConfig.findIndex(c => c.field === field);

      if (existingIndex >= 0) {
        // Field exists - toggle direction or remove if already desc
        const existing = prevConfig[existingIndex];
        const newConfig = [...prevConfig];

        if (existing.direction === 'asc') {
          // Change to desc
          newConfig[existingIndex] = { field, direction: 'desc' };
        } else {
          // Remove this sort level
          newConfig.splice(existingIndex, 1);
        }
        return newConfig;
      } else {
        // Add new sort level
        return [...prevConfig, { field, direction: 'asc' }];
      }
    });
  };

  const getSortIcon = (field) => {
    const sortLevel = sortConfig.findIndex(c => c.field === field);
    if (sortLevel < 0) return null;

    const config = sortConfig[sortLevel];
    const Icon = config.direction === 'asc' ? ArrowUpwardIcon : ArrowDownwardIcon;

    return (
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', ml: 0.5 }}>
        <Icon fontSize="small" />
        {sortConfig.length > 1 && (
          <Typography variant="caption" sx={{ ml: 0.3, fontWeight: 'bold' }}>
            {sortLevel + 1}
          </Typography>
        )}
      </Box>
    );
  };

  const applySorting = (performerList) => {
    if (sortConfig.length === 0) return performerList;

    return [...performerList].sort((a, b) => {
      // Apply each sort level in order
      for (const { field, direction } of sortConfig) {
        let compareResult = 0;

        switch (field) {
          case 'hashdb':
            compareResult = (b.hasHashDB ? 1 : 0) - (a.hasHashDB ? 1 : 0);
            if (compareResult === 0) {
              // If both have or don't have, sort by count
              compareResult = (b.hashStats?.fileCount || 0) - (a.hashStats?.fileCount || 0);
            }
            break;

          case 'scraped':
            compareResult = (b.hasScrapedData ? 1 : 0) - (a.hasScrapedData ? 1 : 0);
            break;

          case 'content':
            const aContent = (a.pics_count || 0) + (a.vids_count || 0) + (a.funscript_vids_count || 0);
            const bContent = (b.pics_count || 0) + (b.vids_count || 0) + (b.funscript_vids_count || 0);
            compareResult = bContent - aContent;
            break;

          case 'size':
            compareResult = (b.total_size_gb || 0) - (a.total_size_gb || 0);
            break;

          case 'leakshaven':
            // Sort by: 1) Has update time, 2) Unacknowledged first, 3) Check date
            const aHasUpdate = a.leakshavenUpdate?.lastUpdateTime ? 1 : 0;
            const bHasUpdate = b.leakshavenUpdate?.lastUpdateTime ? 1 : 0;
            compareResult = bHasUpdate - aHasUpdate;

            if (compareResult === 0 && aHasUpdate && bHasUpdate) {
              // Both have updates - prioritize unacknowledged
              const aUnack = !a.leakshavenUpdate?.acknowledged ? 1 : 0;
              const bUnack = !b.leakshavenUpdate?.acknowledged ? 1 : 0;
              compareResult = bUnack - aUnack;

              if (compareResult === 0) {
                // Sort by check date (most recent first)
                const aDate = a.leakshavenUpdate?.lastCheckDate ? new Date(a.leakshavenUpdate.lastCheckDate).getTime() : 0;
                const bDate = b.leakshavenUpdate?.lastCheckDate ? new Date(b.leakshavenUpdate.lastCheckDate).getTime() : 0;
                compareResult = bDate - aDate;
              }
            }
            break;

          default:
            break;
        }

        // Apply direction
        if (direction === 'desc') {
          compareResult = -compareResult;
        }

        // If not equal, return the result; otherwise continue to next sort level
        if (compareResult !== 0) {
          return compareResult;
        }
      }

      return 0; // All sort levels were equal
    });
  };

  const getCurrentTabPerformers = () => {
    let performerList = [];
    switch (currentTab) {
      case 0:
        // All performers
        performerList = performers || [];
        break;
      case 1:
        performerList = grouped.before || [];
        break;
      case 2:
        performerList = grouped.after || [];
        break;
      case 3:
        performerList = grouped['missing-or-empty'] || [];
        break;
      case 4:
        performerList = grouped.blacklisted || [];
        break;
      default:
        performerList = [];
    }

    // Filter by search term
    if (searchTerm) {
      const lowerSearch = searchTerm.toLowerCase();
      performerList = performerList.filter(p =>
        p.name.toLowerCase().includes(lowerSearch) ||
        (p.aliases && p.aliases.some(a => a.toLowerCase().includes(lowerSearch)))
      );
    }

    // Apply sorting
    performerList = applySorting(performerList);

    // Group duplicates
    const duplicateGroups = {};
    performerList.forEach(p => {
      if (p.hasDuplicates) {
        const key = p.name.toLowerCase();
        if (!duplicateGroups[key]) {
          duplicateGroups[key] = [];
        }
        duplicateGroups[key].push(p);
      }
    });

    // Return with duplicate grouping info
    return { performerList, duplicateGroups };
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleDateString();
  };

  const formatFileSize = (gb) => {
    if (!gb) return '0 GB';
    return `${gb.toFixed(2)} GB`;
  };

  // Calculate current age from scraped age and scrape date
  const calculateCurrentAge = (scrapedAge, scrapedAt) => {
    if (!scrapedAge || !scrapedAt) return scrapedAge;

    const scrapeDate = new Date(scrapedAt);
    const now = new Date();
    const yearsPassed = now.getFullYear() - scrapeDate.getFullYear();
    const monthsPassed = now.getMonth() - scrapeDate.getMonth();

    // If birthday hasn't occurred yet this year, subtract 1
    let currentAge = scrapedAge + yearsPassed;
    if (monthsPassed < 0) {
      currentAge--;
    }

    return currentAge;
  };

  const getDeleteOptionLabel = (option) => {
    switch (option) {
      case 'unblacklist': return 'Unblacklist';
      case 'blacklist': return 'Blacklist (Prevent Re-import)';
      case 'delete-folder-only': return 'Delete Folder Only (Keep Database)';
      case 'cleanup-before': return 'Clean Up Before Folder';
      case 'delete-complete': return 'Delete Everything';
      default: return option;
    }
  };

  const getDeleteOptionDescription = (option) => {
    switch (option) {
      case 'unblacklist':
        return 'Remove blacklist status. This performer can be imported again.';
      case 'blacklist':
        return 'Prevent re-importing this performer. Keeps hash DB, name, aliases, and scraped data. Deletes folders, filter actions, and tags.';
      case 'delete-folder-only':
        return 'Delete folders from disk but keep ALL database records (performer, hash DB, filter actions, tags, scraped data). Useful for freeing disk space.';
      case 'cleanup-before':
        return 'Clean up leftover "before filter performer" folder and trash. Merges hash databases. Your "after" folder stays intact.';
      case 'delete-complete':
        return 'PERMANENT deletion of ALL data and files! Deletes folders, database records, hash DB, everything. Cannot be undone!';
      default:
        return '';
    }
  };

  const renderDuplicateGroup = (performers) => {
    const groupKey = performers[0].name;
    const isExpanded = expandedGroup === groupKey;
    const beforePerformers = performers.filter(p => p.location === 'before');
    const afterPerformers = performers.filter(p => p.location === 'after');

    return (
      <React.Fragment key={`group-${groupKey}`}>
        <TableRow hover sx={{ backgroundColor: 'rgba(255, 152, 0, 0.15)' }}>
          <TableCell colSpan={8}>
            <Box display="flex" alignItems="center" justifyContent="space-between">
              <Box display="flex" alignItems="center">
                <IconButton size="small" onClick={() => toggleExpandGroup(groupKey)}>
                  {isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                </IconButton>
                <WarningIcon color="warning" sx={{ mr: 1 }} />
                <Typography variant="body1" fontWeight="bold">
                  {groupKey} <Chip label={`${performers.length} duplicates`} size="small" color="warning" sx={{ ml: 1 }} />
                </Typography>
              </Box>
              {beforePerformers.length > 0 && afterPerformers.length > 0 && (
                <Button
                  variant="contained"
                  color="primary"
                  size="small"
                  startIcon={<MergeIcon />}
                  onClick={() => handleMergeNow(beforePerformers[0].id, afterPerformers[0].id)}
                >
                  Merge Now
                </Button>
              )}
            </Box>
          </TableCell>
        </TableRow>
        {isExpanded && performers.map(performer => renderPerformerRow(performer, true))}
      </React.Fragment>
    );
  };

  const renderPerformerRow = (performer, isDuplicate = false) => {
    const isExpanded = expandedPerformer === performer.id;

    return (
      <React.Fragment key={performer.id}>
        <TableRow hover sx={isDuplicate ? { backgroundColor: 'rgba(255, 152, 0, 0.05)' } : {}}>
          <TableCell>
            <Box display="flex" alignItems="center">
              <IconButton
                size="small"
                onClick={() => toggleExpandPerformer(performer.id)}
              >
                {isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              </IconButton>
              <Typography variant="body2" fontWeight="bold" ml={1}>
                {isDuplicate && 'â””â”€ '}
                {performer.name}
                {performer.blacklisted === 1 && (
                  <Chip label="BLACKLISTED" size="small" color="default" sx={{ ml: 1 }} icon={<BlockIcon />} />
                )}
              </Typography>
            </Box>
          </TableCell>
          <TableCell>
            <Chip
              label={getLocationLabel(performer.location)}
              color={getLocationColor(performer.location)}
              size="small"
            />
          </TableCell>
          <TableCell align="center">
            {performer.folderExists ? (
              <Tooltip title={`${performer.actualPath}\n\nClick to open folder in Explorer`}>
                <IconButton
                  size="small"
                  onClick={() => handleOpenFolder(performer.actualPath)}
                  color="success"
                >
                  <FolderOpenIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : (
              <Tooltip title={`${performer.actualPath}\n\nFolder not found`}>
                <FolderIcon color="error" fontSize="small" />
              </Tooltip>
            )}
          </TableCell>
          <TableCell align="center">
            {performer.hasHashDB ? (
              <Tooltip title={`Open Hash Management (${performer.hashStats.fileCount} files)`}>
                <IconButton size="small" onClick={() => handleOpenHashDB(performer.id)}>
                  <Badge badgeContent={performer.hashStats.fileCount} color="primary" max={999}>
                    <FingerprintIcon color="success" fontSize="small" />
                  </Badge>
                </IconButton>
              </Tooltip>
            ) : (
              <Tooltip title="No hash database">
                <FingerprintIcon color="disabled" fontSize="small" />
              </Tooltip>
            )}
          </TableCell>
          <TableCell align="center">
            {performer.hasScrapedData ? (
              <Tooltip title={`Scraped on ${formatDate(performer.scrapedAt)}`}>
                <IconButton size="small" onClick={() => handleScrape(performer)}>
                  <CloudDoneIcon color="success" fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : (
              <Tooltip title="Run scraper now">
                <IconButton size="small" onClick={() => handleScrape(performer)}>
                  <CloudDoneIcon color="disabled" fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </TableCell>
          <TableCell>
            <Typography variant="body2">
              {performer.pics_count} / {performer.vids_count} / {performer.funscript_vids_count}
            </Typography>
          </TableCell>
          <TableCell>
            <Typography variant="body2">
              {formatFileSize(performer.total_size_gb)}
            </Typography>
          </TableCell>
          <TableCell align="center">
            {performer.leakshavenUpdate?.lastUpdateTime ? (
              <Box display="flex" alignItems="center" justifyContent="center" gap={1}>
                <Tooltip title={`Last checked: ${performer.leakshavenUpdate.lastCheckDate ? new Date(performer.leakshavenUpdate.lastCheckDate).toLocaleString() : 'Never'}. Click to visit Leakshaven page.`}>
                  <Box
                    display="flex"
                    alignItems="center"
                    gap={0.5}
                    component="a"
                    href={`https://leakshaven.com/?q=${(performer.leakshavenUpdate.searchName || performer.name).replace(/\s+/g, '+')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{
                      textDecoration: 'none',
                      cursor: 'pointer',
                      '&:hover': {
                        opacity: 0.7
                      }
                    }}
                  >
                    <HistoryIcon fontSize="small" color={!performer.leakshavenUpdate.acknowledged ? "error" : "action"} />
                    <Typography
                      variant="caption"
                      sx={{
                        fontWeight: !performer.leakshavenUpdate.acknowledged ? 700 : 400,
                        color: !performer.leakshavenUpdate.acknowledged ? 'error.main' : 'text.secondary'
                      }}
                    >
                      {performer.leakshavenUpdate.lastUpdateTime}
                    </Typography>
                  </Box>
                </Tooltip>
                {!performer.leakshavenUpdate.acknowledged && (
                  <Tooltip title="Mark as seen">
                    <IconButton
                      size="small"
                      color="primary"
                      onClick={() => handleAcknowledgeUpdate(performer.id, performer.name)}
                    >
                      <CheckCircleIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
            ) : performer.leakshavenUpdate?.error ? (
              <Tooltip title={`Error: ${performer.leakshavenUpdate.error}`}>
                <WarningIcon fontSize="small" color="error" />
              </Tooltip>
            ) : (
              <Typography variant="caption" color="text.disabled">
                Not checked
              </Typography>
            )}
          </TableCell>
          <TableCell>
            <Tooltip title="Rename performer">
              <IconButton
                size="small"
                onClick={() => handleRenameClick(performer)}
                color="info"
              >
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            {!performer.blacklisted && performer.folderExists && (
              <Tooltip title="Rescan performer folder">
                <IconButton
                  size="small"
                  onClick={() => handleRescanPerformer(performer)}
                  color="primary"
                >
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title="Delete/Manage">
              <IconButton
                size="small"
                onClick={() => handleDeleteClick(performer)}
                color="error"
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </TableCell>
        </TableRow>
        <TableRow>
          <TableCell colSpan={9} style={{ paddingBottom: 0, paddingTop: 0, backgroundColor: '#f9fafb' }}>
            <Collapse in={isExpanded} timeout="auto" unmountOnExit>
              <Box sx={{ p: 2, width: '100%' }}>
                <Grid container spacing={2.5} sx={{ width: '100%' }}>
                  {/* Row 1: 4 equal-height cards taking full width */}
                  {/* Basic Information Card - No path, no aliases */}
                  <Grid item xs={12} sm={6} md={3}>
                    <Card variant="outlined" sx={{ height: '100%', borderLeft: '4px solid #3b82f6' }}>
                      <CardContent>
                        <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, color: '#1e40af', mb: 2 }}>
                          📋 Basic Information
                        </Typography>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="body2" sx={{ fontWeight: 500, minWidth: '90px' }}>
                              🆔 ID:
                            </Typography>
                            <Typography variant="body2" color="textSecondary">
                              {performer.id}
                            </Typography>
                          </Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="body2" sx={{ fontWeight: 500, minWidth: '90px' }}>
                              📅 Imported:
                            </Typography>
                            <Typography variant="body2" color="textSecondary">
                              {formatDate(performer.import_date)}
                            </Typography>
                          </Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="body2" sx={{ fontWeight: 500, minWidth: '90px' }}>
                              🔄 Last Scan:
                            </Typography>
                            <Typography variant="body2" color="textSecondary">
                              {formatDate(performer.last_scan_date)}
                            </Typography>
                          </Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="body2" sx={{ fontWeight: 500, minWidth: '90px' }}>
                              💾 Size:
                            </Typography>
                            <Typography variant="body2" color="textSecondary">
                              {formatFileSize(performer.total_size_gb)}
                            </Typography>
                          </Box>
                          {performer.blacklisted === 1 && (
                            <Alert severity="error" sx={{ mt: 1 }}>
                              <Box>
                                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                  ⛔ Blacklisted on {formatDate(performer.blacklist_date)}
                                </Typography>
                                {performer.blacklist_reason && (
                                  <Typography variant="caption" display="block">
                                    Reason: {performer.blacklist_reason}
                                  </Typography>
                                )}
                              </Box>
                            </Alert>
                          )}
                        </Box>
                      </CardContent>
                    </Card>
                  </Grid>

                  {/* Content Library Card - Vertical Stack */}
                  <Grid item xs={12} sm={6} md={3}>
                    <Card variant="outlined" sx={{ height: '100%', borderLeft: '4px solid #8b5cf6' }}>
                      <CardContent>
                        <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, color: '#6d28d9', mb: 2 }}>
                          🎬 Content Library
                        </Typography>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          {/*🖼️ Pictures */}
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1.5, bgcolor: '#ede9fe', borderRadius: 1 }}>
                            <Typography variant="body2" sx={{ fontWeight: 600, color: '#6d28d9' }}>
                              🖼️ Pictures
                            </Typography>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Typography variant="h6" sx={{ fontWeight: 700, color: '#6d28d9' }}>
                                {performer.pics_count || 0}
                              </Typography>
                              {performer.pics_original_count > 0 && (
                                <Typography variant="caption" color="textSecondary">
                                  (Orig: {performer.pics_original_count})
                                </Typography>
                              )}
                            </Box>
                          </Box>
                          {/*🎥 Videos */}
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1.5, bgcolor: '#ddd6fe', borderRadius: 1 }}>
                            <Typography variant="body2" sx={{ fontWeight: 600, color: '#6d28d9' }}>
                              🎥 Videos
                            </Typography>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Typography variant="h6" sx={{ fontWeight: 700, color: '#6d28d9' }}>
                                {performer.vids_count || 0}
                              </Typography>
                              {performer.vids_original_count > 0 && (
                                <Typography variant="caption" color="textSecondary">
                                  (Orig: {performer.vids_original_count})
                                </Typography>
                              )}
                            </Box>
                          </Box>
                          {/*🎮 Funscripts */}
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1.5, bgcolor: '#c4b5fd', borderRadius: 1 }}>
                            <Typography variant="body2" sx={{ fontWeight: 600, color: '#6d28d9' }}>
                              🎮 Funscripts
                            </Typography>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Typography variant="h6" sx={{ fontWeight: 700, color: '#6d28d9' }}>
                                {performer.funscript_vids_count || 0}
                              </Typography>
                              {performer.funscript_vids_original_count > 0 && (
                                <Typography variant="caption" color="textSecondary">
                                  (Orig: {performer.funscript_vids_original_count})
                                </Typography>
                              )}
                            </Box>
                          </Box>
                          {/*📝 Total Funscript Files */}
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'center', mt: 0.5 }}>
                            <Typography variant="body2" sx={{ fontWeight: 500 }}>
                              📝 Total Funscript Files:
                            </Typography>
                            <Chip label={performer.funscript_files_count || 0} color="primary" size="small" />
                          </Box>
                          {performer.isEmpty && (
                            <Alert severity="warning" sx={{ mt: 1 }}>
                               This folder contains no media files
                            </Alert>
                          )}
                        </Box>
                      </CardContent>
                    </Card>
                  </Grid>

                  {/* Filtering Progress Card */}
                  {!performer.blacklisted && performer.filterStats && (
                    <Grid item xs={12} sm={6} md={3}>
                      <Card variant="outlined" sx={{ height: '100%', borderLeft: '4px solid #10b981' }}>
                        <CardContent>
                          <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, color: '#047857', mb: 2 }}>
                            🎚️ Filtering Progress
                          </Typography>
                          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <Box>
                              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                  🖼️ Pictures
                                </Typography>
                                <Chip
                                  label={`${performer.filteringProgress?.pics || 0}%`}
                                  size="small"
                                  color={(performer.filteringProgress?.pics || 0) === 100 ? 'success' : 'default'}
                                />
                              </Box>
                              <LinearProgress
                                variant="determinate"
                                value={performer.filteringProgress?.pics || 0}
                                color={(performer.filteringProgress?.pics || 0) === 100 ? 'success' : 'primary'}
                                sx={{ Height: 8, borderRadius: 1 }}
                              />
                            </Box>
                            <Box>
                              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                  🎥 Videos
                                </Typography>
                                <Chip
                                  label={`${performer.filteringProgress?.vids || 0}%`}
                                  size="small"
                                  color={(performer.filteringProgress?.vids || 0) === 100 ? 'success' : 'default'}
                                />
                              </Box>
                              <LinearProgress
                                variant="determinate"
                                value={performer.filteringProgress?.vids || 0}
                                color={(performer.filteringProgress?.vids || 0) === 100 ? 'success' : 'primary'}
                                sx={{ Height: 8, borderRadius: 1 }}
                              />
                            </Box>
                            <Box>
                              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                  🎮 Funscripts
                                </Typography>
                                <Chip
                                  label={`${performer.filteringProgress?.funscript || 0}%`}
                                  size="small"
                                  color={(performer.filteringProgress?.funscript || 0) === 100 ? 'success' : 'default'}
                                />
                              </Box>
                              <LinearProgress
                                variant="determinate"
                                value={performer.filteringProgress?.funscript || 0}
                                color={(performer.filteringProgress?.funscript || 0) === 100 ? 'success' : 'primary'}
                                sx={{ Height: 8, borderRadius: 1 }}
                              />
                            </Box>
                            <Box sx={{ mt: 1, p: 1.5, bgcolor: '#d1fae5', borderRadius: 1 }}>
                              <Typography variant="body2" sx={{ fontWeight: 500, color: '#047857' }}>
                                ✅ Filter Actions: {performer.filterStats.totalActions || 0}
                              </Typography>
                              <Box sx={{ display: 'flex', gap: 2, mt: 0.5 }}>
                                <Typography variant="caption" color="textSecondary">
                                  👍 Kept: {performer.filterStats.kept || 0}
                                </Typography>
                                <Typography variant="caption" color="textSecondary">
                                  🗑️ Deleted: {performer.filterStats.deleted || 0}
                                </Typography>
                              </Box>
                            </Box>
                          </Box>
                        </CardContent>
                      </Card>
                    </Grid>
                  )}

                  {/* Hash Database Card - Compact */}
                  {performer.hasHashDB && (
                    <Grid item xs={12} sm={6} md={3}>
                      <Card variant="outlined" sx={{ height: '100%', borderLeft: '4px solid #f59e0b' }}>
                        <CardContent>
                          <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, color: '#d97706', mb: 2 }}>
                            🔐 Hash Database
                          </Typography>
                          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1.5, bgcolor: '#fef3c7', borderRadius: 1 }}>
                              <Typography variant="body2" sx={{ fontWeight: 600, color: '#d97706' }}>
                                📊 Total Files
                              </Typography>
                              <Typography variant="h6" sx={{ fontWeight: 700, color: '#d97706' }}>
                                {performer.hashStats.fileCount}
                              </Typography>
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1.5, bgcolor: '#fde68a', borderRadius: 1 }}>
                              <Typography variant="body2" sx={{ fontWeight: 600, color: '#d97706' }}>
                                🗑️ Deleted
                              </Typography>
                              <Typography variant="h6" sx={{ fontWeight: 700, color: '#d97706' }}>
                                {performer.hashStats.deletedCount}
                              </Typography>
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'center', mt: 0.5 }}>
                              <Typography variant="caption" color="textSecondary">
                                🕐 Updated: {formatDate(performer.hashStats.lastUpdated)}
                              </Typography>
                            </Box>
                          </Box>
                        </CardContent>
                      </Card>
                    </Grid>
                  )}

                  {/* Row 2: Aliases - Full Width */}
                  {performer.aliases && performer.aliases.length > 0 && (
                    <Grid item xs={12}>
                      <Card variant="outlined" sx={{ borderLeft: '4px solid #06b6d4', width: '100%' }}>
                        <CardContent>
                          <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, color: '#0891b2', mb: 2 }}>
                            🏷️ Aliases
                          </Typography>
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                            {performer.aliases.map((alias, idx) => (
                              <Chip
                                key={idx}
                                label={alias}
                                size="small"
                                sx={{ fontWeight: 500 }}
                                variant="outlined"
                                color="info"
                              />
                            ))}
                          </Box>
                        </CardContent>
                      </Card>
                    </Grid>
                  )}

                  {/* Leakshaven Update Status Card */}
                  {(performer.leakshavenUpdate?.lastUpdateTime || performer.leakshavenUpdate?.error) && (
                    <Grid item xs={12} sm={6} md={3}>
                      <Card variant="outlined" sx={{ height: '100%', borderLeft: '4px solid #3b82f6' }}>
                        <CardContent>
                          <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, color: '#2563eb', mb: 2 }}>
                            🌐 Leakshaven Update
                          </Typography>
                          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                            {performer.leakshavenUpdate.lastUpdateTime ? (
                              <>
                                <Box
                                  component="a"
                                  href={`https://leakshaven.com/?q=${(performer.leakshavenUpdate.searchName || performer.name).replace(/\s+/g, '+')}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    p: 1.5,
                                    bgcolor: performer.leakshavenUpdate.acknowledged ? '#dbeafe' : '#fef2f2',
                                    borderRadius: 1,
                                    border: performer.leakshavenUpdate.acknowledged ? 'none' : '2px solid #ef4444',
                                    textDecoration: 'none',
                                    cursor: 'pointer',
                                    transition: 'opacity 0.2s',
                                    '&:hover': {
                                      opacity: 0.8
                                    }
                                  }}
                                >
                                  <Typography variant="body2" sx={{ fontWeight: 600, color: performer.leakshavenUpdate.acknowledged ? '#2563eb' : '#dc2626' }}>
                                    {performer.leakshavenUpdate.acknowledged ? '✅ Latest Update' : '🔔 New Update!'}
                                  </Typography>
                                  <Typography variant="h6" sx={{ fontWeight: 700, color: performer.leakshavenUpdate.acknowledged ? '#2563eb' : '#dc2626' }}>
                                    {performer.leakshavenUpdate.lastUpdateTime}
                                  </Typography>
                                </Box>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'center', mt: 0.5 }}>
                                  <Typography variant="caption" color="textSecondary">
                                    🕐 Checked: {performer.leakshavenUpdate.lastCheckDate ? new Date(performer.leakshavenUpdate.lastCheckDate).toLocaleString() : 'Never'}
                                  </Typography>
                                </Box>
                                {!performer.leakshavenUpdate.acknowledged && (
                                  <Button
                                    variant="contained"
                                    color="primary"
                                    size="small"
                                    startIcon={<CheckCircleIcon />}
                                    onClick={() => handleAcknowledgeUpdate(performer.id, performer.name)}
                                    fullWidth
                                  >
                                    Mark as Seen
                                  </Button>
                                )}
                              </>
                            ) : performer.leakshavenUpdate.error ? (
                              <Alert severity="error">
                                <Typography variant="body2">
                                  {performer.leakshavenUpdate.error}
                                </Typography>
                              </Alert>
                            ) : null}
                          </Box>
                        </CardContent>
                      </Card>
                    </Grid>
                  )}

                  {/* Row 3: Tags - Full Width */}
                  <Grid item xs={12}>
                    <Card variant="outlined" sx={{ borderLeft: '4px solid #a855f7', width: '100%' }}>
                      <CardContent>
                        <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, color: '#7e22ce', mb: 2 }}>
                          🏷️ Tags {(() => {
                            try {
                              const tags = performer.scraped_tags ? JSON.parse(performer.scraped_tags) : [];
                              return tags.length > 0 ? `(${tags.length})` : '';
                            } catch (e) {
                              return '';
                            }
                          })()}
                        </Typography>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                          {(() => {
                            try {
                              const tags = performer.scraped_tags ? JSON.parse(performer.scraped_tags) : [];
                              if (tags.length > 0) {
                                return tags.map((tag, idx) => (
                                  <Chip
                                    key={idx}
                                    label={tag}
                                    size="small"
                                    sx={{ fontWeight: 500 }}
                                    variant="outlined"
                                    color="secondary"
                                  />
                                ));
                              } else {
                                return (
                                  <Typography variant="body2" color="textSecondary">
                                    No tags associated with this performer
                                  </Typography>
                                );
                              }
                            } catch (e) {
                              return (
                                <Typography variant="body2" color="textSecondary">
                                  No tags associated with this performer
                                </Typography>
                              );
                            }
                          })()}
                        </Box>
                      </CardContent>
                    </Card>
                  </Grid>

                  {/* Row 4: Scraped Performer Data - Full Width */}
                  {performer.hasScrapedData && (
                    <Grid item xs={12}>
                      <Card variant="outlined" sx={{ borderLeft: '4px solid #ec4899', width: '100%' }}>
                        <CardContent>
                          <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, color: '#be185d', mb: 2 }}>
                            🔍 Scraped Performer Data
                          </Typography>
                          <Grid container spacing={2}>
                            {performer.age && (
                              <Grid item xs={6} sm={4} md={3}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                    🎂 Age:
                                  </Typography>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <Chip
                                      label={calculateCurrentAge(performer.age, performer.scraped_at)}
                                      size="small"
                                      color="secondary"
                                    />
                                    {performer.scraped_at && performer.age !== calculateCurrentAge(performer.age, performer.scraped_at) && (
                                      <Tooltip title={`Age ${performer.age} at scrape time (${formatDate(performer.scraped_at)})`}>
                                        <Typography variant="caption" color="textSecondary" sx={{ fontSize: '0.65rem' }}>
                                          (was {performer.age})
                                        </Typography>
                                      </Tooltip>
                                    )}
                                  </Box>
                                </Box>
                              </Grid>
                            )}
                            {performer.born && (
                              <Grid item xs={6} sm={4} md={3}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                    📅 Born:
                                  </Typography>
                                  <Typography variant="body2" color="textSecondary">
                                    {performer.born}
                                  </Typography>
                                </Box>
                              </Grid>
                            )}
                            {performer.birthplace && (
                              <Grid item xs={6} sm={4} md={3}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                    🌍 Birthplace:
                                  </Typography>
                                  <Typography variant="body2" color="textSecondary">
                                    {performer.birthplace}
                                  </Typography>
                                </Box>
                              </Grid>
                            )}
                            {performer.height && (
                              <Grid item xs={6} sm={4} md={3}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                    📏 Height:
                                  </Typography>
                                  <Typography variant="body2" color="textSecondary">
                                    {performer.height}
                                  </Typography>
                                </Box>
                              </Grid>
                            )}
                            {performer.weight && (
                              <Grid item xs={6} sm={4} md={3}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                    ⚖️ Weight:
                                  </Typography>
                                  <Typography variant="body2" color="textSecondary">
                                    {performer.weight}
                                  </Typography>
                                </Box>
                              </Grid>
                            )}
                            {(performer.measurements_cup || performer.measurements_band_size) && (
                              <Grid item xs={6} sm={4} md={3}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                    📐 Measurements:
                                  </Typography>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <Typography variant="body2" color="textSecondary">
                                      {performer.measurements_band_size || '?'}{performer.measurements_cup || '?'}
                                    </Typography>
                                    {performer.measurements_fake !== null && performer.measurements_fake !== undefined && (
                                      <Chip
                                        label={performer.measurements_fake === 1 ? 'Fake' : 'Natural'}
                                        size="small"
                                        color={performer.measurements_fake === 1 ? 'warning' : 'success'}
                                        sx={{ height: 20, fontSize: '0.65rem' }}
                                      />
                                    )}
                                  </Box>
                                </Box>
                              </Grid>
                            )}
                            {performer.ethnicity && (
                              <Grid item xs={6} sm={4} md={3}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                    🌐 Ethnicity:
                                  </Typography>
                                  <Typography variant="body2" color="textSecondary">
                                    {performer.ethnicity}
                                  </Typography>
                                </Box>
                              </Grid>
                            )}
                            {performer.hair_color && (
                              <Grid item xs={6} sm={4} md={3}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                    💇 Hair:
                                  </Typography>
                                  <Typography variant="body2" color="textSecondary">
                                    {performer.hair_color}
                                  </Typography>
                                </Box>
                              </Grid>
                            )}
                            {performer.eye_color && (
                              <Grid item xs={6} sm={4} md={3}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                    👁️ Eyes:
                                  </Typography>
                                  <Typography variant="body2" color="textSecondary">
                                    {performer.eye_color}
                                  </Typography>
                                </Box>
                              </Grid>
                            )}
                            {performer.body_type && (
                              <Grid item xs={6} sm={4} md={3}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                    💪 Body:
                                  </Typography>
                                  <Typography variant="body2" color="textSecondary">
                                    {performer.body_type}
                                  </Typography>
                                </Box>
                              </Grid>
                            )}
                          </Grid>
                        </CardContent>
                      </Card>
                    </Grid>
                  )}
                </Grid>
              </Box>
            </Collapse>
          </TableCell>
        </TableRow>
      </React.Fragment>
    );
  };

  if (loading) {
    return (
      <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
          <CircularProgress />
        </Box>
      </Container>
    );
  }

  const { performerList, duplicateGroups } = getCurrentTabPerformers();

  // Count unacknowledged updates
  const unacknowledgedCount = performers.filter(p =>
    p.leakshavenUpdate?.lastUpdateTime && !p.leakshavenUpdate?.acknowledged
  ).length;

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h4" gutterBottom>
        Performer Management
      </Typography>

      {/* Summary Cards */}
      {summary && (
        <Box sx={{ mb: 3 }}>
          <Grid container spacing={2}>
            {/* First row - main stats */}
            <Grid item xs={6} sm={4} md={2}>
              <Card sx={{ Height: '100%' }}>
                <CardContent sx={{ textAlign: 'center' }}>
                  <Typography color="textSecondary" variant="caption" gutterBottom display="block">
                    Total Performers
                  </Typography>
                  <Typography variant="h4">{summary.total}</Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={6} sm={4} md={2}>
              <Card sx={{ Height: '100%' }}>
                <CardContent sx={{ textAlign: 'center' }}>
                  <Typography color="textSecondary" variant="caption" gutterBottom display="block">
                    Before Filter
                  </Typography>
                  <Typography variant="h4" color="warning.main">{summary.before}</Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={6} sm={4} md={2}>
              <Card sx={{ Height: '100%' }}>
                <CardContent sx={{ textAlign: 'center' }}>
                  <Typography color="textSecondary" variant="caption" gutterBottom display="block">
                    After Filter
                  </Typography>
                  <Typography variant="h4" color="success.main">{summary.after}</Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={6} sm={4} md={2}>
              <Card sx={{ Height: '100%' }}>
                <CardContent sx={{ textAlign: 'center' }}>
                  <Typography color="textSecondary" variant="caption" gutterBottom display="block">
                    Missing/Empty
                  </Typography>
                  <Typography variant="h4" color="error.main">{summary.missingOrEmpty}</Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={6} sm={4} md={2}>
              <Card sx={{ Height: '100%' }}>
                <CardContent sx={{ textAlign: 'center' }}>
                  <Typography color="textSecondary" variant="caption" gutterBottom display="block">
                    Blacklisted
                  </Typography>
                  <Typography variant="h4">{summary.blacklisted}</Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={6} sm={4} md={2}>
              <Card sx={{ Height: '100%' }}>
                <CardContent sx={{ textAlign: 'center', py: 1.5 }}>
                  <Button
                    variant="contained"
                    startIcon={<RefreshIcon />}
                    onClick={loadPerformers}
                    size="medium"
                    fullWidth
                  >
                    Reload All
                  </Button>
                </CardContent>
              </Card>
            </Grid>

            {/* Check for Content Updates Button */}
            <Grid item xs={12} sm={6} md={6}>
              <Card sx={{ Height: '100%' }}>
                <CardContent sx={{ textAlign: 'center', py: 1.5 }}>
                  <Badge badgeContent={unacknowledgedCount} color="error" max={99}>
                    <Button
                      variant="contained"
                      color="secondary"
                      startIcon={checkingUpdates ? <CircularProgress size={20} color="inherit" /> : unacknowledgedCount > 0 ? <NotificationsActiveIcon /> : <UpdateIcon />}
                      onClick={handleCheckUpdates}
                      size="medium"
                      fullWidth
                      disabled={checkingUpdates}
                    >
                      {checkingUpdates ? 'Checking for Updates...' : 'Check for Content Updates'}
                    </Button>
                  </Badge>
                  {updateCheckResults && (
                    <Typography variant="caption" display="block" sx={{ mt: 1 }}>
                      Checked: {updateCheckResults.checked} | New: {updateCheckResults.newUpdates} | Errors: {updateCheckResults.errors}
                    </Typography>
                  )}
                </CardContent>
              </Card>
            </Grid>

            {/* Second row - secondary stats */}
            <Grid item xs={6} sm={6} md={6}>
              <Card sx={{ Height: '100%' }}>
                <CardContent sx={{ textAlign: 'center' }}>
                  <Typography color="textSecondary" variant="caption" gutterBottom display="block">
                    With Hash DB
                  </Typography>
                  <Typography variant="h5">{summary.withHashDB}</Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={6} sm={6} md={6}>
              <Card sx={{ Height: '100%' }}>
                <CardContent sx={{ textAlign: 'center' }}>
                  <Typography color="textSecondary" variant="caption" gutterBottom display="block">
                    Scraped
                  </Typography>
                  <Typography variant="h5">{summary.scraped}</Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </Box>
      )}

      {/* Search and Tabs */}
      <Paper sx={{ mb: 2 }}>
        <Box p={2}>
          <TextField
            fullWidth
            variant="outlined"
            placeholder="Search performers by name or alias..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              )
            }}
          />
        </Box>
        <Tabs value={currentTab} onChange={(e, newValue) => setCurrentTab(newValue)}>
          <Tab label={`All (${performers?.length || 0})`} />
          <Tab label={`Before Filter (${grouped.before?.length || 0})`} />
          <Tab label={`After Filter (${grouped.after?.length || 0})`} />
          <Tab label={`Missing/Empty (${grouped['missing-or-empty']?.length || 0})`} />
          <Tab label={`Blacklisted (${grouped.blacklisted?.length || 0})`} />
        </Tabs>
      </Paper>

      {/* Performers Table */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Location</TableCell>
              <TableCell align="center">Folder</TableCell>
              <TableCell
                align="center"
                onClick={() => handleSort('hashdb')}
                sx={{ cursor: 'pointer', userSelect: 'none', '&:hover': { backgroundColor: 'action.hover' } }}
              >
                <Box display="flex" alignItems="center" justifyContent="center">
                  Hash DB
                  {getSortIcon('hashdb')}
                </Box>
              </TableCell>
              <TableCell
                align="center"
                onClick={() => handleSort('scraped')}
                sx={{ cursor: 'pointer', userSelect: 'none', '&:hover': { backgroundColor: 'action.hover' } }}
              >
                <Box display="flex" alignItems="center" justifyContent="center">
                  Scraped
                  {getSortIcon('scraped')}
                </Box>
              </TableCell>
              <TableCell
                onClick={() => handleSort('content')}
                sx={{ cursor: 'pointer', userSelect: 'none', '&:hover': { backgroundColor: 'action.hover' } }}
              >
                <Box display="flex" alignItems="center">
                  Content (P/V/F)
                  {getSortIcon('content')}
                </Box>
              </TableCell>
              <TableCell
                onClick={() => handleSort('size')}
                sx={{ cursor: 'pointer', userSelect: 'none', '&:hover': { backgroundColor: 'action.hover' } }}
              >
                <Box display="flex" alignItems="center">
                  Size
                  {getSortIcon('size')}
                </Box>
              </TableCell>
              <TableCell
                align="center"
                onClick={() => handleSort('leakshaven')}
                sx={{ cursor: 'pointer', userSelect: 'none', '&:hover': { backgroundColor: 'action.hover' } }}
              >
                <Box display="flex" alignItems="center" justifyContent="center">
                  Leakshaven Update
                  {getSortIcon('leakshaven')}
                </Box>
              </TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {performerList.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} align="center">
                  <Typography color="textSecondary">No performers found</Typography>
                </TableCell>
              </TableRow>
            ) : (
              <>
                {/* Render duplicate groups first */}
                {Object.entries(duplicateGroups).map(([key, performers]) =>
                  renderDuplicateGroup(performers)
                )}

                {/* Render non-duplicate performers */}
                {performerList
                  .filter(p => !p.hasDuplicates)
                  .map(performer => renderPerformerRow(performer))
                }
              </>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Delete/Action Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => !processing && setDeleteDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {selectedPerformer?.blacklisted === 1 ? 'Manage Blacklisted Performer' : 'Delete or Manage Performer'}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            What would you like to do with <strong>{selectedPerformer?.name}</strong>?
          </DialogContentText>

          <RadioGroup
            value={selectedDeleteOption}
            onChange={(e) => setSelectedDeleteOption(e.target.value)}
            sx={{ mt: 2 }}
          >
            {deleteOptions.map(option => (
              <FormControlLabel
                key={option}
                value={option}
                control={<Radio />}
                label={getDeleteOptionLabel(option)}
              />
            ))}
          </RadioGroup>

          {selectedDeleteOption && (
            <Alert severity={selectedDeleteOption === 'delete-complete' ? 'error' : 'info'} sx={{ mt: 2 }}>
              {getDeleteOptionDescription(selectedDeleteOption)}
            </Alert>
          )}

          {selectedDeleteOption === 'blacklist' && (
            <TextField
              label="Reason (optional)"
              multiline
              rows={3}
              fullWidth
              value={blacklistReason}
              onChange={(e) => setBlacklistReason(e.target.value)}
              sx={{ mt: 2 }}
              placeholder="e.g., Low quality content, unwanted performer, etc."
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} disabled={processing}>
            Cancel
          </Button>
          <Button
            onClick={handleDeleteConfirm}
            color={selectedDeleteOption === 'delete-complete' ? 'error' : 'primary'}
            variant="contained"
            disabled={processing || !selectedDeleteOption}
            startIcon={processing ? <CircularProgress size={20} /> : null}
          >
            {processing ? 'Processing...' : 'Confirm'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog
        open={renameDialogOpen}
        onClose={() => !processing && setRenameDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Rename Performer
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            Rename <strong>{renamePerformer?.name}</strong> to a new name.
          </DialogContentText>

          <TextField
            autoFocus
            margin="dense"
            label="New Performer Name"
            fullWidth
            variant="outlined"
            value={newPerformerName}
            onChange={(e) => setNewPerformerName(e.target.value)}
            sx={{ mt: 2 }}
          />

          <FormControlLabel
            control={
              <Radio
                checked={renameFolderToo}
                onChange={(e) => setRenameFolderToo(e.target.checked)}
              />
            }
            label="Also rename performer folders on disk"
            sx={{ mt: 2 }}
          />

          <Alert severity="info" sx={{ mt: 2 }}>
            {renameFolderToo
              ? 'This will rename both the database entry and the physical folders on disk.'
              : 'This will only rename the database entry. Physical folders will keep their current names.'}
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameDialogOpen(false)} disabled={processing}>
            Cancel
          </Button>
          <Button
            onClick={handleRenameConfirm}
            variant="contained"
            disabled={processing || !newPerformerName.trim() || newPerformerName.trim() === renamePerformer?.name}
            startIcon={processing ? <CircularProgress size={20} /> : null}
          >
            {processing ? 'Renaming...' : 'Rename'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}

export default PerformerManagementPage;



