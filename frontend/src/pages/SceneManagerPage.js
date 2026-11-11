import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, Button, Typography } from '@mui/material';
import SceneManagerModal from '../utils/SceneManagerModal';
import { useBack } from '../nav';

/** /scene-editor?video=<path>. App redirects the old /scene-manager?filePath=&videoSrc= here. */
const SceneManagerPage = () => {
  const [searchParams] = useSearchParams();
  const filePath = searchParams.get('video') || searchParams.get('filePath');
  const videoSrc = filePath ? `/api/files/raw?path=${encodeURIComponent(filePath)}` : null;

  const handleClose = useBack('/');

  if (!videoSrc) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 1.5,
          p: 2,
          textAlign: 'center',
          backgroundColor: 'var(--bg)',
          color: 'var(--text)'
        }}
      >
        <Typography sx={{ fontSize: 18, fontWeight: 600 }}>No video given.</Typography>
        <Typography sx={{ fontSize: 13, color: 'var(--dim)' }}>
          Open a video&apos;s scenes from the player, or use More, Scene editor.
        </Typography>
        <Button variant="contained" disableElevation onClick={handleClose} sx={{ mt: 1 }}>
          Back
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
