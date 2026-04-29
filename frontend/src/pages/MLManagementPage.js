import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container,
  Box,
  Typography,
  Paper,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  LinearProgress,
  Alert,
  Tabs,
  Tab,
  Card,
  CardContent,
  Grid,
  TextField,
  FormControlLabel,
  Checkbox,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Divider,
  CircularProgress,
  ToggleButton,
  ToggleButtonGroup
} from '@mui/material';
import {
  Psychology as BrainIcon,
  Delete as DeleteIcon,
  CheckCircle as ActiveIcon,
  PlayArrow as TrainIcon,
  Visibility as TestIcon,
  Add as AddIcon,
  Remove as RemoveIcon,
  TrendingUp as StatsIcon,
  Assessment as MetricsIcon
} from '@mui/icons-material';

function MLManagementPage({ basePath }) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(0);
  const [models, setModels] = useState([]);
  const [activeModel, setActiveModel] = useState(null);
  const [performers, setPerformers] = useState([]);
  const [performerStats, setPerformerStats] = useState([]);
  const [includedPerformersImage, setIncludedPerformersImage] = useState([]);
  const [includedPerformersVideo, setIncludedPerformersVideo] = useState([]);
  const [includedPerformersBoth, setIncludedPerformersBoth] = useState([]);
  const [trainingStats, setTrainingStats] = useState(null);
  const [loading, setLoading] = useState(true);
  
  // Test predictions filter
  const [testLocationFilter, setTestLocationFilter] = useState('all'); // 'all', 'before', 'after'
  const [testDataFilter, setTestDataFilter] = useState('all'); // 'all', 'with-data', 'no-data'
  
  // Model type selection for training
  const [selectedModelType, setSelectedModelType] = useState('both'); // 'image', 'video', 'both'
  
  // Helper to get current included list based on selected model type
  const getCurrentIncludedList = () => {
    if (selectedModelType === 'image') return includedPerformersImage;
    if (selectedModelType === 'video') return includedPerformersVideo;
    return includedPerformersBoth;
  };
  
  // Training dialog
  const [trainingDialog, setTrainingDialog] = useState(false);
  const [trainingInProgress, setTrainingInProgress] = useState(false);
  const [trainingJobId, setTrainingJobId] = useState(null);
  const [trainingProgress, setTrainingProgress] = useState(0);
  const [trainingStatus, setTrainingStatus] = useState('');
  
  // Test dialog - removed (will navigate to results page instead)
  const [testLoading, setTestLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (activeTab === 0) {
      loadModels();
    } else if (activeTab === 1) {
      loadTrainingData();
    }
  }, [activeTab]);

  const loadData = async () => {
    try {
      setLoading(true);
      await Promise.all([
        loadModels(),
        loadPerformers(),
        loadPerformerStats(),
        loadIncludedPerformers(),
        loadTrainingData()
      ]);
    } catch (err) {
      console.error('Error loading data:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadModels = async () => {
    try {
      const [modelsRes, activeRes] = await Promise.all([
        fetch('/api/ml/models'),
        fetch('/api/ml/models/active')
      ]);
      
      if (modelsRes.ok) {
        const data = await modelsRes.json();
        setModels(data.models || []);
      }
      
      if (activeRes.ok) {
        const data = await activeRes.json();
        setActiveModel(data.model);
      }
    } catch (err) {
      console.error('Error loading models:', err);
    }
  };

  const loadPerformers = async () => {
    try {
      const res = await fetch('/api/performers');
      if (res.ok) {
        const data = await res.json();
        // The API returns an array directly, not an object with performers property
        setPerformers(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Error loading performers:', err);
    }
  };

  const loadPerformerStats = async () => {
    try {
      const res = await fetch('/api/ml/performer-stats');
      if (res.ok) {
        const data = await res.json();
        console.log('Performer stats loaded:', data.stats);
        setPerformerStats(data.stats || []);
      }
    } catch (err) {
      console.error('Error loading performer stats:', err);
    }
  };

  const loadIncludedPerformers = async () => {
    try {
      const res = await fetch('/api/ml/included-performers');
      if (res.ok) {
        const data = await res.json();
        const all = data.included || [];
        setIncludedPerformersImage(all.filter(p => p.model_type === 'image'));
        setIncludedPerformersVideo(all.filter(p => p.model_type === 'video'));
        setIncludedPerformersBoth(all.filter(p => p.model_type === 'both'));
      }
    } catch (err) {
      console.error('Error loading included performers:', err);
    }
  };

  const loadTrainingData = async () => {
    try {
      // Combine all included performers from all model types
      const allIncluded = [...includedPerformersImage, ...includedPerformersVideo, ...includedPerformersBoth];
      const uniqueIds = [...new Set(allIncluded.map(e => e.performer_id))];
      const res = await fetch(`/api/ml/training-stats?includedPerformers=${JSON.stringify(uniqueIds)}`);
      if (res.ok) {
        const data = await res.json();
        setTrainingStats(data.stats);
      }
    } catch (err) {
      console.error('Error loading training data:', err);
    }
  };

  const handleIncludePerformer = async (performerId) => {
    try {
      const res = await fetch('/api/ml/include-performer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          performerId,
          modelType: selectedModelType
        })
      });
      
      if (res.ok) {
        await loadIncludedPerformers();
        await loadTrainingData();
      }
    } catch (err) {
      console.error('Error including performer:', err);
    }
  };

  const handleExcludePerformer = async (performerId) => {
    try {
      const res = await fetch(`/api/ml/include-performer/${performerId}`, {
        method: 'DELETE'
      });
      
      if (res.ok) {
        await loadIncludedPerformers();
        await loadTrainingData();
      }
    } catch (err) {
      console.error('Error excluding performer:', err);
    }
  };

  const handleStartTraining = async () => {
    if (!basePath) {
      alert('Base path not set');
      return;
    }

    try {
      setTrainingInProgress(true);
      setTrainingProgress(0);
      setTrainingStatus('Starting training...');
      
      const res = await fetch('/api/ml/train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ basePath })
      });
      
      if (!res.ok) {
        throw new Error('Failed to start training');
      }
      
      const data = await res.json();
      setTrainingJobId(data.jobId);
      
      // Poll for progress
      pollTrainingProgress(data.jobId);
    } catch (err) {
      console.error('Error starting training:', err);
      alert('Failed to start training: ' + err.message);
      setTrainingInProgress(false);
    }
  };

  const pollTrainingProgress = (jobId) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/ml/training-job/${jobId}`);
        if (res.ok) {
          const data = await res.json();
          const job = data.job;
          
          setTrainingProgress(job.progress || 0);
          setTrainingStatus(job.status || 'running');
          
          if (job.status === 'completed') {
            clearInterval(interval);
            setTrainingInProgress(false);
            setTrainingDialog(false);
            await loadModels();
            alert('Training completed successfully!');
          } else if (job.status === 'failed') {
            clearInterval(interval);
            setTrainingInProgress(false);
            alert('Training failed: ' + (job.error || 'Unknown error'));
          }
        }
      } catch (err) {
        console.error('Error polling training:', err);
      }
    }, 1000);
  };

  const handleActivateModel = async (modelId) => {
    try {
      const res = await fetch(`/api/ml/models/${modelId}/activate`, {
        method: 'POST'
      });
      
      if (res.ok) {
        await loadModels();
      }
    } catch (err) {
      console.error('Error activating model:', err);
    }
  };

  const handleDeleteModel = async (modelId) => {
    if (!window.confirm('Delete this model?')) return;
    
    try {
      const res = await fetch(`/api/ml/models/${modelId}`, {
        method: 'DELETE'
      });
      
      if (res.ok) {
        await loadModels();
      }
    } catch (err) {
      console.error('Error deleting model:', err);
    }
  };

  const handleTestModel = async (performerId, performerName) => {
    if (!activeModel) {
      alert('No active model selected');
      return;
    }

    try {
      setTestLoading(true);
      const res = await fetch(`/api/ml/predict/${performerId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: activeModel.id })
      });
      
      if (res.ok) {
        const data = await res.json();
        console.log('Test predictions response:', data);
        console.log('Predictions count:', data.predictions?.length || 0);
        
        // Navigate to ML prediction results page (similar to hash results)
        navigate(`/ml-predictions/${performerId}`, { 
          state: { 
            predictions: data.predictions,
            performerName,
            modelId: activeModel.id,
            modelName: activeModel.name
          } 
        });
      } else {
        const error = await res.text();
        console.error('Error response:', error);
        alert('Failed to generate predictions: ' + error);
      }
    } catch (err) {
      console.error('Error testing model:', err);
      alert('Failed to generate predictions');
    } finally {
      setTestLoading(false);
    }
  };

  const renderModelsTab = () => {
    // Group models by base ID (strip _image/_video suffix)
    const modelSessions = {};
    models.forEach(model => {
      const baseId = model.id.replace(/_image$/, '').replace(/_video$/, '');
      const isDualModel = model.id.endsWith('_image') || model.id.endsWith('_video');
      
      if (!modelSessions[baseId]) {
        modelSessions[baseId] = {
          baseId,
          imageModel: null,
          videoModel: null,
          legacyModel: null,
          created_at: model.created_at,
          is_active: model.is_active,
          name: model.name ? model.name.replace(/ \((Image|Video)\)$/, '') : baseId,
          isDual: isDualModel
        };
      }
      
      if (model.id.endsWith('_image')) {
        modelSessions[baseId].imageModel = model;
      } else if (model.id.endsWith('_video')) {
        modelSessions[baseId].videoModel = model;
      }
    });

    // Filter out sessions that don't have at least one model
    const sessionsList = Object.values(modelSessions)
      .filter(s => s.imageModel || s.videoModel)
      .sort((a, b) => b.created_at - a.created_at);

    return (
      <Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}>
          <Typography variant="h6">Trained Models</Typography>
          <Button
            variant="contained"
            startIcon={<TrainIcon />}
            onClick={() => setTrainingDialog(true)}
            disabled={!basePath}
          >
            Train New Model
          </Button>
        </Box>

        {sessionsList.length === 0 ? (
          <Alert severity="info">
            No models trained yet. Click "Train New Model" to get started.
          </Alert>
        ) : (
          <Grid container spacing={3}>
            {sessionsList.map((session) => (
              <Grid item xs={12} key={session.baseId}>
                <Card>
                  <CardContent>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {session.is_active === 1 && (
                          <ActiveIcon color="success" fontSize="small" />
                        )}
                        <Typography variant="h6">{session.name}</Typography>
                        <Typography variant="caption" color="textSecondary">
                          {new Date(session.created_at * 1000).toLocaleString()}
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', gap: 1 }}>
                        {session.is_active !== 1 && (
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => handleActivateModel(session.imageModel?.id || session.videoModel?.id)}
                          >
                            Activate
                          </Button>
                        )}
                        <IconButton
                          size="small"
                          onClick={() => handleDeleteModel(session.imageModel?.id || session.videoModel?.id)}
                          color="error"
                        >
                          <DeleteIcon />
                        </IconButton>
                      </Box>
                    </Box>

                    <Grid container spacing={2}>
                      {/* Show warning if only one model exists */}
                      {(!session.imageModel || !session.videoModel) && (
                        <Grid item xs={12}>
                          <Alert severity="info" sx={{ mb: 1 }}>
                            {!session.videoModel && 'Video model not trained (insufficient video samples with CLIP embeddings)'}
                            {!session.imageModel && 'Image model not trained (insufficient image samples with CLIP embeddings)'}
                          </Alert>
                        </Grid>
                      )}
                      
                      {/* Image Model Card */}
                      {session.imageModel && (
                        <Grid item xs={12} md={session.videoModel ? 6 : 12}>
                          <Paper variant="outlined" sx={{ p: 2, bgcolor: '#121212' }}>
                            <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
                              📸 Image Model
                              <Chip
                                label={session.imageModel.status || 'unknown'}
                                color={session.imageModel.status === 'completed' ? 'success' : 'default'}
                                size="small"
                              />
                            </Typography>
                            <Box sx={{ mt: 2 }}>
                              <Typography variant="body2" color="textSecondary">
                                <strong>Accuracy:</strong> {session.imageModel.accuracy ? `${(session.imageModel.accuracy * 100).toFixed(1)}%` : 'N/A'}
                              </Typography>
                              <Typography variant="body2" color="textSecondary">
                                <strong>Training Samples:</strong> {session.imageModel.training_samples || 0}
                              </Typography>
                              <Typography variant="body2" color="textSecondary">
                                <strong>Deleted/Kept:</strong> {session.imageModel.training_deleted_samples || 0} / {session.imageModel.training_kept_samples || 0}
                              </Typography>
                              <Typography variant="caption" color="textSecondary" display="block" sx={{ mt: 1, fontStyle: 'italic' }}>
                                Single-frame CLIP embeddings
                              </Typography>
                            </Box>
                          </Paper>
                        </Grid>
                      )}

                      {/* Video Model Card */}
                      {session.videoModel && (
                        <Grid item xs={12} md={session.imageModel ? 6 : 12}>
                          <Paper variant="outlined" sx={{ p: 2, bgcolor: '#121212' }}>
                            <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
                              🎬 Video Model
                              <Chip
                                label={session.videoModel.status || 'unknown'}
                                color={session.videoModel.status === 'completed' ? 'success' : 'default'}
                                size="small"
                              />
                            </Typography>
                            <Box sx={{ mt: 2 }}>
                              <Typography variant="body2" color="textSecondary">
                                <strong>Accuracy:</strong> {session.videoModel.accuracy ? `${(session.videoModel.accuracy * 100).toFixed(1)}%` : 'N/A'}
                              </Typography>
                              <Typography variant="body2" color="textSecondary">
                                <strong>Training Samples:</strong> {session.videoModel.training_samples || 0}
                              </Typography>
                              <Typography variant="body2" color="textSecondary">
                                <strong>Deleted/Kept:</strong> {session.videoModel.training_deleted_samples || 0} / {session.videoModel.training_kept_samples || 0}
                              </Typography>
                              <Typography variant="caption" color="textSecondary" display="block" sx={{ mt: 1, fontStyle: 'italic' }}>
                                ~30 frames/video (adaptive 5-30s intervals)
                              </Typography>
                            </Box>
                          </Paper>
                        </Grid>
                      )}
                    </Grid>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        )}
      </Box>
    );
  };

  const renderTrainingDataTab = () => (
    <Box>
      <Typography variant="h6" gutterBottom>Training Data Overview</Typography>
      
      {trainingStats && (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={12} md={2}>
            <Card>
              <CardContent>
                <Typography color="textSecondary" gutterBottom variant="caption">
                  Total Samples
                </Typography>
                <Typography variant="h4">{trainingStats.total}</Typography>
                <Typography variant="caption" color="textSecondary">
                  {trainingStats.image_samples || 0} images • {trainingStats.video_samples || 0} videos
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={2}>
            <Card>
              <CardContent>
                <Typography color="textSecondary" gutterBottom variant="caption">
                  Deleted
                </Typography>
                <Typography variant="h4" color="error">
                  {trainingStats.deleted}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={2}>
            <Card>
              <CardContent>
                <Typography color="textSecondary" gutterBottom variant="caption">
                  Kept
                </Typography>
                <Typography variant="h4" color="success.main">
                  {trainingStats.kept}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={2}>
            <Card>
              <CardContent>
                <Typography color="textSecondary" gutterBottom variant="caption">
                  📸 Image Balance
                </Typography>
                <Typography variant="h4" color="warning.main">
                  {trainingStats.image_balance || 0}%
                </Typography>
                <Typography variant="caption" color="textSecondary">
                  {trainingStats.image_deleted || 0} del / {trainingStats.image_kept || 0} kept
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={2}>
            <Card>
              <CardContent>
                <Typography color="textSecondary" gutterBottom variant="caption">
                  🎬 Video Balance
                </Typography>
                <Typography variant="h4" color="warning.main">
                  {trainingStats.video_balance || 0}%
                </Typography>
                <Typography variant="caption" color="textSecondary">
                  {trainingStats.video_deleted || 0} del / {trainingStats.video_kept || 0} kept
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={2}>
            <Card>
              <CardContent>
                <Typography color="textSecondary" gutterBottom variant="caption">
                  CLIP Ready
                </Typography>
                <Typography variant="h4" color="primary">
                  {trainingStats.files_with_clip || 0}
                </Typography>
                <Typography variant="caption" color="textSecondary">
                  embeddings
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>
          Performer Inclusion/Exclusion
        </Typography>
        <Typography variant="body2" color="textSecondary" paragraph>
          Include performers in training data. Select performers whose content should be used to train the ML models.
        </Typography>

        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" gutterBottom>
            Training Mode:
          </Typography>
          <ToggleButtonGroup
            value={selectedModelType}
            exclusive
            onChange={(e, newValue) => newValue && setSelectedModelType(newValue)}
            size="small"
          >
            <ToggleButton value="both">
              📸 + 🎬 Both Models
            </ToggleButton>
            <ToggleButton value="image">
              📸 Image Only
            </ToggleButton>
            <ToggleButton value="video">
              🎬 Video Only
            </ToggleButton>
          </ToggleButtonGroup>
          <Typography variant="caption" display="block" sx={{ mt: 1 }} color="textSecondary">
            {selectedModelType === 'both' && 'Performers will be included in both image and video model training'}
            {selectedModelType === 'image' && 'Performers will only be included in image model training'}
            {selectedModelType === 'video' && 'Performers will only be included in video model training'}
          </Typography>
        </Box>

        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <Typography variant="subtitle2" gutterBottom>
              Excluded Performers ({performers.length - includedPerformersImage.length - includedPerformersVideo.length - includedPerformersBoth.length})
            </Typography>
            <Paper variant="outlined" sx={{ maxHeight: 400, overflow: 'auto' }}>
              <List dense>
                {performerStats
                  .filter(p => {
                    const inImage = includedPerformersImage.find(e => e.performer_id === p.id);
                    const inVideo = includedPerformersVideo.find(e => e.performer_id === p.id);
                    const inBoth = includedPerformersBoth.find(e => e.performer_id === p.id);
                    return !inImage && !inVideo && !inBoth;
                  })
                  .map(performer => (
                    <ListItem key={performer.id}>
                      <ListItemText
                        primary={performer.name}
                        secondary={
                          <span>
                            {performer.total_samples} samples ({performer.image_samples || 0} images, {performer.video_samples || 0} videos)
                            <br />
                            <span style={{ color: '#f44336' }}>{performer.deleted_samples} deleted</span> / 
                            <span style={{ color: '#4caf50' }}> {performer.kept_samples} kept</span>
                            {' • '}
                            <strong>{performer.balance.toFixed(1)}% deleted</strong>
                            <br />
                            <span style={{ fontSize: '0.75rem', color: '#666' }}>
                              CLIP: {performer.image_clips || 0} images, {performer.video_clips || 0} videos
                            </span>
                          </span>
                        }
                      />
                      <ListItemSecondaryAction>
                        <IconButton
                          edge="end"
                          onClick={() => handleIncludePerformer(performer.id)}
                          size="small"
                          color="primary"
                        >
                          <AddIcon />
                        </IconButton>
                      </ListItemSecondaryAction>
                    </ListItem>
                  ))}
              </List>
            </Paper>
          </Grid>

          <Grid item xs={12} md={6}>
            <Typography variant="subtitle2" gutterBottom>
              Included Performers ({getCurrentIncludedList().length}) - {selectedModelType === 'image' ? '📸 Image Only' : selectedModelType === 'video' ? '🎬 Video Only' : '📸🎬 Both Models'}
            </Typography>
            <Paper variant="outlined" sx={{ maxHeight: 400, overflow: 'auto' }}>
              <List dense>
                {performerStats
                  .filter(p => getCurrentIncludedList().find(e => e.performer_id === p.id))
                  .map(performer => {
                    return (
                      <ListItem key={performer.id}>
                        <ListItemText
                          primary={performer.name}
                          secondary={
                            <span>
                              {performer.total_samples} samples ({performer.image_samples || 0} images, {performer.video_samples || 0} videos)
                              <br />
                              <span style={{ color: '#f44336' }}>{performer.deleted_samples} deleted</span> / 
                              <span style={{ color: '#4caf50' }}> {performer.kept_samples} kept</span>
                              {' • '}
                              <strong>{performer.balance.toFixed(1)}% deleted</strong>
                              <br />
                              <span style={{ fontSize: '0.75rem', color: '#666' }}>
                                CLIP: {performer.image_clips || 0} images, {performer.video_clips || 0} videos
                              </span>
                            </span>
                          }
                        />
                        <ListItemSecondaryAction>
                          <IconButton
                            edge="end"
                            onClick={() => handleExcludePerformer(performer.id)}
                            size="small"
                          >
                            <RemoveIcon />
                          </IconButton>
                        </ListItemSecondaryAction>
                      </ListItem>
                    );
                  })}
              </List>
            </Paper>
          </Grid>
        </Grid>
      </Paper>
    </Box>
  );

  const renderTestTab = () => {
    // Filter performers by location and data availability
    let filteredPerformers = performers.filter(p => {
      // Location filter
      if (testLocationFilter === 'before' && p.moved_to_after === 1) return false;
      if (testLocationFilter === 'after' && p.moved_to_after !== 1) return false;
      
      // Data filter (>1 hash means has data)
      const stats = performerStats.find(s => s.id === p.id);
      const hashCount = stats ? stats.total_samples : 0;
      const hasData = hashCount > 1;
      
      if (testDataFilter === 'with-data' && !hasData) return false;
      if (testDataFilter === 'no-data' && hasData) return false;
      
      return true;
    });

    // Count performers with and without data
    const performersWithData = performers.filter(p => {
      const stats = performerStats.find(s => s.id === p.id);
      const hashCount = stats ? stats.total_samples : 0;
      return hashCount > 1;
    });
    const performersNoData = performers.length - performersWithData.length;

    return (
      <Box>
        <Typography variant="h6" gutterBottom>Test Model Predictions</Typography>
        
        {!activeModel ? (
          <Alert severity="warning">
            No active model selected. Please activate a model first.
          </Alert>
        ) : (
          <Box>
            <Alert severity="info" sx={{ mb: 3 }}>
              Active Model: <strong>{activeModel.name ? activeModel.name.replace(/ \((Image|Video)\)$/, '') : activeModel.id}</strong>
              {' - '}
              Using dual-model system (📸 Image + 🎬 Video models)
            </Alert>

            <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="subtitle2">
                  Location:
                </Typography>
                <ToggleButtonGroup
                  value={testLocationFilter}
                  exclusive
                  onChange={(e, newValue) => newValue && setTestLocationFilter(newValue)}
                  size="small"
                >
                  <ToggleButton value="all">
                    All ({performers.length})
                  </ToggleButton>
                  <ToggleButton value="before">
                    Before ({performers.filter(p => p.moved_to_after !== 1).length})
                  </ToggleButton>
                  <ToggleButton value="after">
                    After ({performers.filter(p => p.moved_to_after === 1).length})
                  </ToggleButton>
                </ToggleButtonGroup>
              </Box>

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="subtitle2">
                  Data:
                </Typography>
                <ToggleButtonGroup
                  value={testDataFilter}
                  exclusive
                  onChange={(e, newValue) => newValue && setTestDataFilter(newValue)}
                  size="small"
                >
                  <ToggleButton value="all">
                    All ({performers.length})
                  </ToggleButton>
                  <ToggleButton value="with-data">
                    With Data ({performersWithData.length})
                  </ToggleButton>
                  <ToggleButton value="no-data">
                    No Data ({performersNoData})
                  </ToggleButton>
                </ToggleButtonGroup>
              </Box>
            </Box>

            <Typography variant="subtitle2" gutterBottom>
              Select a performer to test predictions ({filteredPerformers.length} shown):
            </Typography>
            
            <Grid container spacing={2}>
              {filteredPerformers.map(performer => {
                const stats = performerStats.find(s => s.id === performer.id);
                const hashCount = stats ? stats.total_samples : 0;
                const hasData = hashCount > 1;
                
                return (
                  <Grid item xs={12} sm={6} md={4} key={performer.id}>
                    <Card sx={{ opacity: hasData ? 1 : 0.5 }}>
                      <CardContent>
                        <Typography variant="h6" gutterBottom>
                          {performer.name}
                        </Typography>
                        <Typography variant="body2" color="textSecondary">
                          {performer.pics_count} pics, {performer.vids_count} vids
                        </Typography>
                        <Typography variant="body2" color={hasData ? "textSecondary" : "error"}>
                          {hashCount} hash{hashCount !== 1 ? 'es' : ''} {!hasData && '(insufficient data)'}
                        </Typography>
                        <Chip 
                          label={performer.moved_to_after === 1 ? 'After Filter' : 'Before Filter'}
                          size="small"
                          color={performer.moved_to_after === 1 ? 'success' : 'default'}
                          sx={{ mt: 1 }}
                        />
                        <Button
                          fullWidth
                          variant="outlined"
                          startIcon={<TestIcon />}
                          onClick={() => handleTestModel(performer.id, performer.name)}
                          disabled={testLoading || !hasData}
                          sx={{ mt: 2 }}
                        >
                          Test Predictions
                        </Button>
                      </CardContent>
                    </Card>
                  </Grid>
                );
              })}
            </Grid>
          </Box>
        )}
      </Box>
    );
  };

  if (loading) {
    return (
      <Container sx={{ mt: 4, textAlign: 'center' }}>
        <CircularProgress />
      </Container>
    );
  }

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <BrainIcon sx={{ fontSize: 40, mr: 2 }} />
        <Typography variant="h4">ML Model Management</Typography>
      </Box>

      <Paper sx={{ mb: 3 }}>
        <Tabs value={activeTab} onChange={(e, v) => setActiveTab(v)}>
          <Tab label="Models" icon={<MetricsIcon />} iconPosition="start" />
          <Tab label="Training Data" icon={<StatsIcon />} iconPosition="start" />
          <Tab label="Test Predictions" icon={<TestIcon />} iconPosition="start" />
        </Tabs>
      </Paper>

      <Box sx={{ mt: 3 }}>
        {activeTab === 0 && renderModelsTab()}
        {activeTab === 1 && renderTrainingDataTab()}
        {activeTab === 2 && renderTestTab()}
      </Box>

      {/* Training Dialog */}
      <Dialog open={trainingDialog} onClose={() => !trainingInProgress && setTrainingDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Train New Model</DialogTitle>
        <DialogContent>
          {!trainingInProgress ? (
            <Box>
              <Alert severity="info" sx={{ mb: 2 }}>
                This will train a new XGBoost model using CLIP embeddings from your current filtering decisions.
              </Alert>
              
              {trainingStats && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" gutterBottom>Training Data Summary:</Typography>
                  <Typography variant="body2">
                    • Total samples: {trainingStats.total}<br />
                    • Deleted: {trainingStats.deleted}<br />
                    • Kept: {trainingStats.kept}<br />
                    • Balance: {trainingStats.balance}% deleted
                  </Typography>
                </Box>
              )}
              
              {trainingStats && trainingStats.total < 10 && (
                <Alert severity="error">
                  Insufficient training data. Need at least 10 samples.
                </Alert>
              )}
            </Box>
          ) : (
            <Box>
              <Typography variant="body2" gutterBottom>
                {trainingStatus}
              </Typography>
              <LinearProgress variant="determinate" value={trainingProgress} sx={{ mt: 2 }} />
              <Typography variant="caption" display="block" textAlign="center" sx={{ mt: 1 }}>
                {trainingProgress}%
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTrainingDialog(false)} disabled={trainingInProgress}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleStartTraining}
            disabled={trainingInProgress || !trainingStats || trainingStats.total < 10}
          >
            Start Training
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}

export default MLManagementPage;
