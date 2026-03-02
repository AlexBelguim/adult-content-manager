import React, { useState, useEffect } from 'react';
import {
  Container,
  Typography,
  Grid,
  Card,
  CardMedia,
  CardContent,
  Box,
  Chip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Tabs,
  Tab,
  Paper,
  ToggleButton,
  ToggleButtonGroup
} from '@mui/material';
import {
  PhotoLibrary,
  VideoLibrary,
  ArrowBack,
  Close,
  Fullscreen,
  PlayArrow
} from '@mui/icons-material';
import { useParams } from 'react-router-dom';

function GenreGalleryPage() {
  const { genreName } = useParams();
  const [content, setContent] = useState({ pics: [], vids: [] });
  const [viewMode, setViewMode] = useState('all'); // 'all', 'tagged', 'untagged'
  const [selectedTab, setSelectedTab] = useState(0);
  const [sortBy, setSortBy] = useState('name-asc');
  const [selectedMedia, setSelectedMedia] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showTagged, setShowTagged] = useState(true); // Toggle for virtual include

  // Get basePath from URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const basePath = urlParams.get('basePath');

  useEffect(() => {
    fetchGenreContent();
    // eslint-disable-next-line
  }, [genreName, basePath, showTagged]);

  const fetchGenreContent = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/gallery/genre/${encodeURIComponent(genreName)}?basePath=${encodeURIComponent(basePath)}&includeTagged=${showTagged}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      setContent(data);
    } catch (error) {
      console.error('Error fetching genre content:', error);
      setContent({ pics: [], vids: [] });
    } finally {
      setLoading(false);
    }
  };

  const handleMediaClick = (media) => {
    setSelectedMedia(media);
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setSelectedMedia(null);
  };

  const sortContent = (items) => {
    return [...items].sort((a, b) => {
      if (sortBy === 'name-asc') return a.name.localeCompare(b.name);
      if (sortBy === 'name-desc') return b.name.localeCompare(a.name);
      if (sortBy === 'size-desc') return b.size - a.size;
      if (sortBy === 'size-asc') return a.size - b.size;
      if (sortBy === 'date-desc') return new Date(b.modified) - new Date(a.modified);
      if (sortBy === 'date-asc') return new Date(a.modified) - new Date(b.modified);
      return 0;
    });
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Filter by viewMode (UI only, backend integration can be added next)
  const currentContent = selectedTab === 0 ? content.pics : content.vids;
  let filteredContent = currentContent;
  if (viewMode === 'tagged') {
    filteredContent = currentContent.filter(item => item.tags && item.tags.length > 0);
  } else if (viewMode === 'untagged') {
    filteredContent = currentContent.filter(item => !item.tags || item.tags.length === 0);
  }
  const sortedContent = sortContent(filteredContent);

  // Calculate tagged counts for header chips
  const taggedPicsCount = content.pics.filter(item => item.tags && item.tags.length > 0).length;
  const taggedVidsCount = content.vids.filter(item => item.tags && item.tags.length > 0).length;

  if (loading) {
    return (
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Typography variant="h4" sx={{ textAlign: 'center', color: 'text.secondary' }}>
          Loading {genreName} content...
        </Typography>
      </Container>
    );
  }

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Button
          startIcon={<ArrowBack />}
          onClick={() => window.close()}
          sx={{ mr: 2, minWidth: 0, px: 1, py: 0.5, fontSize: 14 }}
        >
          Close
        </Button>
        <Typography variant="h5" sx={{ fontWeight: 600, flexGrow: 1, letterSpacing: 0.5 }}>
          {genreName}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Chip
            icon={<PhotoLibrary sx={{ color: '#1976d2' }} />}
            label={<span><b>{content.pics.length}</b> pics</span>}
            size="small"
            sx={{ bgcolor: '#e3f2fd', color: '#1976d2', fontWeight: 500, px: 1.2, height: 28, fontSize: 14, borderRadius: 2 }}
          />
          <Chip
            label={<span style={{ color: taggedPicsCount > 0 ? '#388e3c' : '#aaa', fontWeight: 600 }}>
              +{taggedPicsCount}
            </span>}
            size="small"
            sx={{ bgcolor: taggedPicsCount > 0 ? '#c8e6c9' : '#f5f5f5', height: 24, fontSize: 13, px: 1, borderRadius: 2, ml: -0.5 }}
            title="Tagged pictures"
          />
          <Chip
            icon={<VideoLibrary sx={{ color: '#d32f2f' }} />}
            label={<span><b>{content.vids.length}</b> videos</span>}
            size="small"
            sx={{ bgcolor: '#ffebee', color: '#d32f2f', fontWeight: 500, px: 1.2, height: 28, fontSize: 14, borderRadius: 2 }}
          />
          <Chip
            label={<span style={{ color: taggedVidsCount > 0 ? '#388e3c' : '#aaa', fontWeight: 600 }}>
              +{taggedVidsCount}
            </span>}
            size="small"
            sx={{ bgcolor: taggedVidsCount > 0 ? '#c8e6c9' : '#f5f5f5', height: 24, fontSize: 13, px: 1, borderRadius: 2, ml: -0.5 }}
            title="Tagged videos"
          />
        </Box>
      </Box>

      {/* Controls */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
          <Tabs value={selectedTab} onChange={(e, newValue) => setSelectedTab(newValue)}>
            <Tab 
              label={`Pictures (${content.pics.length})`} 
              icon={<PhotoLibrary />}
              iconPosition="start"
            />
            <Tab 
              label={`Videos (${content.vids.length})`} 
              icon={<VideoLibrary />}
              iconPosition="start"
            />
            {/* Funscripts tab for visual parity, can be hidden if not needed */}
            {/* <Tab label={`Funscripts (0)`} /> */}
          </Tabs>

          <ToggleButtonGroup
            value={viewMode}
            exclusive
            onChange={(e, val) => val && setViewMode(val)}
            size="small"
            sx={{ ml: 2 }}
          >
            <ToggleButton value="all">All</ToggleButton>
            <ToggleButton value="tagged">Tagged</ToggleButton>
            <ToggleButton value="untagged">Untagged</ToggleButton>
          </ToggleButtonGroup>

          {/* Styled like a tab for visual parity */}
          <Tabs
            value={showTagged ? 0 : 1}
            onChange={(_, val) => setShowTagged(val === 0)}
            sx={{ minHeight: 40, ml: 2 }}
            TabIndicatorProps={{ style: { height: 3 } }}
          >
            <Tab label="Show files with this tag" sx={{ minHeight: 40, fontWeight: showTagged ? 600 : 400 }} />
            <Tab label="Hide files with this tag" sx={{ minHeight: 40, fontWeight: !showTagged ? 600 : 400 }} />
          </Tabs>

          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>Sort By</InputLabel>
            <Select 
              value={sortBy} 
              label="Sort By"
              onChange={(e) => setSortBy(e.target.value)}
            >
              <MenuItem value="name-asc">Name (A-Z)</MenuItem>
              <MenuItem value="name-desc">Name (Z-A)</MenuItem>
              <MenuItem value="size-desc">Size (Largest)</MenuItem>
              <MenuItem value="size-asc">Size (Smallest)</MenuItem>
              <MenuItem value="date-desc">Date (Newest)</MenuItem>
              <MenuItem value="date-asc">Date (Oldest)</MenuItem>
            </Select>
          </FormControl>
        </Box>
      </Paper>

      {/* Content Grid */}
      {sortedContent.length > 0 ? (
        <Grid container spacing={2}>
          {sortedContent.map((item, index) => (
            <Grid item xs={12} sm={6} md={4} lg={3} key={index}>
              <Card sx={{
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                '&:hover': {
                  transform: 'translateY(-2px)',
                  boxShadow: 4
                },
                position: 'relative'
              }}>
                {selectedTab === 0 ? (
                  <>
                    <funscript-image
                      src={item.url}
                      mode="modal"
                      view="stretch"
                      tagassign="true"
                      style={{ width: '100%', height: 200, objectFit: 'cover', display: 'block', borderRadius: 4 }}
                    ></funscript-image>
                  </>
                ) : (
                  <>
                    <funscript-player
                      src={item.url}
                      type="video"
                      mode="modal"
                      view="stretch"
                      tagassign="true"
                      scenemanager="true"
                      style={{ width: '100%', height: 200, display: 'block', borderRadius: 4 }}
                    ></funscript-player>
                    <Box sx={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      backgroundColor: 'rgba(0,0,0,0.7)',
                      borderRadius: 1,
                      p: 0.5
                    }}>
                      <PlayArrow sx={{ color: 'white', fontSize: 20 }} />
                    </Box>
                  </>
                )}
                <CardContent sx={{ p: 1 }}>
                  <Typography variant="body2" sx={{
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    {item.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {formatFileSize(item.size)}
                  </Typography>
                  {/* Tag chips under each media item */}
                  {item.tags && item.tags.length > 0 && (
                    <Box sx={{ mt: 0.5, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {item.tags.map((tag, i) => (
                        <Chip key={i} label={tag} size="small" sx={{ bgcolor: '#e3f2fd', color: '#1976d2', fontWeight: 500 }} />
                      ))}
                    </Box>
                  )}
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      ) : (
        <Box sx={{ 
          textAlign: 'center', 
          py: 8,
          color: 'text.secondary'
        }}>
          <Typography variant="h6" gutterBottom>
            No {selectedTab === 0 ? 'pictures' : 'videos'} found
          </Typography>
          <Typography variant="body2">
            This genre doesn't contain any {selectedTab === 0 ? 'pictures' : 'videos'} yet.
          </Typography>
        </Box>
      )}

      {/* Media Dialog */}
      <Dialog
        open={dialogOpen}
        onClose={handleCloseDialog}
        maxWidth="md"
        fullWidth
        sx={{
          '& .MuiDialog-paper': {
            maxHeight: '90vh'
          }
        }}
      >
        <DialogTitle sx={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          pb: 1
        }}>
          <Typography variant="h6" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {selectedMedia?.name}
          </Typography>
          <IconButton onClick={handleCloseDialog} size="small">
            <Close />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          {selectedMedia && (
            selectedTab === 0 ? (
              <img
                src={selectedMedia.url}
                alt={selectedMedia.name}
                style={{
                  width: '100%',
                  height: 'auto',
                  maxHeight: '70vh',
                  objectFit: 'contain'
                }}
              />
            ) : (
              <video
                src={selectedMedia.url}
                controls
                style={{
                  width: '100%',
                  height: 'auto',
                  maxHeight: '70vh'
                }}
              />
            )
          )}
        </DialogContent>
      </Dialog>
    </Container>
  );
}

export default GenreGalleryPage;