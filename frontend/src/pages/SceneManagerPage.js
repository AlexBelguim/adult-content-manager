import React, { useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Box, Button, Typography } from '@mui/material';
import SceneManagerModal from '../utils/SceneManagerModal';

const SceneManagerPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Support both old params (videoSrc, filePath) and new single param (video)
  const videoParam = searchParams.get('video');
  const videoSrc = videoParam 
    ? `/api/files/raw?path=${encodeURIComponent(videoParam)}`
    : searchParams.get('videoSrc');
  const filePath = videoParam || searchParams.get('filePath');

  const handleClose = useCallback(() => {
    try {
      if (window.opener && !window.opener.closed) {
        window.close();
        return;
      }
    } catch (error) {
      // Ignore cross-origin access errors and fall back to navigation
    }
    navigate(-1);
  }, [navigate]);

  if (!videoSrc || !filePath) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 2,
          backgroundColor: '#121212',
          color: '#ffffff'
        }}
      >
        <Typography variant="h5" sx={{ fontWeight: 600 }}>
          Scene Manager cannot start without a video reference.
        </Typography>
        <Button variant="contained" color="primary" onClick={handleClose}>
          Go Back
        </Button>
      </Box>
    );
  }

  return (
    <SceneManagerModal
      open
      variant="page"
      onClose={handleClose}
      videoSrc={videoSrc}
      filePath={filePath}
    />
  );
};

export default SceneManagerPage;
