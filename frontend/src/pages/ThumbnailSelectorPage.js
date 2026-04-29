import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Button,
  Grid,
  Card,
  CardMedia,
  CardActionArea,
  Checkbox,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Chip,
  Typography,
  CircularProgress,
  ToggleButtonGroup,
  ToggleButton,
  AppBar,
  Toolbar,
  IconButton,
  Dialog,
  DialogContent,
  DialogActions
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useStreamingFiles } from '../hooks/useStreamingFiles';

function ThumbnailSelectorPage({ performer, onBack, onSave }) {
  const [selectedImages, setSelectedImages] = useState([]);
  const [filter, setFilter] = useState('all');
  const [transitionType, setTransitionType] = useState('fade');
  const [transitionTime, setTransitionTime] = useState(8.0);
  const [transitionSpeed, setTransitionSpeed] = useState(2.0);
  const [previewImage, setPreviewImage] = useState(null);

  // Use the streaming files hook for progressive loading
  const {
    files: images,
    count: imageCount,
    loading: loadingList,
    loadedFiles: loadedImages,
    markFileLoaded: handleImageLoad,
    fromCache,
    refresh: refreshImages
  } = useStreamingFiles({
    endpoint: performer ? `/api/performers/${performer.id}/gallery/images` : null,
    performerId: performer?.id,
    type: 'pics',
    enabled: !!performer
  });

  // Load existing slideshow settings when performer changes
  useEffect(() => {
    if (performer) {
      if (performer.thumbnail_paths) {
        try {
          const paths = JSON.parse(performer.thumbnail_paths);
          setSelectedImages(paths);
        } catch (e) {
          console.error('Error parsing thumbnail_paths:', e);
          setSelectedImages([]);
        }
      } else {
        setSelectedImages([]);
      }
      if (performer.thumbnail_transition_type) {
        setTransitionType(performer.thumbnail_transition_type);
      } else {
        setTransitionType('fade');
      }
      if (performer.thumbnail_transition_time) {
        setTransitionTime(performer.thumbnail_transition_time);
      } else {
        setTransitionTime(3.0);
      }
    }
  }, [performer]);

  const toggleImageSelection = (imagePath) => {
    setSelectedImages(prev => {
      if (prev.includes(imagePath)) {
        return prev.filter(p => p !== imagePath);
      } else {
        return [...prev, imagePath];
      }
    });
  };

  const handleFilterChange = (event, newFilter) => {
    if (newFilter !== null) {
      setFilter(newFilter);
    }
  };

  const getFilteredImages = () => {
    if (!images || images.length === 0) return [];

    switch (filter) {
      case 'active':
        return images.filter(img => selectedImages.includes(img.path));
      case 'gif':
        return images.filter(img => img.path.toLowerCase().endsWith('.gif'));
      case 'pics':
        return images.filter(img =>
          !img.path.toLowerCase().endsWith('.gif') &&
          (img.path.toLowerCase().endsWith('.jpg') ||
            img.path.toLowerCase().endsWith('.jpeg') ||
            img.path.toLowerCase().endsWith('.png') ||
            img.path.toLowerCase().endsWith('.webp'))
        );
      case 'all':
      default:
        return images;
    }
  };

  const handleSave = () => {
    if (selectedImages.length === 0) {
      alert('Please select at least one image');
      return;
    }

    onSave({
      thumbnailPaths: selectedImages,
      transitionType,
      transitionTime,
      transitionSpeed
    });
  };

  const handleClear = () => {
    setSelectedImages([]);
  };

  const filteredImages = getFilteredImages();

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      {/* Header */}
      <AppBar position="static" sx={{ bgcolor: 'background.paper', backgroundImage: 'none' }}>
        <Toolbar>
          <IconButton
            edge="start"
            color="inherit"
            onClick={onBack}
            sx={{ mr: 2 }}
          >
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            Select Thumbnail Slideshow - {performer?.name}
          </Typography>
          <Chip
            label={`${selectedImages.length} selected`}
            color={selectedImages.length > 0 ? 'primary' : 'default'}
            sx={{ mr: 2 }}
          />
          <Button
            onClick={handleClear}
            color="warning"
            variant="outlined"
            sx={{ mr: 2 }}
          >
            Clear Selection
          </Button>
          <Button
            onClick={handleSave}
            variant="contained"
            color="primary"
            disabled={selectedImages.length === 0}
          >
            Save Slideshow
          </Button>
        </Toolbar>
      </AppBar>

      {/* Controls */}
      <Box sx={{ p: 2, bgcolor: 'background.paper', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
          <ToggleButtonGroup
            value={filter}
            exclusive
            onChange={handleFilterChange}
            size="small"
          >
            <ToggleButton value="all">All ({images.length})</ToggleButton>
            <ToggleButton value="active">Active ({selectedImages.length})</ToggleButton>
            <ToggleButton value="gif">
              GIFs ({images.filter(img => img.path.toLowerCase().endsWith('.gif')).length})
            </ToggleButton>
            <ToggleButton value="pics">
              Pics ({images.filter(img => !img.path.toLowerCase().endsWith('.gif')).length})
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>

        {/* Transition Settings */}
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel>Transition Type</InputLabel>
            <Select
              value={transitionType}
              label="Transition Type"
              onChange={(e) => setTransitionType(e.target.value)}
            >
              <MenuItem value="blur">Blur/Unblur</MenuItem>
              <MenuItem value="pixelate">Pixelate</MenuItem>
              <MenuItem value="pixel">Pixel (Big Blocks)</MenuItem>
              <MenuItem value="fade">Fade</MenuItem>
              <MenuItem value="slide">Slide</MenuItem>
              <MenuItem value="dissolve">Dissolve</MenuItem>
              <MenuItem value="zoom">Zoom</MenuItem>
              <MenuItem value="none">None (Instant)</MenuItem>
            </Select>
          </FormControl>

          <TextField
            size="small"
            type="number"
            label="Time Between Images (sec)"
            value={transitionTime}
            onChange={(e) => setTransitionTime(parseFloat(e.target.value) || 8.0)}
            inputProps={{ min: 0.5, max: 30, step: 0.5 }}
            sx={{ width: 200 }}
          />

          <TextField
            size="small"
            type="number"
            label="Transition Speed (sec)"
            value={transitionSpeed}
            onChange={(e) => setTransitionSpeed(parseFloat(e.target.value) || 2.0)}
            inputProps={{ min: 0.1, max: 5, step: 0.1 }}
            sx={{ width: 180 }}
          />
        </Box>
      </Box>

      {/* Image Grid */}
      <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
        {loadingList && images.length === 0 ? (
          /* Initial loading state: All skeletons based on count */
          <Grid container spacing={2}>
            {[...Array(imageCount || 24)].map((_, index) => (
              <Grid item xs={12} sm={6} md={4} lg={3} xl={2} key={`skeleton-init-${index}`}>
                <Card
                  sx={{
                    position: 'relative',
                    border: '1px solid rgba(255,255,255,0.1)',
                    bgcolor: 'background.paper',
                    height: '400px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'linear-gradient(90deg, rgba(255,255,255,0.02) 25%, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0.02) 75%)',
                    backgroundSize: '200% 100%',
                    animation: 'shimmer 1.5s infinite',
                    '@keyframes shimmer': {
                      '0%': { backgroundPosition: '200% 0' },
                      '100%': { backgroundPosition: '-200% 0' }
                    }
                  }}
                >
                  <CircularProgress size={24} sx={{ color: 'rgba(255,255,255,0.2)' }} />
                </Card>
              </Grid>
            ))}
          </Grid>
        ) : filteredImages.length === 0 && !loadingList ? (
          <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
            No images found for this filter
          </Typography>
        ) : (
          /* Mixed state: Real cards + Skeletons for remaining items */
          <Grid container spacing={2}>
            {/* Render loaded real images */}
            {filteredImages.map((image, index) => {
              const isSelected = selectedImages.includes(image.path);
              const selectionIndex = selectedImages.indexOf(image.path);

              return (
                <Grid item xs={12} sm={6} md={4} lg={3} xl={2} key={`img-${index}`}>
                  <Card
                    sx={{
                      position: 'relative',
                      border: isSelected ? '3px solid var(--primary-main, #7e57c2)' : '1px solid rgba(255,255,255,0.1)',
                      boxShadow: isSelected ? 4 : 1,
                      bgcolor: 'background.paper',
                      height: '400px',
                      display: 'flex',
                      flexDirection: 'column'
                    }}
                  >
                    <CardActionArea
                      onClick={() => toggleImageSelection(image.path)}
                      sx={{
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        p: 0
                      }}
                    >
                      <Box
                        sx={{
                          width: '100%',
                          height: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          overflow: 'hidden',
                          bgcolor: 'background.default',
                          position: 'relative',
                          p: 1
                        }}
                      >
                        {/* Spinner behind image while it loads */}
                        {!loadedImages[image.path] && (
                          <Box
                            sx={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              right: 0,
                              bottom: 0,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              bgcolor: 'rgba(0,0,0,0.5)'
                            }}
                          >
                            <CircularProgress size={24} sx={{ color: 'rgba(255,255,255,0.3)' }} />
                          </Box>
                        )}
                        <img
                          src={`/api/files/raw?path=${encodeURIComponent(image.path)}`}
                          alt={`Thumbnail ${index + 1}`}
                          loading="lazy"
                          onLoad={() => handleImageLoad(image.path)}
                          style={{
                            maxWidth: '100%',
                            maxHeight: '100%',
                            width: 'auto',
                            height: 'auto',
                            objectFit: 'contain',
                            opacity: loadedImages[image.path] ? 1 : 0,
                            transition: 'opacity 0.3s ease'
                          }}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            setPreviewImage(image.path);
                          }}
                        />
                      </Box>

                      {/* Selection Order Number */}
                      {isSelected && (
                        <Box
                          sx={{
                            position: 'absolute',
                            top: 8,
                            left: 8,
                            bgcolor: 'primary.main',
                            color: 'white',
                            borderRadius: '50%',
                            width: 36,
                            height: 36,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 'bold',
                            fontSize: '1.1rem'
                          }}
                        >
                          {selectionIndex + 1}
                        </Box>
                      )}

                      {/* Checkbox */}
                      <Checkbox
                        checked={isSelected}
                        sx={{
                          position: 'absolute',
                          top: 8,
                          right: 8,
                          bgcolor: 'rgba(255,255,255,0.9)',
                          '&:hover': { bgcolor: 'rgba(255,255,255,1)' }
                        }}
                        icon={<CheckCircleIcon />}
                        checkedIcon={<CheckCircleIcon />}
                      />

                      {/* GIF Indicator */}
                      {image.path.toLowerCase().endsWith('.gif') && (
                        <Chip
                          label="GIF"
                          size="small"
                          color="secondary"
                          sx={{
                            position: 'absolute',
                            bottom: 8,
                            right: 8
                          }}
                        />
                      )}

                      {/* Filename */}
                      <Typography
                        variant="caption"
                        sx={{
                          position: 'absolute',
                          bottom: 0,
                          left: 0,
                          right: 0,
                          bgcolor: 'rgba(0,0,0,0.7)',
                          color: 'white',
                          p: 0.5,
                          fontSize: '0.65rem',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}
                      >
                        {image.name}
                      </Typography>
                    </CardActionArea>
                  </Card>
                </Grid>
              );
            })}

            {/* Render skeletons for remaining items if still loading and filter is 'all' */}
            {loadingList && filter === 'all' && (
              [...Array(Math.max(0, (imageCount || 0) - images.length))].map((_, index) => (
                <Grid item xs={12} sm={6} md={4} lg={3} xl={2} key={`skeleton-rem-${index}`}>
                  <Card
                    sx={{
                      position: 'relative',
                      border: '1px solid rgba(255,255,255,0.1)',
                      bgcolor: 'background.paper',
                      height: '400px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: 0.5
                    }}
                  >
                    <CircularProgress size={20} sx={{ color: 'rgba(255,255,255,0.1)' }} />
                  </Card>
                </Grid>
              ))
            )}
          </Grid>
        )}
      </Box>

      {/* Preview Dialog */}
      <Dialog
        open={!!previewImage}
        onClose={() => setPreviewImage(null)}
        maxWidth="xl"
        fullWidth
      >
        <DialogContent sx={{ bgcolor: '#000', p: 0 }}>
          {previewImage && (
            <img
              src={`/api/files/raw?path=${encodeURIComponent(previewImage)}`}
              alt="Preview"
              style={{ width: '100%', height: 'auto', display: 'block' }}
            />
          )}
        </DialogContent>
        <DialogActions sx={{ bgcolor: 'background.paper' }}>
          <Button onClick={() => setPreviewImage(null)} color="primary">
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default ThumbnailSelectorPage;
