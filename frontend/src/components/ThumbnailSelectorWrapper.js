import React, { useState, useEffect, useRef } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import ThumbnailSelectorPage from '../pages/ThumbnailSelectorPage';
import { CircularProgress, Box, Button } from '@mui/material';
import { EmptyState } from './layout';
import { useBack } from '../nav';
import { useNotify, errorText } from './ui';

function ThumbnailSelectorWrapper() {
  const { performerId } = useParams();
  const back = useBack('/');
  const location = useLocation();
  const [performer, setPerformer] = useState(null);
  const [loading, setLoading] = useState(true);
  const savingRef = useRef(false);
  const notify = useNotify();

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- location.state is read once, for the first load
  }, [performerId]);

  const handleSave = async (slideshowData) => {
    // A second click while the first save runs would save twice and go back two pages (F11-33). The lock is let go
    // only after a failure: after a save the page is on its way back, and a late click must not go back again.
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      const response = await fetch(`/api/performers/${performerId}/thumbnail-slideshow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(slideshowData)
      });

      if (response.ok) {
        back();
      } else {
        savingRef.current = false;
        const body = await response.json().catch(() => null);
        console.error('Failed to save slideshow', body);
        notify({ severity: 'error', message: body?.error ? `Could not save the slideshow: ${body.error}` : 'Could not save the slideshow' });
      }
    } catch (err) {
      savingRef.current = false;
      console.error('Error saving slideshow:', err);
      notify({ severity: 'error', message: errorText(err, 'Could not save the slideshow') });
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', bgcolor: 'var(--bg)' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!performer) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', p: 2, bgcolor: 'var(--bg)', color: 'var(--text)' }}>
        <EmptyState
          title="Performer not found"
          sx={{ width: '100%', maxWidth: 420 }}
          action={<Button variant="contained" disableElevation onClick={back}>Back</Button>}
        />
      </Box>
    );
  }

  return (
    <ThumbnailSelectorPage
      performer={performer}
      onBack={back}
      onSave={handleSave}
    />
  );
}

export default ThumbnailSelectorWrapper;
