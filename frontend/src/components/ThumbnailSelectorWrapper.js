import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import ThumbnailSelectorPage from '../pages/ThumbnailSelectorPage';
import { CircularProgress, Box } from '@mui/material';

function ThumbnailSelectorWrapper() {
  const { performerId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [performer, setPerformer] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    console.log('ThumbnailSelectorWrapper mounted. State:', location.state);

    // Check if performer data was passed via navigation state (optimistic UI)
    if (location.state?.performer) {
      console.log('Using passed state for performer:', location.state.performer.name);
      setPerformer(location.state.performer);
      setLoading(false);
      return;
    }

    console.log('No state found, fetching from API...');
    // Fetch performer data if not in state
    const loadPerformer = async () => {
      try {
        const response = await fetch(`/api/performers/${performerId}/lite`);
        if (response.ok) {
          const performerData = await response.json();
          if (performerData) {
            setPerformer(performerData);
          }
        }
      } catch (err) {
        console.error('Error loading performer:', err);
      } finally {
        setLoading(false);
      }
    };

    loadPerformer();
  }, [performerId]);

  const handleSave = async (slideshowData) => {
    try {
      const response = await fetch(`/api/performers/${performerId}/thumbnail-slideshow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(slideshowData)
      });

      if (response.ok) {
        // Navigate back to previous page
        navigate(-1);
      } else {
        console.error('Failed to save slideshow');
        alert('Failed to save thumbnail slideshow');
      }
    } catch (err) {
      console.error('Error saving slideshow:', err);
      alert('Error saving thumbnail slideshow');
    }
  };

  const handleBack = () => {
    navigate(-1);
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', bgcolor: '#1a1a1a' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!performer) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', bgcolor: '#1a1a1a', color: '#fff' }}>
        Performer not found
      </Box>
    );
  }

  return (
    <ThumbnailSelectorPage
      performer={performer}
      onBack={handleBack}
      onSave={handleSave}
    />
  );
}

export default ThumbnailSelectorWrapper;
