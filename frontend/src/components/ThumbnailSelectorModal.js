import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Grid,
  Card,
  CardMedia,
  CardActionArea,
  Box,
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
  ToggleButton
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

function ThumbnailSelectorModal({ open, onClose, performer, onSave }) {
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedImages, setSelectedImages] = useState([]);
  const [filter, setFilter] = useState('all'); // 'all', 'active', 'gif', 'pics'
  const [transitionType, setTransitionType] = useState('fade');
  const [transitionTime, setTransitionTime] = useState(3.0);
  const [previewImage, setPreviewImage] = useState(null);

  useEffect(() => {
    if (open && performer) {
      loadImages();
      // Load existing slideshow settings
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
    } else if (!open) {
      // Reset state when modal closes
      setImages([]);
      setFilter('all');
      setPreviewImage(null);
    }
  }, [open, performer]);

  const loadImages = async () => {
    if (!performer) return;

    setLoading(true);
    try {
      // Fetch all images from the performer's pics folder (fast cache-first)
      const response = await fetch(`/api/performers/${performer.id}/gallery/images`);

      if (response.ok) {
        const data = await response.json();
        setImages(data.items || data.pics || []);
      } else {
        console.error('Failed to load images');
        setImages([]);
      }
    } catch (err) {
      console.error('Error loading images:', err);
      setImages([]);
    } finally {
      setLoading(false);
    }
  };

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
        // Active images are those currently in the slideshow
        return images.filter(img => selectedImages.includes(img.path));

      case 'gif':
        // Filter only GIF files
        return images.filter(img =>
          img.path.toLowerCase().endsWith('.gif')
        );

      case 'pics':
        // Filter only static images (non-GIF)
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
      transitionTime
    });

    onClose();
  };

  const handleClear = () => {
    setSelectedImages([]);
  };

  const filteredImages = getFilteredImages();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xl"
      fullWidth
      fullScreen
      PaperProps={{
        sx: {
          height: '100vh',
          maxHeight: '100vh',
          m: 0
        }
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
      sx={{
        zIndex: 9999
      }}
    >
      <DialogTitle
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        Select Thumbnail Slideshow Images - {performer?.name}
      </DialogTitle>

      <DialogContent
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onMouseUp={(e) => e.stopPropagation()}
      >
        {/* Filter Controls */}
        <Box sx={{ mb: 3, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
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

          <Chip
            label={`${selectedImages.length} selected`}
            color={selectedImages.length > 0 ? 'primary' : 'default'}
          />
        </Box>

        {/* Transition Settings */}
        <Box sx={{ mb: 3, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel>Transition Type</InputLabel>
            <Select
              value={transitionType}
              label="Transition Type"
              onChange={(e) => setTransitionType(e.target.value)}
            >
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
            label="Transition Time (seconds)"
            value={transitionTime}
            onChange={(e) => setTransitionTime(parseFloat(e.target.value) || 3.0)}
            inputProps={{ min: 0.5, max: 30, step: 0.5 }}
            sx={{ width: 200 }}
          />
        </Box>

        {/* Image Grid */}
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
            <CircularProgress />
          </Box>
        ) : filteredImages.length === 0 ? (
          <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
            No images found for this filter
          </Typography>
        ) : (
          <Grid container spacing={2}>
            {filteredImages.map((image, index) => {
              const isSelected = selectedImages.includes(image.path);
              const selectionIndex = selectedImages.indexOf(image.path);

              return (
                <Grid item xs={6} sm={4} md={3} key={index}>
                  <Card
                    sx={{
                      position: 'relative',
                      border: isSelected ? '3px solid #1976d2' : '1px solid #ddd',
                      boxShadow: isSelected ? 4 : 1
                    }}
                  >
                    <CardActionArea onClick={() => toggleImageSelection(image.path)}>
                      <CardMedia
                        component="img"
                        height="200"
                        image={`/api/files/preview?path=${encodeURIComponent(image.path)}`}
                        alt={`Thumbnail ${index + 1}`}
                        sx={{ objectFit: 'cover' }}
                        onClick={(e) => {
                          if (e.shiftKey) {
                            e.stopPropagation();
                            setPreviewImage(image.path);
                          }
                        }}
                      />

                      {/* Selection Indicator */}
                      {isSelected && (
                        <Box
                          sx={{
                            position: 'absolute',
                            top: 8,
                            left: 8,
                            bgcolor: 'primary.main',
                            color: 'white',
                            borderRadius: '50%',
                            width: 32,
                            height: 32,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 'bold'
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
                    </CardActionArea>
                  </Card>
                </Grid>
              );
            })}
          </Grid>
        )}

        {/* Preview Dialog */}
        <Dialog
          open={!!previewImage}
          onClose={() => setPreviewImage(null)}
          maxWidth="lg"
        >
          <DialogContent>
            {previewImage && (
              <img
                src={`/api/files/preview?path=${encodeURIComponent(previewImage)}`}
                alt="Preview"
                style={{ maxWidth: '100%', maxHeight: '80vh' }}
              />
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setPreviewImage(null)}>Close</Button>
          </DialogActions>
        </Dialog>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClear} color="warning">
          Clear Selection
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose}>Cancel</Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={selectedImages.length === 0}
        >
          Save Slideshow ({selectedImages.length} images)
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default ThumbnailSelectorModal;
