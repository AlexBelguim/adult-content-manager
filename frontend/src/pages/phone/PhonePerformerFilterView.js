import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  AppBar,
  Toolbar,
  Chip
} from '@mui/material';
import {
  Close as CloseIcon,
  ArrowBack as ArrowBackIcon,
  ArrowForward as ArrowForwardIcon,
  Label as TagIcon,
  SportsEsports as FunscriptIcon,
  Undo as UndoIcon
} from '@mui/icons-material';

function PhonePerformerFilterView({ performer, onBack, handyIntegration, handyConnected }) {
  const [contentType, setContentType] = useState('pics'); // 'pics', 'vids', 'funscripts'
  const [sortBy, setSortBy] = useState('name'); // 'name', 'date', 'size'
  const [sortOrder, setSortOrder] = useState('asc'); // 'asc', 'desc'
  const [hideKeptFiles, setHideKeptFiles] = useState(true); // Hide already kept files
  const [showSettings, setShowSettings] = useState(true);
  const [currentItems, setCurrentItems] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [filterActions, setFilterActions] = useState([]); // Track filter actions for undo
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!showSettings) {
      loadContent();
    }
  }, [contentType, sortBy, sortOrder, hideKeptFiles, showSettings]);

  // Helper function to handle back navigation with stats refresh
  const handleBackWithRefresh = async () => {
    try {
      // First, cleanup trash files
      const cleanupResponse = await fetch(`/api/performers/${performer.id}/cleanup-trash`, {
        method: 'POST'
      });
      
      if (cleanupResponse.ok) {
        const result = await cleanupResponse.json();
        console.log(`Cleanup: ${result.deletedCount} files permanently deleted`);
      }

      // Then refresh performer stats to update file counts and size
      const statsResponse = await fetch(`/api/performers/${performer.id}/refresh-stats`, {
        method: 'POST'
      });
      
      if (statsResponse.ok) {
        const statsResult = await statsResponse.json();
        console.log('Performer stats refreshed:', statsResult.stats);
      } else {
        console.error('Failed to refresh performer stats');
      }
    } catch (error) {
      console.error('Error cleaning up trash or refreshing stats:', error);
    } finally {
      onBack();
    }
  };

  const loadContent = async () => {
    if (!performer?.id) return;
    
    setLoading(true);
    try {
      const response = await fetch(`/api/performers/${performer.id}/content?type=${contentType}&sortBy=${sortBy}&sortOrder=${sortOrder}&hideKept=${hideKeptFiles}`);
      if (response.ok) {
        const data = await response.json();
        setCurrentItems(data.items || []);
        setCurrentIndex(0);
      }
    } catch (error) {
      console.error('Error loading content:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSettingsSubmit = () => {
    setShowSettings(false);
  };

  const handleKeep = async () => {
    if (currentItems[currentIndex]) {
      const item = currentItems[currentIndex];
      try {
        const response = await fetch(`/api/filter/keep`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            performerId: performer.id,
            itemId: item.id,
            itemType: contentType
          })
        });

        if (response.ok) {
          // Track action for undo
          setFilterActions(prev => [...prev, {
            action: 'keep',
            itemId: item.id,
            itemType: contentType,
            index: currentIndex
          }]);
          
          // Move to next item
          handleNext();
        }
      } catch (error) {
        console.error('Error keeping item:', error);
      }
    }
  };

  const handleDelete = async () => {
    if (currentItems[currentIndex]) {
      const item = currentItems[currentIndex];
      try {
        const response = await fetch(`/api/filter/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            performerId: performer.id,
            itemId: item.id,
            itemType: contentType
          })
        });

        if (response.ok) {
          // Track action for undo
          setFilterActions(prev => [...prev, {
            action: 'delete',
            itemId: item.id,
            itemType: contentType,
            index: currentIndex
          }]);
          
          // Move to next item
          handleNext();
        }
      } catch (error) {
        console.error('Error deleting item:', error);
      }
    }
  };

  const handleUndo = async () => {
    if (filterActions.length > 0) {
      const lastAction = filterActions[filterActions.length - 1];
      
      try {
        const response = await fetch(`/api/filter/undo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            performerId: performer.id,
            itemId: lastAction.itemId,
            itemType: lastAction.itemType
          })
        });

        if (response.ok) {
          // Remove last action
          setFilterActions(prev => prev.slice(0, -1));
          
          // Go back to previous item
          if (currentIndex > 0) {
            setCurrentIndex(currentIndex - 1);
          }
        }
      } catch (error) {
        console.error('Error undoing action:', error);
      }
    }
  };

  const handleNext = () => {
    if (currentIndex < currentItems.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      // No more items, go back to performer list
      handleBackWithRefresh();
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  const handleTag = () => {
    // TODO: Implement tag functionality
    console.log('Tag functionality not implemented yet');
  };

  const handleMoveToFunscript = () => {
    // TODO: Implement move to funscript functionality
    console.log('Move to funscript functionality not implemented yet');
  };

  const currentItem = currentItems[currentIndex];
  const remainingItems = currentItems.length - currentIndex;

  // Settings dialog
  if (showSettings) {
    return (
      <Box sx={{ 
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        bgcolor: 'background.default',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        p: 3
      }}>
        <Typography variant="h4" sx={{ mb: 4, textAlign: 'center', fontWeight: 'bold' }}>
          Filter Settings
        </Typography>
        <Typography variant="h6" sx={{ mb: 3, textAlign: 'center', color: 'text.secondary' }}>
          {performer.name}
        </Typography>

        <Box sx={{ width: '100%', maxWidth: '400px', display: 'flex', flexDirection: 'column', gap: 3 }}>
          <FormControl fullWidth>
            <InputLabel>Content Type</InputLabel>
            <Select 
              value={contentType} 
              label="Content Type"
              onChange={e => setContentType(e.target.value)}
            >
              <MenuItem value="pics">Pictures</MenuItem>
              <MenuItem value="vids">Videos</MenuItem>
              <MenuItem value="funscripts">Funscripts</MenuItem>
            </Select>
          </FormControl>

          <FormControl fullWidth>
            <InputLabel>Sort By</InputLabel>
            <Select 
              value={sortBy} 
              label="Sort By"
              onChange={e => setSortBy(e.target.value)}
            >
              <MenuItem value="name">Name</MenuItem>
              <MenuItem value="date">Date</MenuItem>
              <MenuItem value="size">Size</MenuItem>
            </Select>
          </FormControl>

          <FormControl fullWidth>
            <InputLabel>Order</InputLabel>
            <Select 
              value={sortOrder} 
              label="Order"
              onChange={e => setSortOrder(e.target.value)}
            >
              <MenuItem value="asc">Ascending</MenuItem>
              <MenuItem value="desc">Descending</MenuItem>
            </Select>
          </FormControl>

          <FormControl fullWidth>
            <InputLabel>Filter Options</InputLabel>
            <Select 
              value={hideKeptFiles ? 'hide' : 'show'} 
              label="Filter Options"
              onChange={e => setHideKeptFiles(e.target.value === 'hide')}
            >
              <MenuItem value="show">Show All Files</MenuItem>
              <MenuItem value="hide">Hide Kept Files</MenuItem>
            </Select>
          </FormControl>

          <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
            <Button 
              variant="outlined" 
              onClick={() => handleBackWithRefresh()}
              fullWidth
              sx={{ height: '48px' }}
            >
              Cancel
            </Button>
            <Button 
              variant="contained" 
              onClick={handleSettingsSubmit}
              fullWidth
              sx={{ height: '48px' }}
            >
              Start Filtering
            </Button>
          </Box>
        </Box>
      </Box>
    );
  }

  // Main filtering interface
  return (
    <Box sx={{ 
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      bgcolor: 'black',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Top bar */}
      <AppBar position="static" sx={{ bgcolor: 'rgba(0, 0, 0, 0.8)' }}>
        <Toolbar sx={{ justifyContent: 'space-between', minHeight: '56px !important' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <IconButton 
              onClick={() => handleBackWithRefresh()}
              sx={{ color: 'white' }}
            >
              <CloseIcon />
            </IconButton>
            
            <Typography variant="h6" sx={{ color: 'white', fontWeight: 'bold' }}>
              {currentIndex + 1} / {currentItems.length}
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Button
              variant="contained"
              size="small"
              startIcon={<TagIcon />}
              onClick={handleTag}
              sx={{ 
                bgcolor: 'primary.main',
                color: 'white',
                minWidth: '80px',
                height: '36px'
              }}
            >
              Tag
            </Button>
            
            {contentType === 'vids' && (
              <Button
                variant="contained"
                size="small"
                startIcon={<FunscriptIcon />}
                onClick={handleMoveToFunscript}
                sx={{ 
                  bgcolor: 'secondary.main',
                  color: 'white',
                  minWidth: '100px',
                  height: '36px'
                }}
              >
                Funscript
              </Button>
            )}
          </Box>
        </Toolbar>
      </AppBar>

      {/* Content area */}
      <Box sx={{ 
        flex: 1,
        display: 'flex',
        position: 'relative',
        overflow: 'hidden'
      }}>
        {currentItem && (
          <>
            {/* Delete area (left half - purple) */}
            <Box 
              onClick={handleDelete}
              sx={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: '50%',
                height: contentType === 'vids' ? 'calc(100% - 80px)' : '100%', // Leave space for video controls
                bgcolor: currentIndex === 0 ? 'rgba(156, 39, 176, 0.3)' : 'transparent', // Invisible after first file
                border: currentIndex === 0 ? '4px solid #9C27B0' : 'none',
                borderTop: '4px solid #9C27B0', // Always show top border
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                zIndex: 2
              }}
            >
              {currentIndex === 0 && (
                <Typography 
                  variant="h3" 
                  sx={{ 
                    color: '#9C27B0',
                    fontWeight: 'bold',
                    textShadow: '2px 2px 4px rgba(0,0,0,0.8)'
                  }}
                >
                  DELETE
                </Typography>
              )}
            </Box>

            {/* Keep area (right half - green) */}
            <Box 
              onClick={handleKeep}
              sx={{
                position: 'absolute',
                right: 0,
                top: 0,
                width: '50%',
                height: contentType === 'vids' ? 'calc(100% - 80px)' : '100%', // Leave space for video controls
                bgcolor: currentIndex === 0 ? 'rgba(76, 175, 80, 0.3)' : 'transparent', // Invisible after first file
                border: currentIndex === 0 ? '4px solid #4CAF50' : 'none',
                borderTop: '4px solid #4CAF50', // Always show top border
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                zIndex: 2
              }}
            >
              {currentIndex === 0 && (
                <Typography 
                  variant="h3" 
                  sx={{ 
                    color: '#4CAF50',
                    fontWeight: 'bold',
                    textShadow: '2px 2px 4px rgba(0,0,0,0.8)'
                  }}
                >
                  KEEP
                </Typography>
              )}
            </Box>

            {/* Content display */}
            <Box sx={{ 
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              zIndex: 1
            }}>
              {contentType === 'pics' && (
                <img
                  src={`/api/files/raw?path=${encodeURIComponent(currentItem.path)}`}
                  alt="Content"
                  style={{
                    maxWidth: '100%',
                    maxHeight: '100%',
                    objectFit: 'contain'
                  }}
                />
              )}
              
              {contentType === 'vids' && (
                <video
                  src={`/api/files/raw?path=${encodeURIComponent(currentItem.path)}`}
                  controls
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain' // This keeps the video properly scaled without stretching
                  }}
                />
              )}
              
              {contentType === 'funscripts' && (
                <Box sx={{ 
                  color: 'white', 
                  textAlign: 'center',
                  p: 4
                }}>
                  <Typography variant="h5" gutterBottom>
                    Funscript File
                  </Typography>
                  <Typography variant="body1">
                    {currentItem.name}
                  </Typography>
                </Box>
              )}
            </Box>
          </>
        )}

        {/* Loading state */}
        {loading && (
          <Box sx={{ 
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white'
          }}>
            <Typography variant="h5">Loading...</Typography>
          </Box>
        )}

        {/* No items state */}
        {!loading && currentItems.length === 0 && (
          <Box sx={{ 
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            textAlign: 'center',
            p: 4
          }}>
            <Typography variant="h5">
              No {contentType} to filter
            </Typography>
          </Box>
        )}
      </Box>

      {/* Bottom navigation */}
      <Box sx={{ 
        bgcolor: 'rgba(0, 0, 0, 0.8)',
        p: 2,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <IconButton 
          onClick={handlePrevious}
          disabled={currentIndex === 0}
          sx={{ 
            color: 'white',
            bgcolor: 'rgba(255, 255, 255, 0.1)',
            width: '60px',
            height: '60px'
          }}
        >
          <ArrowBackIcon sx={{ fontSize: '30px' }} />
        </IconButton>

        <Button
          variant="contained"
          onClick={handleUndo}
          disabled={filterActions.length === 0}
          startIcon={<UndoIcon />}
          sx={{
            bgcolor: '#4CAF50',
            color: 'white',
            minWidth: '120px',
            height: '48px',
            fontSize: '1.1rem',
            fontWeight: 'bold'
          }}
        >
          Undo
        </Button>

        <IconButton 
          onClick={handleNext}
          disabled={currentIndex >= currentItems.length - 1}
          sx={{ 
            color: 'white',
            bgcolor: 'rgba(255, 255, 255, 0.1)',
            width: '60px',
            height: '60px'
          }}
        >
          <ArrowForwardIcon sx={{ fontSize: '30px' }} />
        </IconButton>
      </Box>
    </Box>
  );
}

export default PhonePerformerFilterView;
