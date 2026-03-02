import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  Box,
  Typography,
  Button,
  FormControlLabel,
  Checkbox,
  IconButton,
  Divider,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  CircularProgress,
  Tooltip
} from '@mui/material';
import {
  Close as CloseIcon,
  Delete as DeleteIcon,
  MoveUp as MoveIcon,
  Edit as EditIcon,
  Save as SaveIcon,
  Fingerprint as HashIcon,
  Search as SearchIcon,
  Refresh as RefreshIcon,
  Storage as StorageIcon
} from '@mui/icons-material';

// Dark theme modal styles (matching UploadQueuePage)
const darkModalStyles = {
  container: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: { xs: '95%', sm: '85%', md: '70%' },
    maxWidth: 700,
    maxHeight: '90vh',
    overflow: 'auto',
    bgcolor: '#1E1E1E',
    borderRadius: 3,
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    border: '1px solid #333',
    p: 0
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    p: 3,
    pb: 2,
    borderBottom: '1px solid #333'
  },
  content: {
    p: 3
  },
  section: {
    mb: 4
  },
  sectionTitle: {
    fontWeight: 'bold',
    mb: 2,
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    gap: 1
  },
  card: {
    bgcolor: '#252525',
    borderRadius: 2,
    p: 2.5,
    border: '1px solid #444'
  },
  textSecondary: {
    color: '#aaa'
  },
  gradientButton: {
    background: 'linear-gradient(45deg, #FE6B8B 30%, #FF8E53 90%)',
    color: '#fff',
    fontWeight: 'bold',
    px: 3,
    py: 1.5,
    textTransform: 'none',
    '&:hover': {
      background: 'linear-gradient(45deg, #FE6B8B 20%, #FF8E53 80%)',
      boxShadow: '0 3px 10px rgba(255, 105, 135, .4)'
    },
    '&:disabled': {
      background: '#444',
      color: '#777'
    }
  },
  outlinedButton: {
    borderColor: '#555',
    color: '#ddd',
    fontWeight: 'bold',
    px: 3,
    py: 1.5,
    textTransform: 'none',
    '&:hover': {
      borderColor: '#FF8E53',
      bgcolor: 'rgba(255, 142, 83, 0.1)'
    }
  },
  textField: {
    '& .MuiInputLabel-root': { color: '#aaa' },
    '& .MuiOutlinedInput-root': {
      color: '#fff',
      '& fieldset': { borderColor: '#444' },
      '&:hover fieldset': { borderColor: '#FF8E53' },
      '&.Mui-focused fieldset': { borderColor: '#FF8E53' }
    }
  }
};

function PerformerSettingsModal({
  performer,
  open,
  onClose,
  onUpdate,
  basePath,
  onAddBackgroundTask,
  // Hash queue management props (optional)
  hashQueue = [],
  setHashQueue = null
}) {
  const [settings, setSettings] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState({ open: false, type: '', title: '', message: '' });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRescanning, setIsRescanning] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteOption, setDeleteOption] = useState('blacklist');
  const [blacklistReason, setBlacklistReason] = useState('');
  const [deleteOptions, setDeleteOptions] = useState([]);
  const [isDeleting, setIsDeleting] = useState(false);

  // Rename state
  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState('');
  const [renameFolderToo, setRenameFolderToo] = useState(true);
  const [isRenaming, setIsRenaming] = useState(false);

  // Aliases state
  const [aliases, setAliases] = useState([]);
  const [aliasInput, setAliasInput] = useState('');
  const [savingAliases, setSavingAliases] = useState(false);
  const [scrapingData, setScrapingData] = useState(false);

  // Hash actions state
  const [isCreatingHash, setIsCreatingHash] = useState(false);
  const [isCheckingDuplicates, setIsCheckingDuplicates] = useState(false);

  const fetchSettings = useCallback(async () => {
    if (!performer?.id) return;

    try {
      const response = await fetch(`/api/performers/${performer.id}/settings`);
      if (response.ok) {
        const data = await response.json();
        setSettings(data);
        setNewName(data.performer?.name || performer.name);

        // Load aliases
        try {
          const aliasesData = data.performer?.aliases ? JSON.parse(data.performer.aliases) : [];
          setAliases(Array.isArray(aliasesData) ? aliasesData : []);
        } catch (e) {
          setAliases([]);
        }
      }
    } catch (error) {
      console.error('Error fetching settings:', error);
    }
  }, [performer?.id, performer?.name]);

  useEffect(() => {
    if (open && performer?.id) {
      fetchSettings();
      setIsEditingName(false);
    }
  }, [open, performer?.id, fetchSettings]);

  const handleRefreshStats = async () => {
    if (!performer?.id || isRefreshing) return;

    setIsRefreshing(true);
    try {
      const response = await fetch(`/api/performers/${performer.id}/refresh-stats-async`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        const result = await response.json();
        const jobId = result.jobId;

        if (typeof onAddBackgroundTask === 'function') {
          onAddBackgroundTask({
            id: jobId,
            title: 'Refreshing stats',
            description: `${performer.name}`,
            status: 'processing',
            progress: 0,
            performerId: performer.id,
          });
        }

        onClose();

        const pollInterval = setInterval(async () => {
          try {
            const statusResp = await fetch(`/api/performers/background-task/${jobId}`);
            if (statusResp.ok) {
              const statusData = await statusResp.json();
              const task = statusData.task;

              if (task.status === 'completed') {
                clearInterval(pollInterval);
                if (onUpdate) onUpdate();
              } else if (task.status === 'error') {
                clearInterval(pollInterval);
              }
            }
          } catch (err) {
            console.error('Error polling task status:', err);
          }
        }, 500);
      } else {
        const error = await response.json();
        alert('Failed to refresh stats: ' + (error.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error refreshing stats:', error);
      alert('Error refreshing stats: ' + error.message);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleRescanFiles = async () => {
    if (!performer?.id || isRescanning) return;

    setIsRescanning(true);
    try {
      const response = await fetch(`/api/performers/${performer.id}/rescan-files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      const result = await response.json();
      if (response.ok) {
        alert(result.message || 'File cache rebuilt successfully');
      } else {
        alert('Failed to rebuild cache: ' + (result.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error rescanning files:', error);
      alert('Error rescanning files: ' + error.message);
    } finally {
      setIsRescanning(false);
    }
  };

  // Rename performer handler
  const handleRenamePerformer = async () => {
    if (!performer?.id || !newName.trim() || isRenaming) return;

    if (newName.trim() === performer.name) {
      setIsEditingName(false);
      return;
    }

    setIsRenaming(true);
    try {
      const response = await fetch(`/api/performer-management/${performer.id}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newName: newName.trim(),
          renameFolder: renameFolderToo
        })
      });

      const data = await response.json();

      if (data.success) {
        setIsEditingName(false);
        if (onUpdate) onUpdate();
        // Refresh settings to get updated name
        await fetchSettings();
      } else {
        alert(`Failed to rename: ${data.error}`);
      }
    } catch (error) {
      console.error('Error renaming performer:', error);
      alert('Failed to rename performer');
    } finally {
      setIsRenaming(false);
    }
  };

  const handleSaveAliases = async () => {
    if (!performer?.id || savingAliases) return;

    setSavingAliases(true);
    try {
      const response = await fetch(`/api/performers/${performer.id}/aliases`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aliases })
      });

      if (response.ok) {
        if (onUpdate) onUpdate();
      } else {
        const error = await response.json();
        alert('Failed to save aliases: ' + (error.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error saving aliases:', error);
      alert('Error saving aliases: ' + error.message);
    } finally {
      setSavingAliases(false);
    }
  };

  const handleScrapeData = async () => {
    if (!performer?.id || scrapingData) return;

    setScrapingData(true);
    try {
      const response = await fetch(`/api/performers/${performer.id}/scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        const result = await response.json();

        if (result.performer?.aliases) {
          try {
            const scrapedAliases = JSON.parse(result.performer.aliases);
            setAliases(Array.isArray(scrapedAliases) ? scrapedAliases : []);
          } catch (e) {
            console.error('Error parsing scraped aliases:', e);
          }
        }

        await fetchSettings();
        if (onUpdate) onUpdate();
      } else {
        const error = await response.json();
        alert('Failed to scrape data: ' + (error.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error scraping data:', error);
      alert('Error scraping data: ' + error.message);
    } finally {
      setScrapingData(false);
    }
  };

  // Hash management actions
  const handleCreateHashDB = async () => {
    if (!performer?.id || isCreatingHash) return;

    setIsCreatingHash(true);
    try {
      // If we have setHashQueue, use the queue system
      if (setHashQueue) {
        const existingJob = hashQueue.find(j =>
          j.performerId === performer.id && (j.status === 'queued' || j.status === 'processing')
        );

        if (existingJob) {
          alert(`${performer.name} is already in the hash creation queue`);
          return;
        }

        const newJob = {
          id: `job-${Date.now()}-${Math.random()}`,
          performerId: performer.id,
          performerName: performer.name,
          location: settings?.performer?.location || 'before',
          mode: 'append',
          status: 'queued',
          processed: 0,
          total: 0,
          progress: 0,
        };

        setHashQueue(prev => [...prev, newJob]);
        onClose();
      } else {
        // Direct API call if queue system not available
        const response = await fetch(`/api/hashes/performer/${performer.id}/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'append' })
        });

        if (response.ok) {
          alert('Hash database creation started');
          onClose();
        } else {
          const error = await response.json();
          alert('Failed to create hash DB: ' + (error.error || 'Unknown error'));
        }
      }
    } catch (error) {
      console.error('Error creating hash DB:', error);
      alert('Error creating hash DB: ' + error.message);
    } finally {
      setIsCreatingHash(false);
    }
  };

  const handleCheckInternalDuplicates = async () => {
    if (!performer?.id || isCheckingDuplicates) return;

    setIsCheckingDuplicates(true);

    // Open new tab immediately with loading state
    const newTab = window.open('about:blank', '_blank');
    if (newTab) {
      newTab.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Loading Internal Duplicates...</title>
            <style>
              body {
                margin: 0;
                padding: 0;
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 100vh;
                background: #1E1E1E;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              }
              .loading-container {
                text-align: center;
                padding: 40px;
              }
              .spinner {
                border: 4px solid #333;
                border-top: 4px solid #FF8E53;
                border-radius: 50%;
                width: 60px;
                height: 60px;
                animation: spin 1s linear infinite;
                margin: 0 auto 20px;
              }
              @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
              }
              h2 { color: #fff; margin-bottom: 10px; }
              p { color: #aaa; }
            </style>
          </head>
          <body>
            <div class="loading-container">
              <div class="spinner"></div>
              <h2>Checking for Internal Duplicates...</h2>
              <p>Please wait while we analyze the content</p>
            </div>
          </body>
        </html>
      `);
    }

    try {
      const response = await fetch('/api/hashes/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_performer_id: performer.id,
          target_performer_id: performer.id,
        }),
      });

      const data = await response.json();

      if (data.success && data.runId) {
        if (newTab) {
          newTab.location.href = `/hash-results/${data.runId}`;
        }
        onClose();
      } else {
        throw new Error(data.error || 'Failed to check for internal duplicates');
      }
    } catch (error) {
      console.error('Error checking internal duplicates:', error);
      alert('Failed to check duplicates: ' + error.message);
      if (newTab) {
        newTab.close();
      }
    } finally {
      setIsCheckingDuplicates(false);
    }
  };

  const handleDeleteData = async () => {
    if (!performer?.id) return;

    try {
      const response = await fetch(`/api/performers/${performer.id}/data`, {
        method: 'DELETE'
      });

      if (response.ok) {
        if (onUpdate) onUpdate();
        onClose();
      }
    } catch (error) {
      console.error('Error deleting data:', error);
    }
  };

  const handleDeleteFolder = async () => {
    if (!performer?.id) return;

    const location = performer.location || (performer.moved_to_after ? 'after' : 'before');

    let options = [];

    if (performer.blacklisted === 1) {
      options = ['unblacklist', 'delete-complete'];
      setDeleteOption('unblacklist');
    } else if (location === 'after') {
      options = ['cleanup-before', 'delete-complete'];
      setDeleteOption('cleanup-before');
    } else if (location === 'before') {
      options = ['blacklist', 'delete-folder-only', 'delete-complete'];
      setDeleteOption('blacklist');
    } else {
      options = ['delete-complete'];
      setDeleteOption('delete-complete');
    }

    setDeleteOptions(options);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!performer?.id || !deleteOption) return;

    try {
      setIsDeleting(true);
      let response;

      switch (deleteOption) {
        case 'unblacklist':
          response = await fetch(`/api/performer-management/${performer.id}/unblacklist`, {
            method: 'POST'
          });
          break;

        case 'blacklist':
          response = await fetch(`/api/performer-management/${performer.id}/blacklist`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: blacklistReason })
          });
          break;

        case 'delete-folder-only':
          response = await fetch(`/api/performer-management/${performer.id}/folder-only`, {
            method: 'DELETE'
          });
          break;

        case 'cleanup-before':
          response = await fetch(`/api/performer-management/${performer.id}/before-cleanup`, {
            method: 'DELETE'
          });
          break;

        case 'delete-complete':
          response = await fetch(`/api/performer-management/${performer.id}/complete`, {
            method: 'DELETE'
          });
          break;

        default:
          throw new Error('Invalid delete option');
      }

      const data = await response.json();

      if (data.success) {
        setDeleteDialogOpen(false);
        if (onUpdate) onUpdate();
        onClose();
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (error) {
      console.error('Error processing action:', error);
      alert(`Failed to process action: ${error.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleMoveToAfter = async (merge = false) => {
    if (!performer?.id) return;

    try {
      const response = await fetch(`/api/performers/${performer.id}/move-to-after-async`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merge })
      });

      if (response.ok) {
        const result = await response.json();
        const jobId = result.jobId;

        if (typeof onAddBackgroundTask === 'function') {
          onAddBackgroundTask({
            id: jobId,
            title: merge ? 'Merging performer' : 'Moving to After',
            description: `${performer.name}`,
            status: 'processing',
            progress: 0,
            performerId: performer.id,
          });
        }

        onClose();

        const pollInterval = setInterval(async () => {
          try {
            const statusResp = await fetch(`/api/performers/background-task/${jobId}`);
            if (statusResp.ok) {
              const statusData = await statusResp.json();
              const task = statusData.task;

              if (task.status === 'completed') {
                clearInterval(pollInterval);
                if (onUpdate) onUpdate();
              } else if (task.status === 'error') {
                clearInterval(pollInterval);
                console.error('Move to after failed:', task.error);
              }
            }
          } catch (error) {
            console.error('Error polling task status:', error);
            clearInterval(pollInterval);
          }
        }, 1000);

        setTimeout(() => clearInterval(pollInterval), 300000);
      }
    } catch (error) {
      console.error('Error moving to after:', error);
    }
  };

  const showConfirmDialog = (type, title, message, action) => {
    setConfirmDialog({
      open: true,
      type,
      title,
      message,
      action
    });
  };

  const handleConfirmAction = () => {
    if (confirmDialog.type === 'merge') {
      handleMoveToAfter(true);
    } else if (confirmDialog.action) {
      confirmDialog.action();
    }
    setConfirmDialog({ open: false, type: '', title: '', message: '' });
  };

  const handleCancelAction = () => {
    setConfirmDialog({ open: false, type: '', title: '', message: '' });
  };

  if (!performer || !settings) return null;

  const hasHashDB = settings?.performer?.hash_count > 0;

  return (
    <>
      <Modal open={open} onClose={onClose}>
        <Box sx={darkModalStyles.container}>
          {/* Header with editable name */}
          <Box sx={darkModalStyles.header}>
            <Box sx={{ flex: 1 }}>
              <Typography
                variant="h5"
                sx={{
                  fontWeight: 'bold',
                  mb: 1,
                  background: 'linear-gradient(45deg, #FE6B8B 30%, #FF8E53 90%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent'
                }}
              >
                Performer Settings
              </Typography>

              {/* Editable Name */}
              {isEditingName ? (
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexDirection: 'column' }}>
                  <TextField
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    size="small"
                    fullWidth
                    sx={{ ...darkModalStyles.textField, maxWidth: 400 }}
                    autoFocus
                  />
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={renameFolderToo}
                          onChange={(e) => setRenameFolderToo(e.target.checked)}
                          size="small"
                          sx={{ color: '#aaa', '&.Mui-checked': { color: '#FF8E53' } }}
                        />
                      }
                      label={<Typography variant="body2" sx={{ color: '#aaa' }}>Also rename folder</Typography>}
                    />
                    <Button
                      size="small"
                      variant="contained"
                      onClick={handleRenamePerformer}
                      disabled={isRenaming || !newName.trim()}
                      startIcon={isRenaming ? <CircularProgress size={16} /> : <SaveIcon />}
                      sx={{ ...darkModalStyles.gradientButton, py: 0.5, px: 2 }}
                    >
                      Save
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => {
                        setIsEditingName(false);
                        setNewName(performer.name);
                      }}
                      sx={{ ...darkModalStyles.outlinedButton, py: 0.5, px: 2 }}
                    >
                      Cancel
                    </Button>
                  </Box>
                </Box>
              ) : (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="h6" sx={{ color: '#ddd' }}>
                    {settings?.performer?.name || performer.name}
                  </Typography>
                  <IconButton
                    size="small"
                    onClick={() => setIsEditingName(true)}
                    sx={{ color: '#aaa', '&:hover': { color: '#FF8E53' } }}
                  >
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Box>
              )}
            </Box>
            <IconButton onClick={onClose} sx={{ color: '#aaa', '&:hover': { bgcolor: 'rgba(255,255,255,0.1)' } }}>
              <CloseIcon />
            </IconButton>
          </Box>

          <Box sx={darkModalStyles.content}>
            {/* Aliases Section */}
            <Box sx={darkModalStyles.section}>
              <Typography variant="h6" sx={darkModalStyles.sectionTitle}>
                Aliases / Alternative Names
              </Typography>
              <Box sx={darkModalStyles.card}>
                <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                  <TextField
                    fullWidth
                    size="small"
                    value={aliasInput}
                    onChange={(e) => setAliasInput(e.target.value)}
                    placeholder="Add an alias..."
                    sx={darkModalStyles.textField}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter' && aliasInput.trim()) {
                        e.preventDefault();
                        if (!aliases.includes(aliasInput.trim())) {
                          setAliases([...aliases, aliasInput.trim()]);
                        }
                        setAliasInput('');
                      }
                    }}
                  />
                  <Button
                    variant="outlined"
                    onClick={() => {
                      if (aliasInput.trim() && !aliases.includes(aliasInput.trim())) {
                        setAliases([...aliases, aliasInput.trim()]);
                        setAliasInput('');
                      }
                    }}
                    disabled={!aliasInput.trim()}
                    sx={darkModalStyles.outlinedButton}
                  >
                    Add
                  </Button>
                </Box>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                  {aliases.map((alias, index) => (
                    <Chip
                      key={index}
                      label={alias}
                      onDelete={() => setAliases(aliases.filter((_, i) => i !== index))}
                      size="small"
                      sx={{
                        bgcolor: 'rgba(255, 142, 83, 0.2)',
                        color: '#FF8E53',
                        '& .MuiChip-deleteIcon': { color: '#FF8E53' }
                      }}
                    />
                  ))}
                  {aliases.length === 0 && (
                    <Typography variant="body2" sx={darkModalStyles.textSecondary}>
                      No aliases added yet
                    </Typography>
                  )}
                </Box>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                  <Button
                    variant="contained"
                    onClick={handleSaveAliases}
                    disabled={savingAliases}
                    startIcon={savingAliases ? <CircularProgress size={20} /> : <SaveIcon />}
                    sx={darkModalStyles.gradientButton}
                  >
                    {savingAliases ? 'Saving...' : 'Save Aliases'}
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={handleScrapeData}
                    disabled={scrapingData}
                    startIcon={scrapingData ? <CircularProgress size={20} /> : <SearchIcon />}
                    sx={darkModalStyles.outlinedButton}
                  >
                    {scrapingData ? 'Scraping...' : 'Scrape from Leakshaven'}
                  </Button>
                </Box>
              </Box>
            </Box>

            <Divider sx={{ my: 3, borderColor: '#333' }} />

            {/* Hash Management Section */}
            <Box sx={darkModalStyles.section}>
              <Typography variant="h6" sx={darkModalStyles.sectionTitle}>
                <HashIcon sx={{ color: '#ce93d8' }} />
                Hash Management
                {hasHashDB && (
                  <Chip
                    label={`${settings.performer.hash_count} hashes`}
                    size="small"
                    sx={{ ml: 1, bgcolor: 'rgba(206, 147, 216, 0.2)', color: '#ce93d8' }}
                  />
                )}
              </Typography>
              <Box sx={darkModalStyles.card}>
                <Typography variant="body2" sx={{ mb: 2, color: '#aaa' }}>
                  Create perceptual hashes to detect duplicate content across performers.
                </Typography>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                  <Tooltip title={hasHashDB ? "Update existing hash database" : "Create new hash database"}>
                    <Button
                      variant="contained"
                      onClick={handleCreateHashDB}
                      disabled={isCreatingHash}
                      startIcon={isCreatingHash ? <CircularProgress size={20} /> : <StorageIcon />}
                      sx={darkModalStyles.gradientButton}
                    >
                      {hasHashDB ? 'Update Hash DB' : 'Create Hash DB'}
                    </Button>
                  </Tooltip>
                  <Tooltip title="Find duplicate files within this performer's content">
                    <span>
                      <Button
                        variant="outlined"
                        onClick={handleCheckInternalDuplicates}
                        disabled={isCheckingDuplicates || !hasHashDB}
                        startIcon={isCheckingDuplicates ? <CircularProgress size={20} /> : <SearchIcon />}
                        sx={darkModalStyles.outlinedButton}
                      >
                        Check Internal Duplicates
                      </Button>
                    </span>
                  </Tooltip>
                </Box>
              </Box>
            </Box>

            <Divider sx={{ my: 3, borderColor: '#333' }} />

            {/* Stats Refresh Section */}
            <Box sx={darkModalStyles.section}>
              <Typography variant="h6" sx={darkModalStyles.sectionTitle}>
                <RefreshIcon sx={{ color: '#90caf9' }} />
                Update Stats
              </Typography>
              <Box sx={darkModalStyles.card}>
                <Typography variant="body2" sx={{ mb: 2, color: '#aaa' }}>
                  Manually scan the performer folder to update file counts, sizes, and thumbnail information.
                </Typography>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                  <Button
                    variant="contained"
                    onClick={handleRefreshStats}
                    disabled={isRefreshing}
                    startIcon={isRefreshing ? <CircularProgress size={20} /> : <RefreshIcon />}
                    sx={darkModalStyles.gradientButton}
                  >
                    {isRefreshing ? 'Refreshing...' : 'Refresh Stats'}
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={handleRescanFiles}
                    disabled={isRescanning}
                    sx={darkModalStyles.outlinedButton}
                  >
                    {isRescanning ? 'Scanning...' : 'Build/Update File Cache'}
                  </Button>
                </Box>
              </Box>
            </Box>

            <Divider sx={{ my: 3, borderColor: '#333' }} />

            {/* Action Buttons */}
            <Box sx={darkModalStyles.section}>
              <Typography variant="h6" sx={darkModalStyles.sectionTitle}>
                Actions
              </Typography>
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <Button
                  variant="contained"
                  color="success"
                  startIcon={<MoveIcon />}
                  onClick={() => handleMoveToAfter(false)}
                  sx={{ fontWeight: 'bold', textTransform: 'none' }}
                >
                  Move to After
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<DeleteIcon />}
                  onClick={() => showConfirmDialog(
                    'delete-data',
                    'Delete Data',
                    'Are you sure you want to delete all data for this performer? This action cannot be undone.',
                    handleDeleteData
                  )}
                  sx={{ fontWeight: 'bold', textTransform: 'none' }}
                >
                  Delete Data
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<DeleteIcon />}
                  onClick={handleDeleteFolder}
                  sx={{ fontWeight: 'bold', textTransform: 'none' }}
                >
                  Delete/Manage
                </Button>
              </Box>
            </Box>
          </Box>
        </Box>
      </Modal>

      {/* Confirmation Dialog */}
      <Dialog open={confirmDialog.open} onClose={handleCancelAction} PaperProps={{ sx: { bgcolor: '#252525', color: '#fff' } }}>
        <DialogTitle>{confirmDialog.title}</DialogTitle>
        <DialogContent>
          <Typography sx={{ color: '#ddd' }}>{confirmDialog.message}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancelAction} sx={{ color: '#aaa' }}>
            Cancel
          </Button>
          <Button onClick={handleConfirmAction} color="error" variant="contained">
            Confirm
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Options Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => !isDeleting && setDeleteDialogOpen(false)} maxWidth="md" fullWidth PaperProps={{ sx: { bgcolor: '#1E1E1E', color: '#fff' } }}>
        <DialogTitle>Performer Actions: {performer?.name}</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 2 }}>
            {deleteOptions.includes('unblacklist') && (
              <Box sx={{ border: '2px solid #2196f3', borderRadius: 2, p: 2, mb: 2, backgroundColor: 'rgba(33, 150, 243, 0.1)' }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={deleteOption === 'unblacklist'}
                      onChange={() => setDeleteOption('unblacklist')}
                      disabled={isDeleting}
                      sx={{ color: '#2196f3', '&.Mui-checked': { color: '#2196f3' } }}
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="h6" sx={{ color: '#2196f3' }}>
                        🔓 Remove from Blacklist
                      </Typography>
                      <Typography variant="body2" sx={{ color: '#aaa' }}>
                        Remove this performer from the blacklist and allow it to be imported again.
                      </Typography>
                    </Box>
                  }
                />
              </Box>
            )}

            {deleteOptions.includes('blacklist') && (
              <Box sx={{ border: '2px solid #ff9800', borderRadius: 2, p: 2, mb: 2, backgroundColor: 'rgba(255, 152, 0, 0.1)' }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={deleteOption === 'blacklist'}
                      onChange={() => setDeleteOption('blacklist')}
                      disabled={isDeleting}
                      sx={{ color: '#ff9800', '&.Mui-checked': { color: '#ff9800' } }}
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="h6" sx={{ color: '#ff9800' }}>
                        ⛔ Add to Blacklist
                      </Typography>
                      <Typography variant="body2" sx={{ color: '#aaa' }}>
                        Delete the folder and prevent this performer from being imported in the future.
                      </Typography>
                    </Box>
                  }
                />
                {deleteOption === 'blacklist' && (
                  <TextField
                    fullWidth
                    size="small"
                    label="Reason (optional)"
                    value={blacklistReason}
                    onChange={(e) => setBlacklistReason(e.target.value)}
                    sx={{ mt: 2, ...darkModalStyles.textField }}
                    disabled={isDeleting}
                  />
                )}
              </Box>
            )}

            {deleteOptions.includes('delete-folder-only') && (
              <Box sx={{ border: '2px solid #9c27b0', borderRadius: 2, p: 2, mb: 2, backgroundColor: 'rgba(156, 39, 176, 0.1)' }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={deleteOption === 'delete-folder-only'}
                      onChange={() => setDeleteOption('delete-folder-only')}
                      disabled={isDeleting}
                      sx={{ color: '#9c27b0', '&.Mui-checked': { color: '#9c27b0' } }}
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="h6" sx={{ color: '#9c27b0' }}>
                        📁 Delete Folder Only
                      </Typography>
                      <Typography variant="body2" sx={{ color: '#aaa' }}>
                        Delete the performer folder from disk but keep all database records (filter history, tags, etc).
                      </Typography>
                    </Box>
                  }
                />
              </Box>
            )}

            {deleteOptions.includes('cleanup-before') && (
              <Box sx={{ border: '2px solid #4caf50', borderRadius: 2, p: 2, mb: 2, backgroundColor: 'rgba(76, 175, 80, 0.1)' }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={deleteOption === 'cleanup-before'}
                      onChange={() => setDeleteOption('cleanup-before')}
                      disabled={isDeleting}
                      sx={{ color: '#4caf50', '&.Mui-checked': { color: '#4caf50' } }}
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="h6" sx={{ color: '#4caf50' }}>
                        🧹 Clean Up "Before" Folder
                      </Typography>
                      <Typography variant="body2" sx={{ color: '#aaa' }}>
                        For performers in "after" - delete the old "before filter performer" folder and merge hash databases.
                      </Typography>
                    </Box>
                  }
                />
              </Box>
            )}

            {deleteOptions.includes('delete-complete') && (
              <Box sx={{ border: '2px solid #f44336', borderRadius: 2, p: 2, backgroundColor: 'rgba(244, 67, 54, 0.1)' }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={deleteOption === 'delete-complete'}
                      onChange={() => setDeleteOption('delete-complete')}
                      disabled={isDeleting}
                      sx={{ color: '#f44336', '&.Mui-checked': { color: '#f44336' } }}
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="h6" sx={{ color: '#f44336' }}>
                        🗑️ Completely Delete Performer
                      </Typography>
                      <Typography variant="body2" sx={{ color: '#aaa' }}>
                        PERMANENT deletion of ALL data and files! Deletes folders, database records, hash DB, everything. Cannot be undone!
                      </Typography>
                    </Box>
                  }
                />
              </Box>
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ borderTop: '1px solid #333', p: 2 }}>
          <Button onClick={() => setDeleteDialogOpen(false)} disabled={isDeleting} sx={{ color: '#aaa' }}>
            Cancel
          </Button>
          <Button
            onClick={handleDeleteConfirm}
            color="error"
            variant="contained"
            disabled={!deleteOption || isDeleting}
          >
            {isDeleting ? 'Processing...' : 'Confirm Action'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export default PerformerSettingsModal;
