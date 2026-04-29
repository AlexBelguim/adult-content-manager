import React, { useState, useEffect } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Card,
  CardMedia,
  CardContent,
  CardActions,
  Button,
  Grid,
  Chip,
  CircularProgress,
  Alert,
  ToggleButton,
  ToggleButtonGroup,
  Dialog,
  DialogContent,
  IconButton,
  Checkbox,
  FormControlLabel,
  Tooltip,
  Pagination
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';

function MLPredictionResultsPage() {
  const { performerId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { predictions, performerName, modelId, modelName } = location.state || {};

  const [confidenceFilter, setConfidenceFilter] = useState('all');
  const [predictionFilter, setPredictionFilter] = useState('all');
  const [selectedImage, setSelectedImage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const itemsPerPage = 30;

  useEffect(() => {
    if (!predictions) {
      // If no predictions in state, could fetch them
      console.warn('No predictions provided in navigation state');
    } else {
      console.log('Predictions received:', predictions.length, 'items');
      console.log('First prediction:', predictions[0]);
    }
  }, [predictions]);

  // Reset page to 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [confidenceFilter, predictionFilter]);

  if (!predictions || predictions.length === 0) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">
          {!predictions 
            ? 'No prediction data available. Please generate predictions first.'
            : 'No predictions were generated. The performer may have no files with perceptual hashes.'
          }
        </Alert>
        <Button onClick={() => navigate('/ml-management')} sx={{ mt: 2 }}>
          Back to ML Management
        </Button>
      </Box>
    );
  }

  const getConfidenceLevel = (confidence) => {
    if (confidence > 0.8) return 'high';
    if (confidence > 0.6) return 'medium';
    return 'low';
  };

  const getConfidenceIcon = (prediction, confidence) => {
    const level = getConfidenceLevel(confidence);
    
    if (prediction === 0) { // Delete (0 = delete in training data)
      if (level === 'high') return '🔴';
      if (level === 'medium') return '🟠';
      return '🟡';
    } else { // Keep (1 = keep)
      if (level === 'high') return '🟢';
      if (level === 'medium') return '🟡';
      return '⚪';
    }
  };

  const getConfidenceColor = (prediction, confidence) => {
    const level = getConfidenceLevel(confidence);
    
    if (prediction === 0) { // Delete
      if (level === 'high') return 'error';
      if (level === 'medium') return 'warning';
      return 'default';
    } else { // Keep
      if (level === 'high') return 'success';
      if (level === 'medium') return 'warning';
      return 'default';
    }
  };

  const filterPredictions = () => {
    let filtered = predictions;

    // Filter by confidence
    if (confidenceFilter === 'high') {
      filtered = filtered.filter(p => p.confidence > 0.8);
    } else if (confidenceFilter === 'medium') {
      filtered = filtered.filter(p => p.confidence >= 0.6 && p.confidence <= 0.8);
    } else if (confidenceFilter === 'low') {
      filtered = filtered.filter(p => p.confidence < 0.6);
    }

    // Filter by prediction (0 = delete, 1 = keep)
    if (predictionFilter === 'delete') {
      filtered = filtered.filter(p => p.prediction === 0);
    } else if (predictionFilter === 'keep') {
      filtered = filtered.filter(p => p.prediction === 1);
    }

    return filtered;
  };

  const filteredPredictions = filterPredictions();
  
  // Pagination
  const totalPages = Math.ceil(filteredPredictions.length / itemsPerPage);
  const startIndex = (page - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedPredictions = filteredPredictions.slice(startIndex, endIndex);

  const handlePageChange = (event, value) => {
    setPage(value);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const stats = {
    total: predictions.length,
    delete: predictions.filter(p => p.prediction === 0).length,
    keep: predictions.filter(p => p.prediction === 1).length,
    highConfidenceDelete: predictions.filter(p => p.prediction === 0 && p.confidence > 0.8).length,
    highConfidenceKeep: predictions.filter(p => p.prediction === 1 && p.confidence > 0.8).length,
  };

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" gutterBottom>
          ML Prediction Results
        </Typography>
        <Typography variant="caption" display="block" color="text.secondary">
          Performer: <strong>{performerName}</strong> • Model: {modelName}
        </Typography>
      </Box>

      {/* Stats Summary */}
      <Box sx={{ 
        mb: 3, 
        p: 2, 
        bgcolor: '#121212', 
        borderRadius: 2,
        display: 'flex',
        gap: 3,
        flexWrap: 'wrap'
      }}>
        <Box>
          <Typography variant="caption" color="text.secondary">Total Files</Typography>
          <Typography variant="h6" fontWeight="bold">{stats.total}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Showing</Typography>
          <Typography variant="h6" fontWeight="bold" color="primary">{filteredPredictions.length}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">High Conf. Delete</Typography>
          <Typography variant="h6" fontWeight="bold" color="error">
            � {stats.highConfidenceDelete}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">High Conf. Keep</Typography>
          <Typography variant="h6" fontWeight="bold" color="success.main">
            🟢 {stats.highConfidenceKeep}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Predicted Delete</Typography>
          <Typography variant="h6" fontWeight="bold">{stats.delete}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Predicted Keep</Typography>
          <Typography variant="h6" fontWeight="bold">{stats.keep}</Typography>
        </Box>
      </Box>

      {/* Filter Options */}
      <Box sx={{ mb: 3, p: 2, bgcolor: 'white', borderRadius: 2, border: '1px solid #e0e0e0' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
          <Typography variant="subtitle1" fontWeight="bold">
            Filter Options
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <ToggleButtonGroup
              value={confidenceFilter}
              exclusive
              onChange={(e, newValue) => newValue && setConfidenceFilter(newValue)}
              size="small"
            >
              <ToggleButton value="all">All</ToggleButton>
              <ToggleButton value="high">High (&gt;80%)</ToggleButton>
              <ToggleButton value="medium">Medium (60-80%)</ToggleButton>
              <ToggleButton value="low">Low (&lt;60%)</ToggleButton>
            </ToggleButtonGroup>

            <ToggleButtonGroup
              value={predictionFilter}
              exclusive
              onChange={(e, newValue) => newValue && setPredictionFilter(newValue)}
              size="small"
            >
              <ToggleButton value="all">All</ToggleButton>
              <ToggleButton value="delete">Delete</ToggleButton>
              <ToggleButton value="keep">Keep</ToggleButton>
            </ToggleButtonGroup>
          </Box>
        </Box>

        <Alert severity="info" icon={false} sx={{ mt: 2 }}>
          <Typography variant="body2">
            <strong>Legend:</strong> 🔴 High confidence delete • 🟠 Medium confidence delete • 
            🟢 High confidence keep • 🟡 Medium confidence keep/delete • ⚪ Low confidence keep
          </Typography>
        </Alert>
      </Box>

      {/* Action Buttons */}
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <FormControlLabel
          control={<Checkbox />}
          label={`Select All (${filteredPredictions.length} items)`}
        />
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button variant="outlined" onClick={() => navigate('/ml-management')}>
            Back to ML Management
          </Button>
        </Box>
      </Box>

      {/* Pagination - Top */}
      {totalPages > 1 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
          <Pagination 
            count={totalPages} 
            page={page} 
            onChange={handlePageChange}
            color="primary"
            size="large"
            showFirstButton
            showLastButton
          />
        </Box>
      )}

      {/* Results Grid - 3 Column Layout */}
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
        gap: 2,
      }}>
        {paginatedPredictions.map((item, index) => {
          const isVideo = /\.(mp4|webm|mov|avi|mkv|m4v)$/i.test(item.file_path);
          const confidenceLevel = getConfidenceLevel(item.confidence);
          const icon = getConfidenceIcon(item.prediction, item.confidence);
          const color = item.prediction === 1 ? '#f44336' : '#4caf50';
          
          return (
            <Card key={index} elevation={3} sx={{ display: 'flex', flexDirection: 'column' }}>
              {/* Header with prediction */}
              <Box sx={{
                p: 1,
                bgcolor: item.prediction === 1 ? '#ffebee' : '#e8f5e9',
                borderBottom: '2px solid',
                borderColor: color
              }}>
                <Typography variant="caption" fontWeight="bold" sx={{ fontSize: '0.7rem', color }}>
                  {icon} {item.prediction === 0 ? 'DELETE' : 'KEEP'} • {(item.confidence * 100).toFixed(1)}% confidence
                </Typography>
              </Box>

              <Box sx={{ p: 2 }}>
                {/* Image/Video Preview */}
                <Card 
                  elevation={3} 
                  sx={{ 
                    border: `2px solid ${color}`, 
                    borderRadius: 2, 
                    overflow: 'hidden',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    '&:hover': { transform: 'scale(1.03)' }
                  }}
                  onClick={() => setSelectedImage(item)}
                >
                  <Box sx={{ 
                    position: 'relative', 
                    bgcolor: '#121212', 
                    minHeight: 280,
                    maxHeight: 400,
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    overflow: 'hidden'
                  }}>
                    {isVideo ? (
                      <video 
                        controls 
                        preload="metadata" 
                        style={{ width: '100%', height: 'auto', maxHeight: '400px', objectFit: 'contain' }}
                        src={`/api/files/raw?path=${encodeURIComponent(item.file_path)}`}
                      />
                    ) : (
                      <CardMedia
                        component="img"
                        image={`/api/files/preview?path=${encodeURIComponent(item.file_path)}`}
                        alt={item.file_name}
                        sx={{ 
                          width: 'auto',
                          height: 'auto',
                          maxWidth: '100%',
                          maxHeight: '400px',
                          objectFit: 'contain'
                        }}
                        onError={(e) => {
                          e.target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
                          e.target.style.backgroundColor = '#f0f0f0';
                        }}
                      />
                    )}
                    
                    {/* Model type badge */}
                    <Chip
                      label={item.file_type === 'video' ? '🎬 Video' : '📸 Image'}
                      size="small"
                      sx={{ 
                        position: 'absolute', 
                        top: 6, 
                        left: 6,
                        height: 22,
                        fontSize: '0.65rem',
                        fontWeight: 'bold',
                        bgcolor: item.file_type === 'video' ? '#e3f2fd' : '#f3e5f5',
                        color: item.file_type === 'video' ? '#7e57c2' : '#7b1fa2',
                        boxShadow: 2
                      }}
                    />
                    
                    {/* Confidence badge */}
                    <Chip
                      label={`${(item.confidence * 100).toFixed(0)}%`}
                      color={confidenceLevel === 'high' ? 'success' : confidenceLevel === 'medium' ? 'warning' : 'default'}
                      size="small"
                      sx={{ 
                        position: 'absolute', 
                        bottom: 6, 
                        right: 6,
                        height: 22,
                        fontSize: '0.7rem',
                        fontWeight: 'bold',
                        boxShadow: 2
                      }}
                    />
                  </Box>

                  {/* Filename */}
                  <Box sx={{ p: 0.5, bgcolor: '#121212' }}>
                    <Tooltip title={item.file_path}>
                      <Typography 
                        variant="caption" 
                        sx={{ 
                          fontSize: '0.65rem', 
                          display: 'block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        📁 {item.file_name || 'Unknown file'}
                      </Typography>
                    </Tooltip>
                  </Box>
                </Card>

                {/* Action Buttons */}
                <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
                  <Button
                    fullWidth
                    size="small"
                    variant={item.prediction === 0 ? 'contained' : 'outlined'}
                    startIcon={<CheckCircleIcon />}
                    color="success"
                    onClick={() => console.log('Keep', item.file_path)}
                    sx={{ fontSize: '0.7rem', py: 0.5 }}
                  >
                    Keep
                  </Button>
                  <Button
                    fullWidth
                    size="small"
                    variant={item.prediction === 1 ? 'contained' : 'outlined'}
                    startIcon={<CancelIcon />}
                    color="error"
                    onClick={() => console.log('Delete', item.file_path)}
                    sx={{ fontSize: '0.7rem', py: 0.5 }}
                  >
                    Delete
                  </Button>
                </Box>
              </Box>
            </Card>
          );
        })}
      </Box>

      {/* Pagination - Bottom */}
      {totalPages > 1 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
          <Pagination 
            count={totalPages} 
            page={page} 
            onChange={handlePageChange}
            color="primary"
            size="large"
            showFirstButton
            showLastButton
          />
        </Box>
      )}

      {filteredPredictions.length === 0 && (
        <Alert severity="info" sx={{ mt: 2 }}>
          No predictions match the current filters.
        </Alert>
      )}

      {/* Image Preview Dialog */}
      <Dialog
        open={!!selectedImage}
        onClose={() => setSelectedImage(null)}
        maxWidth="lg"
        fullWidth
      >
        <IconButton
          onClick={() => setSelectedImage(null)}
          sx={{ position: 'absolute', right: 8, top: 8, color: 'white', bgcolor: 'rgba(0,0,0,0.5)' }}
        >
          <CloseIcon />
        </IconButton>
        <DialogContent sx={{ p: 0, bgcolor: 'black' }}>
          {selectedImage && (
            <Box>
              <img
                src={`/api/files/raw?path=${encodeURIComponent(selectedImage.file_path)}`}
                alt={selectedImage.file_name}
                style={{ width: '100%', height: 'auto', display: 'block' }}
              />
              <Box sx={{ p: 2, bgcolor: 'white' }}>
                <Typography variant="h6">{selectedImage.file_name}</Typography>
                <Box sx={{ mt: 2, display: 'flex', gap: 2 }}>
                  <Chip
                    label={selectedImage.prediction === 1 ? 'DELETE' : 'KEEP'}
                    color={getConfidenceColor(selectedImage.prediction, selectedImage.confidence)}
                  />
                  <Chip
                    label={`Confidence: ${(selectedImage.confidence * 100).toFixed(1)}%`}
                    variant="outlined"
                  />
                </Box>
              </Box>
            </Box>
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
}

export default MLPredictionResultsPage;
