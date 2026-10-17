import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Container,
  Typography,
  Box,
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
  Badge,
  Select,
  FormControl,
  InputLabel,
  Autocomplete,
  Avatar,
  Link
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
  Notifications as NotificationsIcon,
  NotificationsActive as NotificationsActiveIcon,
  Edit as EditIcon,
  ViewModule as ViewModuleIcon,
  ViewList as ViewListIcon,
  Link as LinkIcon,
  LinkOff as LinkOffIcon,
  FiberNew as FiberNewIcon,
  ErrorOutline as ErrorOutlineIcon,
  Schedule as ScheduleIcon,
  CloudQueue as CloudQueueIcon,
  OpenInNew as OpenInNewIcon
} from '@mui/icons-material';
import { offlineStorage } from '../services/OfflineStorage';
import { socketService } from '../services/SocketService';
import ScrapeDialog from '../components/ScrapeDialog';
import {
  PageShell, PageHeader, Panel, LoadingState, StatRow, EmptyState,
  Toolbar as LayoutToolbar, ICON, iconBtnSx
} from '../components/layout';

const VIEW_KEY = 'performerMgmtView_v1';

/**
 * URL for a performer's cover image.
 *
 * `performers.thumbnail` is a FILE PATH, not a URL — the rename handler in
 * backend/routes/performer-management.js rewrites it with string replacement on
 * the folder name, which only makes sense for a path. There is no
 * GET /api/performers/:id/thumbnail; that route is POST-only, so the merge
 * dialog's avatars had been silently 404ing and falling back to initials.
 * Images are served by the files route.
 */
const thumbUrl = (performer) =>
  (performer?.thumbnail ? `/api/files/preview?path=${encodeURIComponent(performer.thumbnail)}` : undefined);

/* Location was a MUI Chip with a palette colour name, which can't be reused
   outside sx. As a var() it works in both. */
const LOCATION_TONE = {
  before: 'var(--warn)',
  after: 'var(--ok)',
  'missing-or-empty': 'var(--bad)',
  blacklisted: 'var(--muted)'
};

/** Small outlined label — location, blacklisted, update. */
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

/** A count on a card. Bold number, quiet unit. */
const metaSx = {
  fontSize: '0.72rem',
  color: 'var(--dim)',
  fontVariantNumeric: 'tabular-nums',
  '& b': { color: 'var(--text)', fontWeight: 600 }
};

/** Present/absent flag — a dot plus its name, instead of a coloured icon whose
 *  meaning you had to hover to learn. */
const dotSx = (tone) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  fontSize: '0.68rem',
  color: 'var(--muted)',
  '&::before': {
    content: '""',
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: tone,
    flexShrink: 0
  }
});

/** An inline state flag with an icon and a word, clickable. */
const flagSx = (tone, strong = false) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '3px',
  fontSize: '0.68rem',
  fontWeight: strong ? 650 : 400,
  color: tone,
  bgcolor: strong ? 'var(--bad-quiet)' : 'transparent',
  borderRadius: 'var(--radius-sm, 4px)',
  px: '4px',
  ml: '-4px',
  cursor: 'pointer',
  textDecoration: 'none',
  '& svg': { fontSize: ICON.inline },
  '&:hover': { bgcolor: strong ? 'var(--bad-quiet)' : 'var(--raised)' }
});

/** "3 days ago" for an ISO date. */
function timeAgo(iso) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} month${days < 60 ? '' : 's'} ago`;
  return `${Math.floor(days / 365)} year${days < 730 ? '' : 's'} ago`;
}

/** Where a performer stands on Leakhaven: none | unchecked | failed | new | current */
function leakhavenState(performer) {
  const upd = performer.leakshavenUpdate || {};
  if (!upd.url) return 'none';
  if (upd.error) return 'failed';
  if (!upd.lastCheckDate) return 'unchecked';
  return upd.newestUpload && !upd.acknowledged ? 'new' : 'current';
}

const tabChipSx = (active) => ({
  height: 24,
  fontSize: '0.7rem',
  fontWeight: active ? 650 : 550,
  cursor: 'pointer',
  bgcolor: active ? 'var(--accent)' : 'var(--bg)',
  color: active ? 'var(--on-accent)' : 'var(--dim)',
  border: '1px solid',
  borderColor: active ? 'var(--accent)' : 'var(--line)',
  '&:hover': { bgcolor: active ? 'var(--accent-hover)' : 'var(--raised)' }
});

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
  // Cards is the default; the table is still there for sorting by size or
  // hash count, which rows deliberately don't do.
  const [viewMode, setViewMode] = useState(() => localStorage.getItem(VIEW_KEY) || 'cards');
  useEffect(() => { localStorage.setItem(VIEW_KEY, viewMode); }, [viewMode]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedPerformer, setSelectedPerformer] = useState(null);
  const [deleteOptions, setDeleteOptions] = useState([]);
  const [selectedDeleteOption, setSelectedDeleteOption] = useState('');
  const [blacklistReason, setBlacklistReason] = useState('');
  const [processing, setProcessing] = useState(false);
  const [expandedPerformer, setExpandedPerformer] = useState(null);
  const [expandedGroup, setExpandedGroup] = useState(null);
  const [sortConfig, setSortConfig] = useState([]); // Array of {field, direction} for multi-level sorting
  // { done, total, newCount, errors } while Check updates runs, then its result
  const [checkProgress, setCheckProgress] = useState(null);
  const stopCheckRef = useRef(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renamePerformer, setRenamePerformer] = useState(null);
  const [newPerformerName, setNewPerformerName] = useState('');
  const [renameFolderToo, setRenameFolderToo] = useState(true);
  const [scrapeTarget, setScrapeTarget] = useState(null);
  const [newOnly, setNewOnly] = useState(false);
  const [noLinkOnly, setNoLinkOnly] = useState(false);
  const [aliasInputs, setAliasInputs] = useState({});
  const [linkInputs, setLinkInputs] = useState({}); // performer id → link being typed; present while editing
  const [linkBusy, setLinkBusy] = useState(null);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [mergeSource, setMergeSource] = useState(null);
  const [mergeTarget, setMergeTarget] = useState(null);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // ?performer=<id>, from the settings modal's "Open in Performer Management"
  const focusId = parseInt(searchParams.get('performer'), 10) || null;

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

  // Opened for one performer: show it expanded and scrolled into view, once
  const focusedRef = useRef(false);
  useEffect(() => {
    const target = focusId && !loading && performers.find(p => p.id === focusId);
    if (!target || focusedRef.current) return;
    focusedRef.current = true;
    setCurrentTab(0);
    setSearchTerm('');
    setExpandedGroup(target.name);
    setExpandedPerformer(focusId);
    setTimeout(() => document.getElementById(`performer-${focusId}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 150);
  }, [focusId, loading, performers]);

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

  const checkOne = (performerId) =>
    fetch(`/api/performer-management/${performerId}/check-update`, { method: 'POST' })
      .then(res => res.json())
      .catch(err => ({ success: false, error: err.message }));

  // One request per linked performer, so the button can show progress and stop
  const handleCheckUpdates = async () => {
    if (checkProgress && checkProgress.done < checkProgress.total) {
      stopCheckRef.current = true;
      return;
    }
    const linked = performers.filter(p => p.leakshavenUpdate?.url && p.blacklisted !== 1);
    stopCheckRef.current = false;
    const progress = { done: 0, total: linked.length, newCount: 0, errors: 0 };
    setCheckProgress({ ...progress });
    for (const performer of linked) {
      if (stopCheckRef.current) break;
      const data = await checkOne(performer.id);
      progress.done++;
      if (data.isNew) progress.newCount++;
      if (!data.success) progress.errors++;
      setCheckProgress({ ...progress });
    }
    setCheckProgress({ ...progress, total: progress.done });
    await loadPerformers();
  };

  const handleCheckOne = async (performer) => {
    setLinkBusy(performer.id);
    await checkOne(performer.id);
    setLinkBusy(null);
    await loadPerformers();
  };

  const handleSaveAliases = async (performer, aliases) => {
    try {
      const response = await fetch(`/api/performers/${performer.id}/aliases`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aliases })
      });
      if (!response.ok) throw new Error((await response.json()).error);
      setPerformers(prev => prev.map(p => (p.id === performer.id ? { ...p, aliases } : p)));
    } catch (error) {
      alert('Failed to save aliases: ' + error.message);
    }
  };

  const handleAddAlias = (performer) => {
    const alias = (aliasInputs[performer.id] || '').trim();
    if (!alias) return;
    if (!performer.aliases.some(a => a.toLowerCase() === alias.toLowerCase())) {
      handleSaveAliases(performer, [...performer.aliases, alias]);
    }
    setAliasInputs(prev => ({ ...prev, [performer.id]: '' }));
  };

  // An empty link removes it
  const handleSaveLink = async (performer, link) => {
    setLinkBusy(performer.id);
    try {
      const response = await fetch(`/api/performer-management/${performer.id}/leakhaven-link`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link })
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error);
      setLinkInputs(prev => {
        const next = { ...prev };
        delete next[performer.id];
        return next;
      });
      await loadPerformers();
    } catch (error) {
      alert(error.message);
    } finally {
      setLinkBusy(null);
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

  const handleMergeClick = (performer) => {
    setMergeSource(performer);
    setMergeTarget(null);
    setMergeDialogOpen(true);
  };

  const handleMergeConfirm = async () => {
    if (!mergeSource || !mergeTarget) return;
    setProcessing(true);
    try {
      const response = await fetch('/api/performers/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId: mergeSource.id, targetId: mergeTarget.id })
      });
      const data = await response.json();
      if (data.success) {
        alert(`Successfully merged "${mergeSource.name}" into "${mergeTarget.name}"`);
        setMergeDialogOpen(false);
        await loadPerformers();
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (error) {
      console.error('Error merging performers:', error);
      alert('Failed to merge performers');
    } finally {
      setProcessing(false);
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

  const handleScrape = (performer) => setScrapeTarget(performer);

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

          case 'leakshaven': {
            // New first, then linked by newest upload, then unlinked
            const rank = { new: 3, current: 2, failed: 1, unchecked: 1, none: 0 };
            compareResult = rank[leakhavenState(b)] - rank[leakhavenState(a)];
            if (compareResult === 0) {
              compareResult = (b.leakshavenUpdate?.newestUpload || '').localeCompare(a.leakshavenUpdate?.newestUpload || '');
            }
            break;
          }

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
    if (newOnly) performerList = performerList.filter(p => leakhavenState(p) === 'new');
    if (noLinkOnly) performerList = performerList.filter(p => leakhavenState(p) === 'none');

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

  const sourceName = (id) => (id === 'leakhaven' ? 'Leakhaven' : id);

  /** Inline Leakhaven state: no link opens the Scrape modal, every other state opens the linked page. */
  const renderLeakhavenFlag = (performer) => {
    const upd = performer.leakshavenUpdate || {};
    const state = leakhavenState(performer);
    if (state === 'none') {
      return (
        <Tooltip title="No Leakhaven page linked. Click to scrape">
          <Box component="span" sx={flagSx('var(--muted)')} onClick={() => handleScrape(performer)}>
            <LinkOffIcon />no link
          </Box>
        </Tooltip>
      );
    }
    const [Icon, tone, label, tip] = {
      new: [FiberNewIcon, 'var(--bad)', `new · ${timeAgo(upd.newestUpload)}`,
        `New upload ${new Date(upd.newestUpload).toLocaleDateString()}. Click to open the Leakhaven page`],
      current: [LinkIcon, 'var(--dim)', upd.newestUpload ? timeAgo(upd.newestUpload) : 'no uploads',
        `Up to date${upd.newestUpload ? `, newest upload ${new Date(upd.newestUpload).toLocaleDateString()}` : ''}. Click to open the Leakhaven page`],
      unchecked: [ScheduleIcon, 'var(--muted)', 'not checked', 'Linked, never checked for updates. Click to open the Leakhaven page'],
      failed: [ErrorOutlineIcon, 'var(--warn)', 'check failed', `Last check failed: ${upd.error}`]
    }[state];
    return (
      <Tooltip title={tip}>
        <Link href={upd.url} target="_blank" rel="noopener noreferrer" underline="none" sx={flagSx(tone, state === 'new')}>
          <Icon />{label}
        </Link>
      </Tooltip>
    );
  };

  const renderScrapeFlag = (performer) => (
    <Tooltip title={performer.hasScrapedData
      ? `Scraped ${formatDate(performer.scrapedAt)}${performer.scraped_source ? ` from ${sourceName(performer.scraped_source)}` : ''}. Click to scrape again`
      : 'Not scraped. Click to scrape'}>
      <Box component="span" sx={flagSx(performer.hasScrapedData ? 'var(--ok)' : 'var(--muted)')} onClick={() => handleScrape(performer)}>
        {performer.hasScrapedData ? <CloudDoneIcon /> : <CloudQueueIcon />}
        {performer.hasScrapedData ? 'scraped' : 'not scraped'}
      </Box>
    </Tooltip>
  );

  const detailCardSx = (tone) => ({
    height: '100%', bgcolor: 'var(--surface)', border: '1px solid var(--line)', borderLeftWidth: '4px', borderLeftColor: tone
  });

  const renderLeakhavenCard = (performer) => {
    const upd = performer.leakshavenUpdate || {};
    const editing = linkInputs[performer.id] !== undefined;
    const busy = linkBusy === performer.id;
    const typed = linkInputs[performer.id] || '';

    if (!upd.url || editing) {
      return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Typography variant="body2" sx={{ color: 'var(--dim)' }}>
            {upd.url ? 'Paste the new link or model name.' : 'No Leakhaven page linked. Paste a leakshaven.com/model/… link or a model name, or use Scrape.'}
          </Typography>
          <TextField size="small" value={typed} placeholder="leakshaven.com/model/…" className="dp-textfield"
            onChange={(e) => setLinkInputs(prev => ({ ...prev, [performer.id]: e.target.value }))}
            onKeyDown={(e) => { if (e.key === 'Enter' && typed.trim()) handleSaveLink(performer, typed); }} />
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button size="small" variant="contained" disabled={busy || !typed.trim()} onClick={() => handleSaveLink(performer, typed)}
              startIcon={busy ? <CircularProgress size={14} color="inherit" /> : null}>
              Save link
            </Button>
            {editing && (
              <Button size="small" sx={{ color: 'var(--dim)' }} onClick={() => setLinkInputs(prev => {
                const next = { ...prev };
                delete next[performer.id];
                return next;
              })}>
                Cancel
              </Button>
            )}
            {upd.url && <Button size="small" color="error" disabled={busy} onClick={() => handleSaveLink(performer, '')}>Remove link</Button>}
          </Box>
        </Box>
      );
    }

    const isNew = leakhavenState(performer) === 'new';
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Link href={upd.url} target="_blank" rel="noopener noreferrer" underline="hover"
          sx={{ color: 'var(--accent)', fontSize: '0.875rem', wordBreak: 'break-word' }}>
          {decodeURIComponent(upd.url.replace(/^https?:\/\//, ''))} <OpenInNewIcon sx={{ fontSize: 14, verticalAlign: '-2px' }} />
        </Link>
        <Typography variant="body2" sx={{ color: isNew ? 'var(--bad)' : 'var(--dim)', fontWeight: isNew ? 650 : 400 }}>
          Newest upload: {upd.newestUpload
            ? `${new Date(upd.newestUpload).toLocaleDateString()} · ${timeAgo(upd.newestUpload)}${isNew ? ' · new' : ''}`
            : upd.lastCheckDate ? 'none listed' : 'not checked yet'}
        </Typography>
        <Typography variant="caption" sx={{ color: 'var(--muted)' }}>
          Last checked: {upd.lastCheckDate ? new Date(upd.lastCheckDate).toLocaleString() : 'never'}
        </Typography>
        {upd.error && <Alert severity="warning" sx={{ py: 0 }}>{upd.error}</Alert>}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 0.5 }}>
          {isNew && (
            <Button size="small" variant="contained" startIcon={<CheckCircleIcon />} onClick={() => handleAcknowledgeUpdate(performer.id, performer.name)}>
              Mark seen
            </Button>
          )}
          <Button size="small" variant="outlined" disabled={busy} onClick={() => handleCheckOne(performer)}
            startIcon={busy ? <CircularProgress size={14} /> : <RefreshIcon />}>
            Check now
          </Button>
          <Button size="small" variant="outlined" startIcon={<EditIcon />}
            onClick={() => setLinkInputs(prev => ({ ...prev, [performer.id]: '' }))}>
            Change link
          </Button>
        </Box>
      </Box>
    );
  };

  // Profile columns a scrape can fill, with the word the Profile card uses for an empty one
  const PROFILE_FIELDS = {
    born: 'born', birthplace: 'birthplace', height: 'height', weight: 'weight', measurements: 'measurements',
    measurements_cup: 'cup', hair_color: 'hair', eye_color: 'eyes', ethnicity: 'ethnicity', body_type: 'body',
    orientation: 'orientation', pubic_hair: 'pubic hair', tattoos: 'tattoos', piercings: 'piercings'
  };

  const renderProfileCard = (performer) => {
    const empty = Object.keys(PROFILE_FIELDS).filter(f => !performer[f]);
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography variant="body2" sx={{ color: 'var(--dim)' }}>
          Scraped: {performer.hasScrapedData
            ? `${formatDate(performer.scraped_at)}${performer.scraped_source ? ` from ${sourceName(performer.scraped_source)}` : ''}`
            : 'not yet'}
        </Typography>
        <Typography variant="body2" sx={{ color: 'var(--dim)' }}>
          {Object.keys(PROFILE_FIELDS).length - empty.length} fields filled
          {empty.length > 0 && ` · empty: ${empty.map(f => PROFILE_FIELDS[f]).join(', ')}`}
        </Typography>
        <Box>
          <Button size="small" variant="contained" startIcon={<SearchIcon />} onClick={() => handleScrape(performer)}>
            Scrape…
          </Button>
        </Box>
      </Box>
    );
  };

  const renderAliasesCard = (performer) => (
    <>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
        {performer.aliases.map(alias => (
          <Chip key={alias} label={alias} size="small" variant="outlined" color="info"
            onDelete={() => handleSaveAliases(performer, performer.aliases.filter(a => a !== alias))} />
        ))}
        {performer.aliases.length === 0 && (
          <Typography variant="body2" sx={{ color: 'var(--muted)' }}>No aliases yet</Typography>
        )}
      </Box>
      <TextField size="small" fullWidth placeholder="Add alias, Enter to save" className="dp-textfield"
        value={aliasInputs[performer.id] || ''}
        onChange={(e) => setAliasInputs(prev => ({ ...prev, [performer.id]: e.target.value }))}
        onKeyDown={(e) => { if (e.key === 'Enter') handleAddAlias(performer); }} />
    </>
  );

  /**
   * The expanded performer detail.
   *
   * Extracted from inside the table row so the card view can show the same
   * panel. It was 600 lines nested in a <TableCell colSpan={9}>, which meant
   * the detail could only ever exist inside a table.
   */
  const renderPerformerDetail = (performer) => (
    <Grid container spacing={2.5} sx={{ width: '100%' }}>
      {/* Leakhaven, profile and aliases first: what a performer is usually opened for. A CSS grid,
          because MUI 7's Grid ignores the item/md props the cards below still pass. */}
      <Box sx={{ width: '100%', display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 2.5 }}>
        {[
          ['Leakhaven', 'var(--info)', renderLeakhavenCard],
          ['Profile', 'var(--accent)', renderProfileCard],
          ['Aliases', 'var(--info)', renderAliasesCard]
        ].map(([title, tone, render]) => (
          <Card key={title} variant="outlined" sx={detailCardSx(tone)}>
            <CardContent>
              <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, color: tone, mb: 1.5 }}>{title}</Typography>
              {render(performer)}
            </CardContent>
          </Card>
        ))}
      </Box>

      {/* Row 1: 4 equal-height cards taking full width */}
      {/* Basic Information Card - No path, no aliases */}
      <Grid item xs={12} sm={6} md={3}>
        <Card variant="outlined" sx={{ height: '100%', borderLeft: '4px solid var(--info)', bgcolor: 'var(--surface)', border: '1px solid var(--line)', borderLeftWidth: '4px', borderLeftColor: 'var(--info)' }}>
          <CardContent>
            <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, color: 'var(--info)', mb: 2 }}>
              Basic Information
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 500, minWidth: '90px' }}>
                  ID:
                </Typography>
                <Typography variant="body2" sx={{ color: 'var(--dim)' }}>
                  {performer.id}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 500, minWidth: '90px' }}>
                  Imported:
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  {formatDate(performer.import_date)}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 500, minWidth: '90px' }}>
                  Last Scan:
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  {formatDate(performer.last_scan_date)}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 500, minWidth: '90px' }}>
                  Size:
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  {formatFileSize(performer.total_size_gb)}
                </Typography>
              </Box>
              {performer.blacklisted === 1 && (
                <Alert severity="error" sx={{ mt: 1 }}>
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      Blacklisted on {formatDate(performer.blacklist_date)}
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
        <Card variant="outlined" sx={{ height: '100%', bgcolor: 'var(--surface)', border: '1px solid var(--line)', borderLeftWidth: '4px', borderLeftColor: 'var(--accent)' }}>
          <CardContent>
            <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, color: 'var(--accent)', mb: 2 }}>
              Content Library
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {/* Pictures */}
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 2, bgcolor: 'var(--accent-quiet)', borderRadius: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, color: 'var(--accent)' }}>
                  Pictures
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="h6" sx={{ fontWeight: 700, color: 'var(--accent)' }}>
                    {performer.pics_count || 0}
                  </Typography>
                  {performer.pics_original_count > 0 && (
                    <Typography variant="caption" color="textSecondary">
                      (Orig: {performer.pics_original_count})
                    </Typography>
                  )}
                </Box>
              </Box>
              {/* Videos */}
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 2, bgcolor: 'var(--accent-quiet)', borderRadius: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, color: 'var(--accent)' }}>
                  Videos
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="h6" sx={{ fontWeight: 700, color: 'var(--accent)' }}>
                    {performer.vids_count || 0}
                  </Typography>
                  {performer.vids_original_count > 0 && (
                    <Typography variant="caption" color="textSecondary">
                      (Orig: {performer.vids_original_count})
                    </Typography>
                  )}
                </Box>
              </Box>
              {/* Funscripts */}
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 2, bgcolor: 'var(--accent-quiet)', borderRadius: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, color: 'var(--accent)' }}>
                  Funscripts
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="h6" sx={{ fontWeight: 700, color: 'var(--accent)' }}>
                    {performer.funscript_vids_count || 0}
                  </Typography>
                  {performer.funscript_vids_original_count > 0 && (
                    <Typography variant="caption" color="textSecondary">
                      (Orig: {performer.funscript_vids_original_count})
                    </Typography>
                  )}
                </Box>
              </Box>
              {/* Total Funscript Files */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'center', mt: 0.5 }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  Total Funscript Files:
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
          <Card variant="outlined" sx={{ height: '100%', bgcolor: 'var(--surface)', border: '1px solid var(--line)', borderLeftWidth: '4px', borderLeftColor: 'var(--ok)' }}>
            <CardContent>
              <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, color: 'var(--ok)', mb: 2 }}>
                Filtering Progress
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      Pictures
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
                      Videos
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
                      Funscripts
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
                <Box sx={{ mt: 1, p: 2, bgcolor: 'rgba(16,185,129,0.1)', borderRadius: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 500, color: 'var(--ok)' }}>
                    Filter Actions: {performer.filterStats.totalActions || 0}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 2, mt: 0.5 }}>
                    <Typography variant="caption" color="textSecondary">
                      Kept: {performer.filterStats.kept || 0}
                    </Typography>
                    <Typography variant="caption" color="textSecondary">
                      Deleted: {performer.filterStats.deleted || 0}
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
          <Card variant="outlined" sx={{ height: '100%', bgcolor: 'var(--surface)', border: '1px solid var(--line)', borderLeftWidth: '4px', borderLeftColor: 'var(--warn)' }}>
            <CardContent>
              <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, color: 'var(--warn)', mb: 2 }}>
                Hash Database
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 2, bgcolor: 'rgba(245,158,11,0.1)', borderRadius: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600, color: 'var(--warn)' }}>
                    Total Files
                  </Typography>
                  <Typography variant="h6" sx={{ fontWeight: 700, color: 'var(--warn)' }}>
                    {performer.hashStats.fileCount}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 2, bgcolor: 'rgba(245,158,11,0.08)', borderRadius: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600, color: 'var(--warn)' }}>
                    Deleted
                  </Typography>
                  <Typography variant="h6" sx={{ fontWeight: 700, color: 'var(--warn)' }}>
                    {performer.hashStats.deletedCount}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'center', mt: 0.5 }}>
                  <Typography variant="caption" color="textSecondary">
                    Updated: {formatDate(performer.hashStats.lastUpdated)}
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      )}

      {/* Row 3: Tags - Full Width */}
      <Grid item xs={12}>
        <Card variant="outlined" sx={{ bgcolor: 'var(--surface)', border: '1px solid var(--line)', borderLeftWidth: '4px', borderLeftColor: 'var(--accent)', width: '100%' }}>
          <CardContent>
            <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, color: 'var(--accent)', mb: 2 }}>
              Tags {(() =>{
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
          <Card variant="outlined" sx={{ bgcolor: 'var(--surface)', border: '1px solid var(--line)', borderLeftWidth: '4px', borderLeftColor: 'var(--accent)', width: '100%' }}>
            <CardContent>
              <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, color: 'var(--accent)', mb: 2 }}>
                Scraped Performer Data
              </Typography>
              <Grid container spacing={2}>
                {performer.age && (
                  <Grid item xs={6} sm={4} md={3}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        Age:
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
                        Born:
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
                        Birthplace:
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
                        Height:
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
                        Weight:
                      </Typography>
                      <Typography variant="body2" color="textSecondary">
                        {performer.weight}
                      </Typography>
                    </Box>
                  </Grid>
                )}
                {performer.measurements_cup && (
                  <Grid item xs={6} sm={4} md={3}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        Cup Size:
                      </Typography>
                      <Typography variant="body2" color="textSecondary">
                        {performer.measurements_cup}
                      </Typography>
                    </Box>
                  </Grid>
                )}
                {performer.measurements && (
                  <Grid item xs={6} sm={4} md={3}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        Measurements:
                      </Typography>
                      <Typography variant="body2" color="textSecondary">
                        {performer.measurements}
                      </Typography>
                    </Box>
                  </Grid>
                )}
                {performer.orientation && (
                  <Grid item xs={6} sm={4} md={3}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        Sexuality:
                      </Typography>
                      <Typography variant="body2" color="textSecondary">
                        {performer.orientation}
                      </Typography>
                    </Box>
                  </Grid>
                )}
                {performer.pubic_hair && (
                  <Grid item xs={6} sm={4} md={3}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        Grooming:
                      </Typography>
                      <Typography variant="body2" color="textSecondary">
                        {performer.pubic_hair}
                      </Typography>
                    </Box>
                  </Grid>
                )}
                {performer.tattoos && (
                  <Grid item xs={6} sm={4} md={3}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        Tattoos:
                      </Typography>
                      <Typography variant="body2" color="textSecondary">
                        {performer.tattoos}
                      </Typography>
                    </Box>
                  </Grid>
                )}
                {performer.piercings && (
                  <Grid item xs={6} sm={4} md={3}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        Piercings:
                      </Typography>
                      <Typography variant="body2" color="textSecondary">
                        {performer.piercings}
                      </Typography>
                    </Box>
                  </Grid>
                )}
                {performer.ethnicity && (
                  <Grid item xs={6} sm={4} md={3}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        Ethnicity:
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
                        Hair:
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
                        Eyes:
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
                        Body:
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
  );

  /**
   * A performer as a media row.
   *
   * This page rendered the app's hero object as text across nine columns while
   * every other surface renders it as a card with its face on it — that
   * mismatch is what made it read as engineering rather than library. The
   * thumbnail endpoint already existed; it was only ever used by the merge
   * dialog. Image sits small and on the left, per your note.
   */
  const renderPerformerCard = (performer, isDuplicate = false) => {
    const isExpanded = expandedPerformer === performer.id;
    const hasUpdate = leakhavenState(performer) === 'new';

    return (
      <Panel
        key={performer.id}
        id={`performer-${performer.id}`}
        padded={false}
        sx={{
          ml: isDuplicate ? 3 : 0,
          // .App is a flex column; cards in a nested flex column collapse
          // without this. See the note in FunpipePage.
          flexShrink: 0,
          borderColor: isDuplicate ? 'var(--warn)' : 'var(--line)',
          '&:hover': { borderColor: isDuplicate ? 'var(--warn)' : 'var(--line-strong)' }
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1 }}>
          <Avatar
            variant="rounded"
            src={thumbUrl(performer)}
            sx={{
              width: 56, height: 56, flexShrink: 0,
              bgcolor: 'var(--raised)', color: 'var(--muted)',
              fontSize: '1.1rem', fontWeight: 600,
              borderRadius: 'var(--radius-sm, 4px)'
            }}
          >
            {performer.name?.[0] || '?'}
          </Avatar>

          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
              <Typography
                title={performer.name}
                sx={{
                  fontSize: '0.9rem', fontWeight: 620, color: 'var(--text)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                }}
              >
                {performer.name}
              </Typography>
              <Box component="span" sx={pillSx(LOCATION_TONE[performer.location] || 'var(--dim)')}>
                {getLocationLabel(performer.location)}
              </Box>
              {performer.blacklisted === 1 && (
                <Box component="span" sx={pillSx('var(--muted)')}>Blacklisted</Box>
              )}
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mt: 0.5, flexWrap: 'wrap' }}>
              <Typography sx={metaSx}>
                <b>{performer.pics_count ?? 0}</b> pics
              </Typography>
              <Typography sx={metaSx}>
                <b>{performer.vids_count ?? 0}</b> vids
              </Typography>
              {performer.funscript_vids_count > 0 && (
                <Typography sx={metaSx}>
                  <b>{performer.funscript_vids_count}</b> scripted
                </Typography>
              )}
              <Typography sx={metaSx}>{formatFileSize(performer.total_size_gb)}</Typography>

              <Tooltip title={performer.hasHashDB
                ? `Hash database — ${performer.hashStats?.fileCount ?? 0} files`
                : 'No hash database'}>
                <Box
                  component="span"
                  onClick={performer.hasHashDB ? (e) => { e.stopPropagation(); handleOpenHashDB(performer.id); } : undefined}
                  sx={{ ...dotSx(performer.hasHashDB ? 'var(--ok)' : 'var(--faint)'),
                        cursor: performer.hasHashDB ? 'pointer' : 'default' }}
                >
                  hash
                </Box>
              </Tooltip>
              {renderScrapeFlag(performer)}
              {renderLeakhavenFlag(performer)}
              <Tooltip title={performer.folderExists
                ? `${performer.actualPath} — open in Explorer`
                : `${performer.actualPath} — folder not found`}>
                <Box
                  component="span"
                  onClick={performer.folderExists ? (e) => { e.stopPropagation(); handleOpenFolder(performer.actualPath); } : undefined}
                  sx={{ ...dotSx(performer.folderExists ? 'var(--ok)' : 'var(--bad)'),
                        cursor: performer.folderExists ? 'pointer' : 'default' }}
                >
                  folder
                </Box>
              </Tooltip>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>
            {hasUpdate && (
              <Tooltip title="Mark update as seen">
                <IconButton size="small" sx={iconBtnSx('var(--bad)', 'var(--ok)')}
                  onClick={() => handleAcknowledgeUpdate(performer.id, performer.name)}>
                  <CheckCircleIcon />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title="Rename performer">
              <IconButton size="small" sx={iconBtnSx()} onClick={() => handleRenameClick(performer)}>
                <EditIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="Scrape…">
              <IconButton size="small" sx={iconBtnSx()} onClick={() => handleScrape(performer)}>
                <SearchIcon />
              </IconButton>
            </Tooltip>
            {!performer.blacklisted && performer.folderExists && (
              <Tooltip title="Rescan performer folder">
                <IconButton size="small" sx={iconBtnSx()} onClick={() => handleRescanPerformer(performer)}>
                  <RefreshIcon />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title="Merge into another performer">
              <IconButton size="small" sx={iconBtnSx('var(--dim)', 'var(--warn)')} onClick={() => handleMergeClick(performer)}>
                <MergeIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete or manage">
              <IconButton size="small" sx={iconBtnSx('var(--dim)', 'var(--bad)')} onClick={() => handleDeleteClick(performer)}>
                <DeleteIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title={isExpanded ? 'Hide details' : 'Show details'}>
              <IconButton size="small" sx={iconBtnSx()} onClick={() => toggleExpandPerformer(performer.id)}>
                {isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        <Collapse in={isExpanded} timeout="auto" unmountOnExit>
          <Box sx={{ p: 2, pt: 1.5, borderTop: '1px solid var(--line)' }}>
            {renderPerformerDetail(performer)}
          </Box>
        </Collapse>
      </Panel>
    );
  };

  /**
   * A name that exists in more than one location.
   *
   * Shows both faces side by side, because deciding whether two records are the
   * same person is a visual call and the old row gave you only a name. The
   * group already knows which two records are the pair, so Merge acts on them
   * directly rather than sending you to an Autocomplete over every performer.
   */
  const renderDuplicateGroupCard = (group) => {
    const groupKey = group[0].name;
    const isExpanded = expandedGroup === groupKey;
    const beforePerformers = group.filter(p => p.location === 'before');
    const afterPerformers = group.filter(p => p.location === 'after');
    const mergeable = beforePerformers.length > 0 && afterPerformers.length > 0;

    return (
      <Box key={`group-${groupKey}`} sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        <Panel padded={false} sx={{ borderColor: 'var(--warn)', bgcolor: 'var(--warn-quiet)' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, p: 1 }}>
            <IconButton size="small" sx={iconBtnSx()} onClick={() => toggleExpandGroup(groupKey)}>
              {isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            </IconButton>

            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              {group.slice(0, 2).map((p, i) => (
                <Avatar
                  key={p.id}
                  variant="rounded"
                  src={thumbUrl(p)}
                  sx={{
                    width: 44, height: 44, flexShrink: 0,
                    ml: i ? '-10px' : 0, zIndex: 2 - i,
                    border: '2px solid var(--surface)',
                    borderRadius: 'var(--radius-sm, 4px)',
                    bgcolor: 'var(--raised)', color: 'var(--muted)', fontSize: '0.9rem'
                  }}
                >
                  {p.name?.[0] || '?'}
                </Avatar>
              ))}
            </Box>

            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <WarningIcon sx={{ fontSize: ICON.inline, color: 'var(--warn)' }} />
                <Typography sx={{ fontSize: '0.9rem', fontWeight: 620, color: 'var(--text)' }}>
                  {groupKey}
                </Typography>
              </Box>
              <Typography sx={{ fontSize: '0.72rem', color: 'var(--dim)', mt: 0.25 }}>
                {beforePerformers.length} before · {afterPerformers.length} after
                {mergeable ? ' · same name in both' : ''}
              </Typography>
            </Box>

            {mergeable && (
              <Button
                variant="contained"
                size="small"
                startIcon={<MergeIcon />}
                onClick={() => handleMergeNow(beforePerformers[0].id, afterPerformers[0].id)}
              >
                Merge
              </Button>
            )}
          </Box>
        </Panel>
        {isExpanded && group.map(p => renderPerformerCard(p, true))}
      </Box>
    );
  };

  const renderDuplicateGroup = (performers) => {
    const groupKey = performers[0].name;
    const isExpanded = expandedGroup === groupKey;
    const beforePerformers = performers.filter(p => p.location === 'before');
    const afterPerformers = performers.filter(p => p.location === 'after');

    return (
      <React.Fragment key={`group-${groupKey}`}>
        <TableRow hover sx={{ backgroundColor: 'var(--warn-quiet)' }}>
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
        <TableRow hover sx={isDuplicate ? { backgroundColor: 'var(--warn-quiet)' } : {}}>
          <TableCell>
            <Box display="flex" alignItems="center">
              <IconButton
                size="small"
                onClick={() => toggleExpandPerformer(performer.id)}
              >
                {isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              </IconButton>
              <Typography variant="body2" fontWeight="bold" ml={1}>
                {isDuplicate && '└─ '}
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
            {renderScrapeFlag(performer)}
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
            <Box display="flex" alignItems="center" justifyContent="center" gap={0.5}>
              {renderLeakhavenFlag(performer)}
              {leakhavenState(performer) === 'new' && (
                <Tooltip title="Mark as seen">
                  <IconButton size="small" color="primary" onClick={() => handleAcknowledgeUpdate(performer.id, performer.name)}>
                    <CheckCircleIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
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
            <Tooltip title="Merge into another performer">
              <IconButton
                size="small"
                onClick={() => handleMergeClick(performer)}
                color="warning"
              >
                <MergeIcon fontSize="small" />
              </IconButton>
            </Tooltip>
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
          <TableCell colSpan={9} style={{ paddingBottom: 0, paddingTop: 0, backgroundColor: 'var(--bg)' }}>
            <Collapse in={isExpanded} timeout="auto" unmountOnExit>
              <Box sx={{ p: 2, width: '100%' }}>
                {renderPerformerDetail(performer)}
              </Box>
            </Collapse>
          </TableCell>
        </TableRow>
      </React.Fragment>
    );
  };

  // Only before the first load: a reload must not unmount open panels and the Scrape modal
  if (loading && performers.length === 0) {
    return (
      <PageShell>
        <LoadingState label="Loading performers…" />
      </PageShell>
    );
  }

  const { performerList, duplicateGroups } = getCurrentTabPerformers();

  const unacknowledgedCount = performers.filter(p => leakhavenState(p) === 'new').length;
  const noLinkCount = performers.filter(p => leakhavenState(p) === 'none').length;
  const checking = checkProgress && checkProgress.done < checkProgress.total;

  return (
    <PageShell>
      <PageHeader
        title="Performer Management"
        subtitle={checkProgress && !checking
          ? `${summary?.total || 0} performers · last check: ${checkProgress.done} checked, ${checkProgress.newCount} new, ${checkProgress.errors} failed`
          : `${summary?.total || 0} performers across all locations`}
        actions={
          <>
            <Button variant="outlined" size="small" startIcon={<RefreshIcon />} onClick={() => loadPerformers()}>
              Reload
            </Button>
            <Badge badgeContent={unacknowledgedCount} color="error" max={99}>
              <Tooltip title={checking ? 'Click to stop' : 'Check every linked performer for new Leakhaven uploads'}>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={checking
                    ? <CircularProgress size={14} color="inherit" />
                    : unacknowledgedCount > 0 ? <NotificationsActiveIcon /> : <UpdateIcon />}
                  onClick={handleCheckUpdates}
                  sx={unacknowledgedCount > 0
                    ? { borderColor: 'var(--bad)', color: 'var(--bad)' }
                    : undefined}
                >
                  {checking ? `Checking ${checkProgress.done} / ${checkProgress.total}` : 'Check updates'}
                </Button>
              </Tooltip>
            </Badge>
          </>
        }
      />

      {/* Stats lead, and each one is the filter for its own group. In the
          sidebar they were six read-only boxes next to a separate list of
          filter buttons that repeated the same five categories — the numbers
          and the way you act on them were two different controls. */}
      <StatRow
        min={140}
        items={[
          { label: 'All', value: performers?.length || 0, tone: currentTab === 0 ? 'accent' : 'default' },
          { label: 'Before', value: grouped.before?.length || 0, tone: 'warn' },
          { label: 'After', value: grouped.after?.length || 0, tone: 'ok' },
          { label: 'Missing', value: grouped['missing-or-empty']?.length || 0, tone: 'bad' },
          { label: 'Blacklisted', value: grouped.blacklisted?.length || 0, tone: 'default' },
          { label: 'With hash', value: summary?.withHashDB || 0, tone: 'info', hint: `${summary?.scraped || 0} scraped` }
        ]}
      />

      <LayoutToolbar>
        {[
          { label: 'All', value: 0, count: performers?.length || 0 },
          { label: 'Before', value: 1, count: grouped.before?.length || 0 },
          { label: 'After', value: 2, count: grouped.after?.length || 0 },
          { label: 'Missing', value: 3, count: grouped['missing-or-empty']?.length || 0 },
          { label: 'Blacklisted', value: 4, count: grouped.blacklisted?.length || 0 }
        ].map(tab => (
          <Chip
            key={tab.value}
            size="small"
            label={`${tab.label} ${tab.count}`}
            onClick={() => setCurrentTab(tab.value)}
            sx={tabChipSx(currentTab === tab.value)}
          />
        ))}

        {/* Leakhaven filters, combined with the location above */}
        <Box sx={{ width: '1px', height: 18, bgcolor: 'var(--line-strong)', mx: 0.5 }} />
        <Chip
          size="small"
          icon={<FiberNewIcon />}
          label={`New content ${unacknowledgedCount}`}
          onClick={() => setNewOnly(v => !v)}
          sx={{
            ...tabChipSx(newOnly),
            ...(newOnly && { bgcolor: 'var(--bad)', borderColor: 'var(--bad)', color: '#fff', '&:hover': { bgcolor: 'var(--bad)' } }),
            '& .MuiChip-icon': { fontSize: ICON.inline, color: 'inherit' }
          }}
        />
        <Chip
          size="small"
          icon={<LinkOffIcon />}
          label={`No Leakhaven link ${noLinkCount}`}
          onClick={() => setNoLinkOnly(v => !v)}
          sx={{ ...tabChipSx(noLinkOnly), '& .MuiChip-icon': { fontSize: ICON.inline, color: 'inherit' } }}
        />

        <TextField
          size="small"
          placeholder="Search performers…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          sx={{ flex: 1, minWidth: 180, '& .MuiInputBase-input': { fontSize: '0.8rem', py: 0.75 } }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: ICON.inline, color: 'var(--muted)' }} />
              </InputAdornment>
            )
          }}
        />

        {/* Same affordance GalleryView uses, so the table is still one click
            away for anyone who wants to sort by size. */}
        <Box role="group" aria-label="View" sx={{
          display: 'flex', gap: '2px', p: '2px', bgcolor: 'var(--bg)',
          border: '1px solid var(--line)', borderRadius: 'var(--radius, 6px)'
        }}>
          {[['cards', 'Cards', <ViewModuleIcon key="c" />], ['table', 'Table', <ViewListIcon key="t" />]].map(([key, label, icon]) => (
            <Tooltip title={`${label} view`} key={key}>
              <IconButton
                size="small"
                onClick={() => setViewMode(key)}
                aria-label={`${label} view`}
                sx={{
                  borderRadius: 'var(--radius-sm, 4px)', p: 0.5,
                  color: viewMode === key ? 'var(--on-accent)' : 'var(--dim)',
                  bgcolor: viewMode === key ? 'var(--accent)' : 'transparent',
                  '& svg': { fontSize: ICON.action },
                  '&:hover': { bgcolor: viewMode === key ? 'var(--accent-hover)' : 'var(--raised)' }
                }}
              >
                {icon}
              </IconButton>
            </Tooltip>
          ))}
        </Box>
      </LayoutToolbar>

      {viewMode === 'cards' ? (
        performerList.length === 0 ? (
          <EmptyState
            icon={<SearchIcon />}
            title="No performers match these filters"
            description="Try a different tab, turn off a filter, or clear the search."
          />
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            {Object.entries(duplicateGroups).map(([key, group]) => renderDuplicateGroupCard(group))}
            {performerList
              .filter(p => !p.hasDuplicates)
              .map(performer => renderPerformerCard(performer))}
          </Box>
        )
      ) : (
        <Panel className="dp-panel" padded={false}>
          <Box className="dp-panel-header">
            <Typography variant="subtitle1" fontWeight="bold" sx={{ color: 'var(--text)' }}>
              All Performers ({performerList.length})
            </Typography>
            <Typography variant="caption" sx={{ color: 'var(--muted)' }}>
              Scraped: {summary?.scraped || 0}
            </Typography>
          </Box>

          <TableContainer sx={{ maxHeight: 'calc(100vh - 320px)' }} className="dp-table dp-scroll">
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Location</TableCell>
                  <TableCell align="center">Folder</TableCell>
                  <TableCell align="center" onClick={() => handleSort('hashdb')}
                    sx={{ cursor: 'pointer', userSelect: 'none', '&:hover': { color: 'var(--text)' } }}>
                    <Box display="flex" alignItems="center" justifyContent="center">Hash DB{getSortIcon('hashdb')}</Box>
                  </TableCell>
                  <TableCell align="center" onClick={() => handleSort('scraped')}
                    sx={{ cursor: 'pointer', userSelect: 'none', '&:hover': { color: 'var(--text)' } }}>
                    <Box display="flex" alignItems="center" justifyContent="center">Scraped{getSortIcon('scraped')}</Box>
                  </TableCell>
                  <TableCell onClick={() => handleSort('content')}
                    sx={{ cursor: 'pointer', userSelect: 'none', '&:hover': { color: 'var(--text)' } }}>
                    <Box display="flex" alignItems="center">Content{getSortIcon('content')}</Box>
                  </TableCell>
                  <TableCell onClick={() => handleSort('size')}
                    sx={{ cursor: 'pointer', userSelect: 'none', '&:hover': { color: 'var(--text)' } }}>
                    <Box display="flex" alignItems="center">Size{getSortIcon('size')}</Box>
                  </TableCell>
                  <TableCell align="center" onClick={() => handleSort('leakshaven')}
                    sx={{ cursor: 'pointer', userSelect: 'none', '&:hover': { color: 'var(--text)' } }}>
                    <Box display="flex" alignItems="center" justifyContent="center">Updates{getSortIcon('leakshaven')}</Box>
                  </TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {performerList.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} align="center" sx={{ py: 4, color: 'var(--muted)', borderBottom: 'none' }}>
                      No performers found matching the current filters
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {Object.entries(duplicateGroups).map(([key, group]) =>
                      renderDuplicateGroup(group)
                    )}
                    {performerList
                      .filter(p => !p.hasDuplicates)
                      .map(performer => renderPerformerRow(performer))
                    }
                  </>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Panel>
      )}

      {/* Delete/Action Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => !processing && setDeleteDialogOpen(false)} maxWidth="sm" fullWidth
        PaperProps={{ sx: { bgcolor: 'var(--surface)', border: '1px solid var(--line)' } }}>
        <DialogTitle sx={{ color: 'var(--text)' }}>
          {selectedPerformer?.blacklisted === 1 ? 'Manage Blacklisted Performer' : 'Delete or Manage Performer'}
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ color: 'var(--dim)' }}>
            What would you like to do with <strong style={{ color: 'var(--text)' }}>{selectedPerformer?.name}</strong>?
          </DialogContentText>
          <RadioGroup value={selectedDeleteOption} onChange={(e) => setSelectedDeleteOption(e.target.value)} sx={{ mt: 2 }}>
            {deleteOptions.map(option => (
              <FormControlLabel key={option} value={option} control={<Radio sx={{ color: 'var(--muted)', '&.Mui-checked': { color: 'primary.main' } }} />}
                label={<Typography sx={{ color: 'var(--dim)' }}>{getDeleteOptionLabel(option)}</Typography>} />
            ))}
          </RadioGroup>
          {selectedDeleteOption && (
            <Alert severity={selectedDeleteOption === 'delete-complete' ? 'error' : 'info'} sx={{ mt: 2 }}>
              {getDeleteOptionDescription(selectedDeleteOption)}
            </Alert>
          )}
          {selectedDeleteOption === 'blacklist' && (
            <TextField label="Reason (optional)" multiline rows={3} fullWidth value={blacklistReason}
              onChange={(e) => setBlacklistReason(e.target.value)} sx={{ mt: 2 }} className="dp-textfield"
              placeholder="e.g., Low quality content, unwanted performer, etc." />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} disabled={processing} sx={{ color: 'var(--dim)' }}>Cancel</Button>
          <Button onClick={handleDeleteConfirm} variant="contained"
            color={selectedDeleteOption === 'delete-complete' ? 'error' : 'primary'}
            disabled={processing || !selectedDeleteOption}
            startIcon={processing ? <CircularProgress size={20} /> : null}>
            {processing ? 'Processing...' : 'Confirm'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={renameDialogOpen} onClose={() => !processing && setRenameDialogOpen(false)} maxWidth="sm" fullWidth
        PaperProps={{ sx: { bgcolor: 'var(--surface)', border: '1px solid var(--line)' } }}>
        <DialogTitle sx={{ color: 'var(--text)' }}>Rename Performer</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ color: 'var(--dim)' }}>
            Rename <strong style={{ color: 'var(--text)' }}>{renamePerformer?.name}</strong> to a new name.
          </DialogContentText>
          <TextField autoFocus margin="dense" label="New Performer Name" fullWidth variant="outlined"
            value={newPerformerName} onChange={(e) => setNewPerformerName(e.target.value)} sx={{ mt: 2 }} className="dp-textfield" />
          <FormControlLabel
            control={<Radio checked={renameFolderToo} onChange={(e) => setRenameFolderToo(e.target.checked)} sx={{ color: 'var(--muted)', '&.Mui-checked': { color: 'primary.main' } }} />}
            label={<Typography sx={{ color: 'var(--dim)' }}>Also rename performer folders on disk</Typography>} sx={{ mt: 2 }} />
          <Alert severity="info" sx={{ mt: 2 }}>
            {renameFolderToo ? 'This will rename both the database entry and the physical folders on disk.' : 'This will only rename the database entry. Physical folders will keep their current names.'}
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameDialogOpen(false)} disabled={processing} sx={{ color: 'var(--dim)' }}>Cancel</Button>
          <Button onClick={handleRenameConfirm} variant="contained" disabled={processing || !newPerformerName.trim() || newPerformerName.trim() === renamePerformer?.name}
            startIcon={processing ? <CircularProgress size={20} /> : null}>
            {processing ? 'Renaming...' : 'Rename'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Merge Dialog */}
      <Dialog open={mergeDialogOpen} onClose={() => !processing && setMergeDialogOpen(false)} maxWidth="sm" fullWidth
        PaperProps={{ sx: { bgcolor: 'var(--surface)', border: '1px solid var(--line)' } }}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'var(--text)' }}>
          <MergeIcon color="warning" /> Merge Performer
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2, color: 'var(--dim)' }}>
            Merge <strong style={{ color: 'var(--text)' }}>{mergeSource?.name}</strong> into another performer. All files, ratings, aliases, and metadata will be combined.
          </DialogContentText>
          {mergeSource && (
            <Box sx={{ mb: 3, p: 2, bgcolor: 'var(--warn-quiet)', borderRadius: 1, border: '1px solid var(--warn-quiet)' }}>
              <Typography variant="subtitle2" color="warning.main" gutterBottom>Source (will be removed)</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Avatar src={thumbUrl(mergeSource)} sx={{ width: 40, height: 40 }}>{mergeSource.name[0]}</Avatar>
                <Box>
                  <Typography variant="body1" fontWeight={600} sx={{ color: 'var(--text)' }}>{mergeSource.name}</Typography>
                  <Typography variant="caption" sx={{ color: 'var(--dim)' }}>
                    ID: {mergeSource.id} · {mergeSource.pics_count || 0} pics · {mergeSource.vids_count || 0} vids
                  </Typography>
                </Box>
              </Box>
            </Box>
          )}
          <Autocomplete
            options={(performers || []).filter(p => p.id !== mergeSource?.id)}
            getOptionLabel={(option) => `${option.name} (ID: ${option.id})`}
            value={mergeTarget} onChange={(_, newValue) => setMergeTarget(newValue)}
            renderOption={(props, option) => (
              <li {...props} key={option.id}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Avatar src={thumbUrl(option)} sx={{ width: 32, height: 32 }}>{option.name[0]}</Avatar>
                  <Box>
                    <Typography variant="body2" fontWeight={500}>{option.name}</Typography>
                    <Typography variant="caption" color="text.secondary">{option.pics_count || 0} pics · {option.vids_count || 0} vids</Typography>
                  </Box>
                </Box>
              </li>
            )}
            renderInput={(params) => (
              <TextField {...params} label="Target Performer (keep this one)" placeholder="Search by name..." variant="outlined" fullWidth className="dp-textfield" />
            )}
          />
          {mergeTarget && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              <strong>This cannot be undone.</strong> "{mergeSource?.name}" will be merged into "{mergeTarget.name}".
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMergeDialogOpen(false)} disabled={processing} sx={{ color: 'var(--dim)' }}>Cancel</Button>
          <Button onClick={handleMergeConfirm} variant="contained" color="warning" disabled={processing || !mergeTarget}
            startIcon={processing ? <CircularProgress size={20} /> : <MergeIcon />}>
            {processing ? 'Merging...' : 'Merge'}
          </Button>
        </DialogActions>
      </Dialog>

      <ScrapeDialog
        performer={scrapeTarget}
        open={!!scrapeTarget}
        onClose={() => setScrapeTarget(null)}
        onSaved={() => loadPerformers()}
      />
    </PageShell>
  );
}

export default PerformerManagementPage;

