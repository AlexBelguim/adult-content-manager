import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Alert,
  CircularProgress,
  Container,
  useMediaQuery
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import PhonePerformerCard from '../../components/phone/PhonePerformerCard';
import PhonePerformerSettingsModal from '../../components/phone/PhonePerformerSettingsModal';
import PhonePerformerFilterView from './PhonePerformerFilterView';
import {
  fetchPerformers,
  handleChangeThumbnail,
  handleCompletePerformer
} from '../../components/FilterView';
import {
  sortPerformers,
  getNextPerformer
} from '../../utils/filterViewUtils';

function PhoneFilterView({ basePath, handyIntegration, handyConnected }) {
  const [performers, setPerformers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sort, setSort] = useState(() => localStorage.getItem('phoneFilterSortBy') || 'size-desc');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPerformer, setSelectedPerformer] = useState(null);
  const [settingsModal, setSettingsModal] = useState({ open: false, performer: null });
  
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  useEffect(() => {
    loadFilterPerformers();
  }, [basePath]);

  // Save sort state to localStorage
  useEffect(() => {
    localStorage.setItem('phoneFilterSortBy', sort);
  }, [sort]);

  const loadFilterPerformers = async () => {
    if (!basePath) return;
    
    try {
      setLoading(true);
      const performersData = await fetchPerformers();
      setPerformers(performersData);
      setError('');
    } catch (err) {
      console.error('Error loading performers:', err);
      setError('Failed to load performers. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handlePerformerClick = (performer) => {
    // If performer is in "after filter performer" folder (moved_to_after = 1), open gallery
    if (performer.moved_to_after) {
      const performerUrl = `/performer-gallery.html?performer=${encodeURIComponent(performer.name)}&basePath=${encodeURIComponent(basePath)}`;
      window.open(performerUrl, '_blank');
    } else {
      // Open filtering interface for this performer
      setSelectedPerformer(performer);
    }
  };

  const handleThumbnailChange = async (performerId) => {
    const success = await handleChangeThumbnail(performerId);
    if (success) {
      loadFilterPerformers();
    }
  };

  const handlePerformerComplete = async (performerId) => {
    const result = await handleCompletePerformer(performerId);
    if (result) {
      loadFilterPerformers();
      
      // If there's a next performer, auto-select it
      if (result.nextPerformer) {
        setSelectedPerformer(result.nextPerformer);
      } else {
        setSelectedPerformer(null);
      }
    }
  };

  const handlePerformerSettings = (performer) => {
    setSettingsModal({ open: true, performer });
  };

  const handleSettingsModalClose = () => {
    setSettingsModal({ open: false, performer: null });
    loadFilterPerformers(); // Refresh the list
  };

  const handleNextPerformer = async (currentPerformerId) => {
    console.log('handleNextPerformer called with ID:', currentPerformerId);
    
    try {
      const sorted = sortPerformers(performers, sort, searchTerm);
      const nextPerformer = getNextPerformer(currentPerformerId, sorted);
      
      if (nextPerformer) {
        console.log('Next performer from sorted array:', nextPerformer.name);
        loadFilterPerformers();
        setSelectedPerformer(nextPerformer);
      } else {
        console.log('No more performers in sorted order, going back to list');
        setSelectedPerformer(null);
      }
    } catch (error) {
      console.error('Error getting next performer:', error);
      setSelectedPerformer(null);
    }
  };

  // Apply sorting and filtering
  const sorted = sortPerformers(performers, sort, searchTerm);

  // If a performer is selected, show the filtering interface
  if (selectedPerformer) {
    return (
      <PhonePerformerFilterView 
        performer={selectedPerformer}
        onBack={(nextPerformer) => {
          if (nextPerformer) {
            console.log('onBack called with next performer:', nextPerformer.name);
            setSelectedPerformer(nextPerformer);
          } else {
            console.log('onBack called, going back to list');
            setSelectedPerformer(null);
          }
          loadFilterPerformers();
        }}
        handyIntegration={handyIntegration}
        handyConnected={handyConnected}
      />
    );
  }

  return (
    <Container 
      maxWidth={false}
      sx={{ 
        py: 2,
        px: 2,
        minHeight: '100vh',
        bgcolor: '#f5f5f5'
      }}
    >
      {/* Header */}
      <Box sx={{ 
        mb: 3,
        textAlign: 'center'
      }}>
        <Typography 
          variant="h4" 
          sx={{ 
            fontWeight: 'bold', 
            color: 'primary.main',
            mb: 2
          }}
        >
          Filter Performers
        </Typography>
        
        {/* Controls */}
        <Box sx={{ 
          display: 'flex', 
          flexDirection: 'column',
          gap: 2,
          maxWidth: '400px',
          mx: 'auto'
        }}>
          <TextField
            fullWidth
            size="medium"
            placeholder="Search performers..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            sx={{ 
              '& .MuiOutlinedInput-root': {
                borderRadius: '12px'
              }
            }}
          />
          
          <FormControl fullWidth size="medium">
            <InputLabel>Sort By</InputLabel>
            <Select 
              value={sort} 
              label="Sort By"
              onChange={e => setSort(e.target.value)}
              sx={{ borderRadius: '12px' }}
            >
              <MenuItem value="size-desc">Size (Largest First)</MenuItem>
              <MenuItem value="size-asc">Size (Smallest First)</MenuItem>
              <MenuItem value="name-asc">Name (A-Z)</MenuItem>
              <MenuItem value="name-desc">Name (Z-A)</MenuItem>
              <MenuItem value="date-desc">Date (Newest First)</MenuItem>
              <MenuItem value="date-asc">Date (Oldest First)</MenuItem>
              <MenuItem value="funscript-desc">Funscript Count (Most First)</MenuItem>
              <MenuItem value="funscript-asc">Funscript Count (Least First)</MenuItem>
            </Select>
          </FormControl>
        </Box>
      </Box>

      {/* Loading State */}
      {loading && (
        <Box sx={{ 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center', 
          minHeight: '200px' 
        }}>
          <CircularProgress size={60} />
        </Box>
      )}

      {/* Error State */}
      {error && (
        <Alert 
          severity="error" 
          sx={{ 
            mb: 3,
            borderRadius: '12px'
          }}
        >
          {error}
        </Alert>
      )}

      {/* Performers List */}
      {!loading && !error && (
        <Box sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          maxWidth: '500px',
          mx: 'auto'
        }}>
          {sorted.map(performer => (
            <PhonePerformerCard 
              key={performer.id}
              performer={performer} 
              onClick={() => handlePerformerClick(performer)}
              onChangeThumbnail={handleThumbnailChange}
              onSettings={handlePerformerSettings}
              mode="filter"
              basePath={basePath}
            />
          ))}
        </Box>
      )}

      {/* Empty State */}
      {!loading && !error && sorted.length === 0 && (
        <Box sx={{ 
          textAlign: 'center', 
          py: 8,
          color: 'text.secondary'
        }}>
          <Typography variant="h6" gutterBottom>
            No performers to filter
          </Typography>
          <Typography variant="body2">
            {searchTerm ? 'Try adjusting your search term.' : 'All performers have been processed or moved to the gallery.'}
          </Typography>
        </Box>
      )}

      {/* Performer Settings Modal */}
      <PhonePerformerSettingsModal 
        open={settingsModal.open} 
        performer={settingsModal.performer} 
        onClose={handleSettingsModalClose}
        onUpdate={loadFilterPerformers}
      />
    </Container>
  );
}

export default PhoneFilterView;
