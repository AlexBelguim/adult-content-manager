import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Button,
  Card,
  CardContent,
  Divider,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TextField,
  TableRow
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  PowerSettingsNew as PowerIcon,
  Storage as StorageIcon,
  Timer as TimerIcon,
  FilterList as FilterIcon,
  Key as KeyIcon,
  Memory as MemoryIcon,
  Folder as FolderIcon
} from '@mui/icons-material';

function AdminPage() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [shutdownDialog, setShutdownDialog] = useState(false);
  const [deactivateDialog, setDeactivateDialog] = useState(false);
  const [editLicenseDialog, setEditLicenseDialog] = useState(false);
  const [newLicenseKey, setNewLicenseKey] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [showFullKey, setShowFullKey] = useState(false);

  const fetchStats = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/admin/stats');
      if (!res.ok) throw new Error('Failed to fetch stats');
      const data = await res.json();
      setStats(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleShutdown = async () => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/admin/shutdown', { method: 'POST' });
      const data = await res.json();
      setMessage({ type: 'success', text: data.message || 'Server is shutting down...' });
      setShutdownDialog(false);
      
      // Disable further actions
      setTimeout(() => {
        setMessage({ type: 'info', text: 'Server has been shut down. Please restart manually.' });
      }, 2000);
    } catch (err) {
      setMessage({ type: 'error', text: `Shutdown failed: ${err.message}` });
      setShutdownDialog(false);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeactivate = async () => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/admin/deactivate-device', { method: 'POST' });
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Deactivation failed');
      }
      
      setMessage({ 
        type: 'success', 
        text: `Device deactivated! Remaining uses: ${data.newUses}` 
      });
      setDeactivateDialog(false);
      
      // Refresh stats
      await fetchStats();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
      setDeactivateDialog(false);
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpdateLicense = async () => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/admin/update-license', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey: newLicenseKey })
      });
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Update failed');
      }
      
      setMessage({ 
        type: 'success', 
        text: `License key updated successfully! Email: ${data.email}` 
      });
      setEditLicenseDialog(false);
      setNewLicenseKey('');
      
      // Refresh stats
      await fetchStats();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  if (loading && !stats) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error && !stats) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 4, bgcolor: '#f5f5f5', minHeight: '100vh' }}>
      {/* Header */}
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h4" sx={{ fontWeight: 'bold', color: '#1976d2' }}>
          ⚙️ Admin Dashboard
        </Typography>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={fetchStats}
            disabled={loading}
          >
            Refresh
          </Button>
          <Button
            variant="outlined"
            color="warning"
            startIcon={<KeyIcon />}
            onClick={() => setDeactivateDialog(true)}
          >
            Clear Local License
          </Button>
          <Button
            variant="contained"
            color="error"
            startIcon={<PowerIcon />}
            onClick={() => setShutdownDialog(true)}
          >
            Shutdown App
          </Button>
        </Box>
      </Box>

      {/* Messages */}
      {message && (
        <Alert severity={message.type} sx={{ mb: 3 }} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      {stats && (
        <Grid container spacing={3}>
          {/* License Info Card */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <KeyIcon sx={{ mr: 1, color: '#1976d2' }} />
                    <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                      License Information
                    </Typography>
                  </Box>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => {
                      setNewLicenseKey(stats.license.key);
                      setEditLicenseDialog(true);
                    }}
                  >
                    Edit Key
                  </Button>
                </Box>
                <Divider sx={{ mb: 2 }} />
                <TableContainer>
                  <Table size="small">
                    <TableBody>
                      <TableRow>
                        <TableCell><strong>License Key:</strong></TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography 
                              sx={{ 
                                fontFamily: 'monospace', 
                                fontSize: '0.875rem',
                                wordBreak: 'break-all'
                              }}
                            >
                              {showFullKey ? stats.license.key : stats.license.keyMasked}
                            </Typography>
                            <Button
                              size="small"
                              onClick={() => setShowFullKey(!showFullKey)}
                            >
                              {showFullKey ? 'Hide' : 'Show'}
                            </Button>
                          </Box>
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell><strong>Email:</strong></TableCell>
                        <TableCell>{stats.license.email}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell><strong>Product:</strong></TableCell>
                        <TableCell>{stats.license.product || 'N/A'}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell><strong>Device Usage:</strong></TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            <Chip 
                              label={`${stats.license.deviceUses} / ${stats.license.deviceMaxUses}`}
                              color={
                                typeof stats.license.deviceMaxUses === 'string' ? 'warning' :
                                stats.license.deviceUses >= stats.license.deviceMaxUses ? 'error' : 'success'
                              }
                              size="small"
                            />
                            {typeof stats.license.deviceMaxUses === 'string' && (
                              <Alert severity="warning" sx={{ py: 0, fontSize: '0.75rem' }}>
                                No usage limit configured! Set a limit in your Gumroad product settings to prevent key sharing.
                              </Alert>
                            )}
                            {stats.license.isOverLimit && (
                              <Alert severity="error" sx={{ py: 0.5 }}>
                                <strong>Usage limit exceeded!</strong> This device may stop working when the license token expires (14-day cache). 
                                Consider resetting the usage count or deactivating unused devices.
                              </Alert>
                            )}
                          </Box>
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell><strong>Status:</strong></TableCell>
                        <TableCell>
                          {stats.license.disabled && <Chip label="DISABLED" color="error" size="small" />}
                          {stats.license.refunded && <Chip label="REFUNDED" color="error" size="small" sx={{ ml: 1 }} />}
                          {stats.license.chargebacks > 0 && <Chip label={`Chargebacks: ${stats.license.chargebacks}`} color="error" size="small" sx={{ ml: 1 }} />}
                          {!stats.license.disabled && !stats.license.refunded && stats.license.chargebacks === 0 && (
                            <Chip label="ACTIVE" color="success" size="small" />
                          )}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell><strong>Expires At:</strong></TableCell>
                        <TableCell>{stats.license.expiresAt ? new Date(stats.license.expiresAt).toLocaleString() : 'N/A'}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell><strong>Last Validated:</strong></TableCell>
                        <TableCell>{stats.license.lastValidated ? new Date(stats.license.lastValidated).toLocaleString() : 'N/A'}</TableCell>
                      </TableRow>
                      {stats.license.saleDate && (
                        <TableRow>
                          <TableCell><strong>Purchase Date:</strong></TableCell>
                          <TableCell>{new Date(stats.license.saleDate).toLocaleString()}</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
                
                {/* Gumroad Configuration Help */}
                {typeof stats.license.deviceMaxUses === 'string' && (
                  <Alert severity="info" sx={{ mt: 2 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
                      How to set a device limit in Gumroad:
                    </Typography>
                    <Typography variant="body2" component="div">
                      1. Go to your product settings on Gumroad<br/>
                      2. Look for "License Keys" section<br/>
                      3. Find "Limit the number of times a license can be used"<br/>
                      4. Set a number (e.g., 3-5 for personal use)<br/>
                      5. Save changes
                    </Typography>
                  </Alert>
                )}
                
                {/* Device Management Help */}
                <Alert severity="info" sx={{ mt: 2 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
                    Managing Device Activations:
                  </Typography>
                  <Typography variant="body2" component="div" sx={{ mb: 1 }}>
                    To free up device activation slots, visit your Gumroad library:
                  </Typography>
                  <Button
                    variant="outlined"
                    size="small"
                    href="https://app.gumroad.com/library"
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{ mt: 1 }}
                  >
                    Open Gumroad Library →
                  </Button>
                </Alert>
              </CardContent>
            </Card>
          </Grid>

          {/* Uptime Card */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                  <TimerIcon sx={{ mr: 1, color: '#1976d2' }} />
                  <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                    Uptime
                  </Typography>
                </Box>
                <Divider sx={{ mb: 2 }} />
                <TableContainer>
                  <Table size="small">
                    <TableBody>
                      <TableRow>
                        <TableCell><strong>Current Session:</strong></TableCell>
                        <TableCell>{stats.uptime.current}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell><strong>Started At:</strong></TableCell>
                        <TableCell>{new Date(stats.uptime.startTime).toLocaleString()}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell><strong>Node Version:</strong></TableCell>
                        <TableCell>{stats.system.nodeVersion}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell><strong>Platform:</strong></TableCell>
                        <TableCell>{stats.system.platform}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </Grid>

          {/* Storage Card */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                  <StorageIcon sx={{ mr: 1, color: '#1976d2' }} />
                  <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                    Storage Usage (Database Records)
                  </Typography>
                </Box>
                <Divider sx={{ mb: 2 }} />
                {stats.storage.note && (
                  <Alert severity="info" sx={{ mb: 2, fontSize: '0.875rem' }}>
                    {stats.storage.note}
                  </Alert>
                )}
                <TableContainer>
                  <Table size="small">
                    <TableBody>
                      <TableRow>
                        <TableCell><strong>Performers:</strong></TableCell>
                        <TableCell>
                          <Chip label={stats.storage.performers.formatted} color="primary" />
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell><strong>Genres:</strong></TableCell>
                        <TableCell>
                          <Chip label={stats.storage.genres.formatted} color="info" />
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell><strong>Total:</strong></TableCell>
                        <TableCell>
                          <Chip label={stats.storage.total.formatted} color="secondary" />
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </Grid>

          {/* Filter Actions Card */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                  <FilterIcon sx={{ mr: 1, color: '#1976d2' }} />
                  <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                    Filter Actions
                  </Typography>
                </Box>
                <Divider sx={{ mb: 2 }} />
                <Typography variant="h4" sx={{ mb: 2, textAlign: 'center', color: '#1976d2' }}>
                  {stats.filterActions.total.toLocaleString()}
                </Typography>
                <TableContainer>
                  <Table size="small">
                    <TableBody>
                      {Object.entries(stats.filterActions.breakdown).map(([action, count]) => (
                        <TableRow key={action}>
                          <TableCell><strong>{action}:</strong></TableCell>
                          <TableCell>{count.toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </Grid>

          {/* Database Stats Card */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                  <MemoryIcon sx={{ mr: 1, color: '#1976d2' }} />
                  <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                    Database Statistics
                  </Typography>
                </Box>
                <Divider sx={{ mb: 2 }} />
                <TableContainer>
                  <Table size="small">
                    <TableBody>
                      <TableRow>
                        <TableCell><strong>Performers:</strong></TableCell>
                        <TableCell>{stats.database.performers.toLocaleString()}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell><strong>Genres:</strong></TableCell>
                        <TableCell>{stats.database.genres.toLocaleString()}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell><strong>Scenes:</strong></TableCell>
                        <TableCell>{stats.database.scenes.toLocaleString()}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell><strong>Exported Files:</strong></TableCell>
                        <TableCell>{stats.database.exportedFiles.toLocaleString()}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </Grid>

          {/* Memory Usage Card */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                  <MemoryIcon sx={{ mr: 1, color: '#1976d2' }} />
                  <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                    Memory Usage
                  </Typography>
                </Box>
                <Divider sx={{ mb: 2 }} />
                <TableContainer>
                  <Table size="small">
                    <TableBody>
                      <TableRow>
                        <TableCell><strong>RSS:</strong></TableCell>
                        <TableCell>{stats.system.memory.rss}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell><strong>Heap Total:</strong></TableCell>
                        <TableCell>{stats.system.memory.heapTotal}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell><strong>Heap Used:</strong></TableCell>
                        <TableCell>{stats.system.memory.heapUsed}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell><strong>External:</strong></TableCell>
                        <TableCell>{stats.system.memory.external}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </Grid>

          {/* Folders Card */}
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                  <FolderIcon sx={{ mr: 1, color: '#1976d2' }} />
                  <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                    Configured Folders ({stats.folders.length})
                  </Typography>
                </Box>
                <Divider sx={{ mb: 2 }} />
                <TableContainer>
                  <Table size="small">
                    <TableBody>
                      {stats.folders.map((folder) => (
                        <TableRow key={folder.id}>
                          <TableCell><strong>ID {folder.id}:</strong></TableCell>
                          <TableCell>{folder.path}</TableCell>
                          <TableCell>{folder.addedAt ? new Date(folder.addedAt).toLocaleString() : 'N/A'}</TableCell>
                        </TableRow>
                      ))}
                      {stats.folders.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={3} align="center">
                            <Typography color="textSecondary">No folders configured</Typography>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Shutdown Confirmation Dialog */}
      <Dialog open={shutdownDialog} onClose={() => !actionLoading && setShutdownDialog(false)}>
        <DialogTitle>Confirm Shutdown</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to shut down the application? This will stop the backend server and you'll need to restart it manually.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShutdownDialog(false)} disabled={actionLoading}>
            Cancel
          </Button>
          <Button onClick={handleShutdown} color="error" variant="contained" disabled={actionLoading}>
            {actionLoading ? <CircularProgress size={24} /> : 'Shutdown'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Deactivate Device Confirmation Dialog */}
      <Dialog open={deactivateDialog} onClose={() => !actionLoading && setDeactivateDialog(false)}>
        <DialogTitle>Clear Local License?</DialogTitle>
        <DialogContent>
          <Typography gutterBottom>
            This will clear the license from this device. You will need to re-enter your license key to use the app again.
          </Typography>
          <Alert severity="info" sx={{ mt: 2, mb: 2 }}>
            <strong>Note:</strong> This only clears the local license. To free up device activation slots on Gumroad, 
            you need to manage your license through the Gumroad dashboard.
          </Alert>
          <Button
            variant="outlined"
            size="small"
            href="https://app.gumroad.com/library"
            target="_blank"
            rel="noopener noreferrer"
            fullWidth
          >
            Open Gumroad Dashboard →
          </Button>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeactivateDialog(false)} disabled={actionLoading}>
            Cancel
          </Button>
          <Button onClick={handleDeactivate} color="warning" variant="contained" disabled={actionLoading}>
            {actionLoading ? <CircularProgress size={24} /> : 'Clear License'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit License Key Dialog */}
      <Dialog 
        open={editLicenseDialog} 
        onClose={() => !actionLoading && setEditLicenseDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Update License Key</DialogTitle>
        <DialogContent>
          <Typography gutterBottom sx={{ mb: 2 }}>
            Enter a new license key to replace the current one. This will verify the key with Gumroad and update your activation.
          </Typography>
          <TextField
            label="New License Key"
            value={newLicenseKey}
            onChange={(e) => setNewLicenseKey(e.target.value)}
            fullWidth
            autoFocus
            multiline
            rows={2}
            sx={{ mt: 1 }}
            helperText="Enter your Gumroad license key"
          />
          <Alert severity="info" sx={{ mt: 2 }}>
            This will count as a new activation if you're using a different key.
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditLicenseDialog(false)} disabled={actionLoading}>
            Cancel
          </Button>
          <Button 
            onClick={handleUpdateLicense} 
            color="primary" 
            variant="contained" 
            disabled={!newLicenseKey || actionLoading}
          >
            {actionLoading ? <CircularProgress size={24} /> : 'Update License'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default AdminPage;
