import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  TextField,
  Autocomplete,
  Chip,
  Alert,
  LinearProgress,
  Divider,
  Stack,
  Card,
  CardContent,
  Switch,
  FormControlLabel,
  Grid,
  Tooltip,
  Collapse,
  ToggleButton,
  ToggleButtonGroup,
  Slider,
  InputAdornment,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import QueueIcon from '@mui/icons-material/Queue';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import SettingsIcon from '@mui/icons-material/Settings';
import RestoreIcon from '@mui/icons-material/Restore';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ImageIcon from '@mui/icons-material/Image';
import VideoLibraryIcon from '@mui/icons-material/VideoLibrary';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import MovieIcon from '@mui/icons-material/Movie';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import ReplayIcon from '@mui/icons-material/Replay';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';

const QUEUE_STORAGE_KEY = 'ml_batch_queue';
const QUEUE_STATE_KEY = 'ml_batch_queue_state';
const VIDEO_QUEUE_STORAGE_KEY = 'video_batch_queue';

// Default window sizes based on video duration (in seconds)
const DEFAULT_WINDOW_SIZES = {
  short: { maxDuration: 300, windowSize: 30 },      // < 5 min: 30s windows
  medium: { maxDuration: 1800, windowSize: 60 },    // 5-30 min: 60s windows
  long: { maxDuration: 7200, windowSize: 120 },     // 30-120 min: 2 min windows
  veryLong: { maxDuration: Infinity, windowSize: 180 } // > 2 hours: 3 min windows
};

function getDefaultWindowSize(durationSeconds) {
  if (durationSeconds <= DEFAULT_WINDOW_SIZES.short.maxDuration) return DEFAULT_WINDOW_SIZES.short.windowSize;
  if (durationSeconds <= DEFAULT_WINDOW_SIZES.medium.maxDuration) return DEFAULT_WINDOW_SIZES.medium.windowSize;
  if (durationSeconds <= DEFAULT_WINDOW_SIZES.long.maxDuration) return DEFAULT_WINDOW_SIZES.long.windowSize;
  return DEFAULT_WINDOW_SIZES.veryLong.windowSize;
}

function formatDuration(seconds) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function BatchQueuePage({ basePath }) {
  // Mode toggle: 'image' or 'video'
  const [mode, setMode] = useState('image');
  
  // Image mode state
  const [performers, setPerformers] = useState([]);
  const [performersWithResults, setPerformersWithResults] = useState(new Set()); // Track performers with saved batch results
  const [queue, setQueue] = useState([]);
  const [selectedPerformer, setSelectedPerformer] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [currentPerformer, setCurrentPerformer] = useState(null);
  const [progress, setProgress] = useState({ current: 0, total: 0, status: '' });
  const [autoOpenTabs, setAutoOpenTabs] = useState(true);
  const [reuseTab, setReuseTab] = useState(false);
  const processingRef = useRef(false);
  const abortRef = useRef(false);
  const processingWindowRef = useRef(null);
  
  // Batch settings (images)
  const [batchSize, setBatchSize] = useState(4);
  const [concurrency, setConcurrency] = useState(1);
  const [secureMode, setSecureMode] = useState(false);
  const [runMode, setRunMode] = useState('unpredicted'); // 'all' or 'unpredicted'
  const [showSettings, setShowSettings] = useState(false);
  
  // Recoverable sessions
  const [recoverableSessions, setRecoverableSessions] = useState([]);
  const [showRecovery, setShowRecovery] = useState(false);
  
  // Video mode state
  const [videoQueue, setVideoQueue] = useState([]);
  const [videoRunMode, setVideoRunMode] = useState('unprocessed'); // 'all' or 'unprocessed'
  const [windowMultiplier, setWindowMultiplier] = useState(1.0);
  const [showVideoSettings, setShowVideoSettings] = useState(false);
  const [customFolderPath, setCustomFolderPath] = useState('');
  const [selectedVideoPerformer, setSelectedVideoPerformer] = useState(null);
  const [videoServiceStatus, setVideoServiceStatus] = useState({ running: false, checked: false });
  const [isVideoRunning, setIsVideoRunning] = useState(false);
  const [currentVideo, setCurrentVideo] = useState(null);
  const [videoProgress, setVideoProgress] = useState({ current: 0, total: 0, status: '' });
  const videoProcessingRef = useRef(false);
  const videoAbortRef = useRef(false);
  const [expandedVideoItems, setExpandedVideoItems] = useState({}); // Track which items are expanded
  const [requeueDialog, setRequeueDialog] = useState({ open: false, video: null, queueItemId: null, actionLabels: '' });
  
  // Example durations for window size preview
  const exampleDurations = [300, 1800, 3600, 7200]; // 5min, 30min, 1hr, 2hr

  // Load batch settings from server
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await fetch('/api/ml/batch-settings');
        const data = await response.json();
        if (data.success && data.settings) {
          setBatchSize(data.settings.batchSize || 4);
          setConcurrency(data.settings.concurrency || 1);
          setSecureMode(data.settings.secureMode || false);
        }
      } catch (error) {
        console.error('Failed to load batch settings:', error);
      }
    };
    loadSettings();
  }, []);
  
  // Save batch settings to server when changed
  const saveSettings = async () => {
    try {
      await fetch('/api/ml/batch-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchSize, concurrency, secureMode })
      });
    } catch (error) {
      console.error('Failed to save batch settings:', error);
    }
  };
  
  // Load recoverable sessions
  const loadRecoverableSessions = async () => {
    try {
      const response = await fetch('/api/ml/all-batch-states');
      const data = await response.json();
      if (data.success) {
        setRecoverableSessions(data.states || []);
      }
    } catch (error) {
      console.error('Failed to load recoverable sessions:', error);
    }
  };
  
  useEffect(() => {
    loadRecoverableSessions();
  }, []);

  // Load queue from localStorage on mount
  useEffect(() => {
    const savedQueue = localStorage.getItem(QUEUE_STORAGE_KEY);
    if (savedQueue) {
      try {
        setQueue(JSON.parse(savedQueue));
      } catch (e) {
        console.error('Failed to load queue:', e);
      }
    }
    
    const savedState = localStorage.getItem(QUEUE_STATE_KEY);
    if (savedState) {
      try {
        const state = JSON.parse(savedState);
        setIsRunning(state.isRunning || false);
        setCurrentPerformer(state.currentPerformer || null);
      } catch (e) {
        console.error('Failed to load queue state:', e);
      }
    }
  }, []);

  // Save queue to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
  }, [queue]);

  // Save running state
  useEffect(() => {
    localStorage.setItem(QUEUE_STATE_KEY, JSON.stringify({
      isRunning,
      currentPerformer
    }));
  }, [isRunning, currentPerformer]);

  // Load performers list (same approach as MLTrainingPage)
  useEffect(() => {
    const loadPerformers = async () => {
      if (!basePath) return;
      try {
        const [dbResponse, scanResponse] = await Promise.all([
          fetch('/api/performers'),
          fetch('/api/folders/scan')
        ]);
        
        const dbPerformers = await dbResponse.json();
        const scanData = await scanResponse.json();
        const newPerformers = scanData.newPerformers || [];
        
        // Combine lists
        const combined = [...(Array.isArray(dbPerformers) ? dbPerformers : [])];
        
        // Add new performers that aren't in DB yet
        newPerformers.forEach(np => {
          if (!combined.find(p => p.name === np.name)) {
            combined.push({
              id: `temp_${np.name}`,
              name: np.name,
              pics_count: np.stats?.pics_count || 0,
              isNew: true
            });
          }
        });
        
        // Sort by pics_count (lowest first for batch processing)
        combined.sort((a, b) => (a.pics_count || 0) - (b.pics_count || 0));
        
        setPerformers(combined);
      } catch (error) {
        console.error('Failed to load performers:', error);
      }
    };
    loadPerformers();
  }, [basePath]);

  // Load performers with saved batch results
  useEffect(() => {
    const loadPerformersWithResults = async () => {
      try {
        const response = await fetch('/api/ml/all-batch-states');
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.states) {
            const names = new Set(data.states.map(s => s.name || s.performer_name).filter(Boolean));
            setPerformersWithResults(names);
          }
        }
      } catch (error) {
        console.error('Failed to load performers with results:', error);
      }
    };
    loadPerformersWithResults();
  }, []);

  // Video mode: Check video service status
  useEffect(() => {
    const checkVideoService = async () => {
      try {
        const response = await fetch('/api/video-analysis/health');
        const data = await response.json();
        setVideoServiceStatus({ running: data.running, checked: true });
      } catch (error) {
        setVideoServiceStatus({ running: false, checked: true });
      }
    };
    checkVideoService();
    // Re-check every 30 seconds
    const interval = setInterval(checkVideoService, 30000);
    return () => clearInterval(interval);
  }, []);

  // Video mode: Load video queue from localStorage
  useEffect(() => {
    const savedVideoQueue = localStorage.getItem(VIDEO_QUEUE_STORAGE_KEY);
    if (savedVideoQueue) {
      try {
        setVideoQueue(JSON.parse(savedVideoQueue));
      } catch (e) {
        console.error('Failed to load video queue:', e);
      }
    }
  }, []);

  // Video mode: Save video queue to localStorage
  useEffect(() => {
    localStorage.setItem(VIDEO_QUEUE_STORAGE_KEY, JSON.stringify(videoQueue));
  }, [videoQueue]);

  // Video mode: Add performer videos to queue
  const addVideoPerformerToQueue = async () => {
    if (!selectedVideoPerformer) return;
    
    // Check if already in queue
    if (videoQueue.some(v => v.type === 'performer' && v.performerName === selectedVideoPerformer.name)) {
      return;
    }
    
    setVideoQueue(prev => [...prev, {
      id: `performer_${Date.now()}`,
      type: 'performer',
      performerName: selectedVideoPerformer.name,
      performerId: selectedVideoPerformer.id,
      status: 'pending',
      addedAt: new Date().toISOString()
    }]);
    setSelectedVideoPerformer(null);
  };

  // Video mode: Add custom folder to queue
  const addCustomFolderToQueue = () => {
    if (!customFolderPath.trim()) return;
    
    // Check if already in queue
    if (videoQueue.some(v => v.type === 'folder' && v.folderPath === customFolderPath.trim())) {
      return;
    }
    
    setVideoQueue(prev => [...prev, {
      id: `folder_${Date.now()}`,
      type: 'folder',
      folderPath: customFolderPath.trim(),
      displayName: customFolderPath.trim().split(/[/\\]/).pop() || customFolderPath.trim(),
      status: 'pending',
      addedAt: new Date().toISOString()
    }]);
    setCustomFolderPath('');
  };

  // Video mode: Remove from queue
  const removeVideoFromQueue = (id) => {
    setVideoQueue(prev => prev.filter(v => v.id !== id));
  };

  // Video mode: Move up/down
  const moveVideoUp = (index) => {
    if (index === 0) return;
    setVideoQueue(prev => {
      const newQueue = [...prev];
      [newQueue[index - 1], newQueue[index]] = [newQueue[index], newQueue[index - 1]];
      return newQueue;
    });
  };

  const moveVideoDown = (index) => {
    if (index === videoQueue.length - 1) return;
    setVideoQueue(prev => {
      const newQueue = [...prev];
      [newQueue[index], newQueue[index + 1]] = [newQueue[index + 1], newQueue[index]];
      return newQueue;
    });
  };

  // Video mode: Clear completed
  const clearCompletedVideos = () => {
    setVideoQueue(prev => prev.filter(v => v.status !== 'completed'));
  };

  // Video mode: Load video list for a queue item (for preview before processing)
  const loadVideoListForItem = async (item) => {
    if (item.videoResults) return; // Already loaded
    
    try {
      let folderPath = '';
      if (item.type === 'performer') {
        folderPath = `${basePath}/content/${item.performerName}`;
      } else if (item.type === 'folder') {
        folderPath = item.folderPath;
      }
      
      const response = await fetch(`/api/files/list-videos?folder=${encodeURIComponent(folderPath)}`);
      if (!response.ok) {
        throw new Error(`Failed to load videos: ${response.status}`);
      }
      const data = await response.json();
      const allVideos = data.videos || [];
      
      // Check which already have segments and which have saved settings
      let pending = [];
      let skipped = [];
      
      if (allVideos.length > 0) {
        // Batch check for segments
        const segmentChecks = await Promise.all(allVideos.map(async (video) => {
          try {
            const resp = await fetch(`/api/scenes/by-video?videoPath=${encodeURIComponent(video.path)}`);
            if (resp.ok) {
              const sceneData = await resp.json();
              return { path: video.path, hasSegments: sceneData.hasScenes || (sceneData.scenes || []).length > 0 };
            }
          } catch (err) {}
          return { path: video.path, hasSegments: false };
        }));
        
        const segmentMap = {};
        segmentChecks.forEach(c => { segmentMap[c.path] = c.hasSegments; });
        
        // Batch check for saved settings (single API call)
        let settingsMap = {};
        try {
          const settingsResp = await fetch('/api/video-analysis/settings/batch-check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ videoPaths: allVideos.map(v => v.path) })
          });
          if (settingsResp.ok) {
            const settingsData = await settingsResp.json();
            settingsMap = settingsData.results || {};
          }
        } catch (err) {
          console.error('Error batch checking settings:', err);
        }
        
        // Combine results
        const videosWithInfo = allVideos.map(video => ({
          ...video,
          hasSegments: segmentMap[video.path] || false,
          hasSavedSettings: settingsMap[video.path] || false
        }));
        
        if (videoRunMode === 'unprocessed') {
          skipped = videosWithInfo
            .filter(v => v.hasSegments)
            .map(v => ({ path: v.path, name: v.name || v.path.split(/[/\\]/).pop(), reason: 'Already has segments', hasSavedSettings: v.hasSavedSettings }));
          
          pending = videosWithInfo
            .filter(v => !v.hasSegments)
            .map(v => ({ path: v.path, name: v.name || v.path.split(/[/\\]/).pop(), hasSavedSettings: v.hasSavedSettings }));
        } else {
          pending = videosWithInfo.map(v => ({ path: v.path, name: v.name || v.path.split(/[/\\]/).pop(), hasSavedSettings: v.hasSavedSettings }));
        }
      }
      
      // Update the queue item with video list
      setVideoQueue(prev => prev.map(v => 
        v.id === item.id ? { 
          ...v, 
          videoResults: { processed: [], skipped, errors: [], pending },
          message: `${pending.length} to process${skipped.length > 0 ? `, ${skipped.length} skipped` : ''}`
        } : v
      ));
    } catch (error) {
      console.error('Error loading video list:', error);
      setVideoQueue(prev => prev.map(v => 
        v.id === item.id ? { 
          ...v, 
          videoResults: { processed: [], skipped: [], errors: [{ name: 'Error', error: error.message }], pending: [] },
          message: 'Failed to load videos'
        } : v
      ));
    }
  };

  // Quick refresh of settings status only (no full reload)
  const refreshSettingsStatus = async (item) => {
    if (!item.videoResults) return;
    
    const allVideos = [
      ...(item.videoResults.pending || []),
      ...(item.videoResults.skipped || []),
      ...(item.videoResults.processed || [])
    ];
    
    if (allVideos.length === 0) return;
    
    try {
      const settingsResp = await fetch('/api/video-analysis/settings/batch-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoPaths: allVideos.map(v => v.path) })
      });
      
      if (settingsResp.ok) {
        const settingsData = await settingsResp.json();
        const settingsMap = settingsData.results || {};
        
        setVideoQueue(prev => prev.map(v => {
          if (v.id !== item.id || !v.videoResults) return v;
          
          return {
            ...v,
            videoResults: {
              ...v.videoResults,
              pending: (v.videoResults.pending || []).map(vid => ({
                ...vid,
                hasSavedSettings: settingsMap[vid.path] || false
              })),
              skipped: (v.videoResults.skipped || []).map(vid => ({
                ...vid,
                hasSavedSettings: settingsMap[vid.path] || false
              })),
              processed: (v.videoResults.processed || []).map(vid => ({
                ...vid,
                hasSavedSettings: settingsMap[vid.path] || false
              }))
            }
          };
        }));
      }
    } catch (err) {
      console.error('Error refreshing settings status:', err);
    }
  };

  // Video mode: Toggle expand and load videos if needed
  const toggleExpandVideoItem = async (item) => {
    const isExpanding = !expandedVideoItems[item.id];
    setExpandedVideoItems(prev => ({ ...prev, [item.id]: isExpanding }));
    
    // If expanding and no results yet, load the video list
    if (isExpanding && !item.videoResults && item.status === 'pending') {
      await loadVideoListForItem(item);
    }
  };

  // Video mode: Start single video source (process just this one item)
  const startSingleVideoSource = async (item) => {
    if (isVideoRunning) return;
    if (item.status !== 'pending') return;
    
    videoProcessingRef.current = true;
    videoAbortRef.current = false;
    setIsVideoRunning(true);
    setCurrentVideo(item.type === 'performer' ? item.performerName : item.displayName);
    
    // Update status to processing and initialize videoResults
    setVideoQueue(prev => prev.map(v => 
      v.id === item.id ? { 
        ...v, 
        status: 'processing',
        videoResults: { processed: [], skipped: [], errors: [], pending: [] }
      } : v
    ));
    // Auto-expand the item being processed
    setExpandedVideoItems(prev => ({ ...prev, [item.id]: true }));
    
    try {
      setVideoProgress({ current: 0, total: 0, status: 'Loading videos...' });
      
      let allVideos = [];
      let folderPath = '';
      
      if (item.type === 'performer') {
        folderPath = `${basePath}/content/${item.performerName}`;
      } else if (item.type === 'folder') {
        folderPath = item.folderPath;
      }
      
      // Get videos from folder
      const response = await fetch(`/api/files/list-videos?folder=${encodeURIComponent(folderPath)}`);
      const data = await response.json();
      allVideos = data.videos || [];
      
      if (allVideos.length === 0) {
        setVideoQueue(prev => prev.map(v => 
          v.id === item.id ? { ...v, status: 'completed', message: 'No videos found', videoResults: { processed: [], skipped: [], errors: [], pending: [] } } : v
        ));
        setIsVideoRunning(false);
        videoProcessingRef.current = false;
        setCurrentVideo(null);
        return;
      }

      let videosToProcess = [...allVideos];
      
      // Helper to update videoResults in real-time
      const updateResults = (processed, skipped, errors, pending) => {
        setVideoQueue(prev => prev.map(v => 
          v.id === item.id ? { 
            ...v, 
            videoResults: { processed, skipped, errors, pending },
            message: `${processed.length} done, ${skipped.length} skipped, ${errors.length} errors, ${pending.length} pending`
          } : v
        ));
      };

      // Filter based on run mode
      const processedVideos = [];
      const skippedVideos = [];
      const errorVideos = [];
      let pendingVideos = [];
      
      if (videoRunMode === 'unprocessed') {
        const videosWithSegments = await Promise.all(allVideos.map(async (video) => {
          try {
            const resp = await fetch(`/api/scenes/by-video?videoPath=${encodeURIComponent(video.path)}`);
            if (!resp.ok) return { ...video, hasSegments: false };
            const sceneData = await resp.json();
            console.log(`[VideoQueue] ${video.path} - hasScenes: ${sceneData.hasScenes}, count: ${(sceneData.scenes || []).length}`);
            return { ...video, hasSegments: sceneData.hasScenes || (sceneData.scenes || []).length > 0 };
          } catch (err) {
            console.error(`[VideoQueue] Error checking scenes for ${video.path}:`, err);
            return { ...video, hasSegments: false };
          }
        }));
        
        // Add already-processed videos to skipped list
        videosWithSegments.filter(v => v.hasSegments).forEach(v => {
          skippedVideos.push({ path: v.path, name: v.name || v.path.split(/[/\\]/).pop(), reason: 'Already has segments' });
        });
        
        videosToProcess = videosWithSegments.filter(v => !v.hasSegments);
      }
      
      // Initialize pending list
      pendingVideos = videosToProcess.map(v => ({ path: v.path, name: v.name || v.path.split(/[/\\]/).pop() }));
      updateResults(processedVideos, skippedVideos, errorVideos, pendingVideos);

      if (videosToProcess.length === 0) {
        setVideoQueue(prev => prev.map(v => 
          v.id === item.id ? { 
            ...v, 
            status: 'completed', 
            message: 'All videos already processed',
            videoResults: { processed: processedVideos, skipped: skippedVideos, errors: errorVideos, pending: [] }
          } : v
        ));
        setIsVideoRunning(false);
        videoProcessingRef.current = false;
        setCurrentVideo(null);
        return;
      }

      // Process each video
      for (let i = 0; i < videosToProcess.length; i++) {
        if (videoAbortRef.current) break;
        
        const video = videosToProcess[i];
        const videoName = video.name || video.path.split(/[/\\]/).pop();
        
        // Remove from pending
        pendingVideos = pendingVideos.filter(v => v.path !== video.path);
        
        setVideoProgress({ 
          current: i + 1, 
          total: videosToProcess.length, 
          status: `Processing: ${videoName}` 
        });
        
        try {
          // Check for saved settings for this specific video
          let savedSettings = { allowedActions: '', windowSize: '', preserveExisting: false };
          try {
            const settingsResp = await fetch(`/api/video-analysis/settings?videoPath=${encodeURIComponent(video.path)}`);
            if (settingsResp.ok) {
              const settingsData = await settingsResp.json();
              if (settingsData.success && settingsData.settings) {
                savedSettings = settingsData.settings;
                console.log(`[VideoQueue] Using saved settings for ${videoName}:`, savedSettings);
              }
            }
          } catch (e) {
            console.log(`[VideoQueue] No saved settings for ${videoName}, using defaults`);
          }
          
          // Use saved window size if available, otherwise calculate from duration
          const windowSize = savedSettings.windowSize 
            ? parseInt(savedSettings.windowSize)
            : Math.round(getDefaultWindowSize(video.duration || 1800) * windowMultiplier);
          
          // Parse allowed actions from saved settings
          const allowedActions = savedSettings.allowedActions
            ? savedSettings.allowedActions.split(',').map(s => s.trim()).filter(s => s.length > 0)
            : [];
          
          const analyzeResp = await fetch('/api/video-analysis/analyze-and-create-scenes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              videoPath: video.path,
              windowSize: windowSize,
              sampleInterval: Math.max(10, Math.round(windowSize / 3)),
              saveScenes: true,
              allowedActions: allowedActions,
              preserveExisting: savedSettings.preserveExisting || false
            })
          });
          
          const result = await analyzeResp.json();
          if (result.success) {
            processedVideos.push({ 
              path: video.path, 
              name: videoName, 
              segments: result.scenesCreated || 0,
              usedSettings: allowedActions.length > 0 || savedSettings.windowSize ? true : false
            });
          } else {
            errorVideos.push({ path: video.path, name: videoName, error: result.error || 'Unknown error' });
          }
        } catch (err) {
          console.error('Error processing video:', err);
          errorVideos.push({ path: video.path, name: videoName, error: err.message });
        }
        
        // Update results in real-time
        updateResults(processedVideos, skippedVideos, errorVideos, pendingVideos);
      }
      
      setVideoQueue(prev => prev.map(v => 
        v.id === item.id ? { 
          ...v, 
          status: errorVideos.length > 0 && processedVideos.length === 0 ? 'error' : 'completed',
          message: `${processedVideos.length} processed, ${skippedVideos.length} skipped, ${errorVideos.length} errors`,
          stats: { processed: processedVideos.length, skipped: skippedVideos.length, errors: errorVideos.length },
          videoResults: { processed: processedVideos, skipped: skippedVideos, errors: errorVideos, pending: [] }
        } : v
      ));
      
    } catch (error) {
      console.error('Error processing video source:', error);
      setVideoQueue(prev => prev.map(v => 
        v.id === item.id ? { ...v, status: 'error', message: error.message } : v
      ));
    }
    
    setCurrentVideo(null);
    setIsVideoRunning(false);
    videoProcessingRef.current = false;
    setVideoProgress({ current: 0, total: 0, status: '' });
  };

  // Video mode: Process queue
  const processVideoQueue = async () => {
    if (videoProcessingRef.current) return;
    videoProcessingRef.current = true;
    videoAbortRef.current = false;
    setIsVideoRunning(true);

    const pendingItems = videoQueue.filter(v => v.status === 'pending');
    
    for (let i = 0; i < pendingItems.length; i++) {
      if (videoAbortRef.current) break;
      
      const item = pendingItems[i];
      setCurrentVideo(item.type === 'performer' ? item.performerName : item.displayName);
      
      // Update status to processing
      setVideoQueue(prev => prev.map(v => 
        v.id === item.id ? { ...v, status: 'processing' } : v
      ));
      
      try {
        setVideoProgress({ current: i + 1, total: pendingItems.length, status: 'Loading videos...' });
        
        let allVideos = [];
        
        if (item.type === 'performer') {
          // Get videos for performer from their content folder
          const response = await fetch(`/api/files/list-videos?folder=${encodeURIComponent(`${basePath}/content/${item.performerName}`)}`);
          const data = await response.json();
          allVideos = data.videos || [];
        } else if (item.type === 'folder') {
          // Get videos from custom folder
          const response = await fetch(`/api/files/list-videos?folder=${encodeURIComponent(item.folderPath)}`);
          const data = await response.json();
          allVideos = data.videos || [];
        }
        
        // Track videos for results
        const processedVideos = [];
        const skippedVideos = [];
        const errorVideos = [];
        let videosToProcess = [...allVideos];
        
        if (allVideos.length === 0) {
          setVideoQueue(prev => prev.map(v => 
            v.id === item.id ? { ...v, status: 'completed', message: 'No videos found', videoResults: { processed: [], skipped: [], errors: [] } } : v
          ));
          continue;
        }

        // Filter based on run mode
        if (videoRunMode === 'unprocessed') {
          // Check which videos already have segments
          const videosWithSegments = await Promise.all(allVideos.map(async (video) => {
            try {
              const response = await fetch(`/api/scenes/by-video?videoPath=${encodeURIComponent(video.path)}`);
              if (!response.ok) return { ...video, hasSegments: false };
              const data = await response.json();
              console.log(`[VideoQueue] ${video.path} - hasScenes: ${data.hasScenes}, count: ${(data.scenes || []).length}`);
              return { ...video, hasSegments: data.hasScenes || (data.scenes || []).length > 0 };
            } catch (err) {
              console.error(`[VideoQueue] Error checking scenes for ${video.path}:`, err);
              return { ...video, hasSegments: false };
            }
          }));
          
          // Add already-processed videos to skipped list
          videosWithSegments.filter(v => v.hasSegments).forEach(v => {
            skippedVideos.push({ path: v.path, name: v.name || v.path.split(/[/\\]/).pop(), reason: 'Already has segments' });
          });
          
          videosToProcess = videosWithSegments.filter(v => !v.hasSegments);
        }

        if (videosToProcess.length === 0) {
          setVideoQueue(prev => prev.map(v => 
            v.id === item.id ? { 
              ...v, 
              status: 'completed', 
              message: 'All videos already processed',
              videoResults: { processed: processedVideos, skipped: skippedVideos, errors: errorVideos }
            } : v
          ));
          continue;
        }

        // Process each video
        for (let j = 0; j < videosToProcess.length; j++) {
          if (videoAbortRef.current) break;
          
          const video = videosToProcess[j];
          const videoName = video.name || video.path.split(/[/\\]/).pop();
          
          setVideoProgress({ 
            current: j + 1, 
            total: videosToProcess.length, 
            status: `Processing: ${videoName}` 
          });
          
          try {
            const windowSize = Math.round(getDefaultWindowSize(video.duration || 1800) * windowMultiplier);
            
            const response = await fetch('/api/video-analysis/analyze-and-create-scenes', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                videoPath: video.path,
                windowSize: windowSize,
                sampleInterval: Math.max(10, Math.round(windowSize / 3)),
                saveScenes: true
              })
            });
            
            const result = await response.json();
            if (result.success) {
              processedVideos.push({ path: video.path, name: videoName, segments: result.scenesCreated || 0 });
            } else {
              errorVideos.push({ path: video.path, name: videoName, error: result.error || 'Unknown error' });
            }
          } catch (err) {
            console.error('Error processing video:', err);
            errorVideos.push({ path: video.path, name: videoName, error: err.message });
          }
        }
        
        setVideoQueue(prev => prev.map(v => 
          v.id === item.id ? { 
            ...v, 
            status: errorVideos.length > 0 && processedVideos.length === 0 ? 'error' : 'completed',
            message: `${processedVideos.length} processed, ${skippedVideos.length} skipped, ${errorVideos.length} errors`,
            stats: { processed: processedVideos.length, skipped: skippedVideos.length, errors: errorVideos.length },
            videoResults: { processed: processedVideos, skipped: skippedVideos, errors: errorVideos }
          } : v
        ));
        
      } catch (error) {
        console.error('Error processing video source:', error);
        setVideoQueue(prev => prev.map(v => 
          v.id === item.id ? { ...v, status: 'error', message: error.message } : v
        ));
      }
    }
    
    setCurrentVideo(null);
    setIsVideoRunning(false);
    videoProcessingRef.current = false;
    setVideoProgress({ current: 0, total: 0, status: '' });
  };

  // Video mode: Stop processing
  const stopVideoProcessing = () => {
    videoAbortRef.current = true;
    setIsVideoRunning(false);
    videoProcessingRef.current = false;
    
    setVideoQueue(prev => prev.map(v => 
      v.status === 'processing' ? { ...v, status: 'pending' } : v
    ));
  };

  // Video mode: Requeue a single video for processing
  const handleRequeueVideo = async () => {
    const { video, queueItemId, actionLabels } = requeueDialog;
    if (!video || !queueItemId) return;
    
    // Parse action labels
    const labels = actionLabels.trim() ? actionLabels.split(',').map(l => l.trim()).filter(l => l) : [];
    
    try {
      // First delete existing scenes for this video
      await fetch(`/api/scenes/delete-by-video?videoPath=${encodeURIComponent(video.path)}`, { method: 'DELETE' });
      
      // Process this single video
      const windowSize = Math.round(getDefaultWindowSize(1800) * windowMultiplier);
      
      const analyzeResp = await fetch('/api/video-analysis/analyze-and-create-scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoPath: video.path,
          windowSize: windowSize,
          sampleInterval: Math.max(10, Math.round(windowSize / 3)),
          saveScenes: true,
          actionLabels: labels.length > 0 ? labels : undefined
        })
      });
      
      const result = await analyzeResp.json();
      
      // Update the video in the queue item's results
      setVideoQueue(prev => prev.map(item => {
        if (item.id !== queueItemId || !item.videoResults) return item;
        
        const newResults = { ...item.videoResults };
        
        // Remove from skipped/errors if present
        newResults.skipped = (newResults.skipped || []).filter(v => v.path !== video.path);
        newResults.errors = (newResults.errors || []).filter(v => v.path !== video.path);
        
        // Update or add to processed
        const existingIdx = (newResults.processed || []).findIndex(v => v.path === video.path);
        const newEntry = { 
          path: video.path, 
          name: video.name, 
          segments: result.scenesCreated || 0,
          reprocessed: true,
          actionLabels: labels
        };
        
        if (existingIdx >= 0) {
          newResults.processed[existingIdx] = newEntry;
        } else {
          newResults.processed = [...(newResults.processed || []), newEntry];
        }
        
        return { ...item, videoResults: newResults };
      }));
      
    } catch (error) {
      console.error('Error requeuing video:', error);
    }
    
    setRequeueDialog({ open: false, video: null, queueItemId: null, actionLabels: '' });
  };

  // Video mode: Start video service
  const startVideoService = async () => {
    try {
      await fetch('/api/video-analysis/start-service', { method: 'POST' });
      // Check status after a delay
      setTimeout(async () => {
        const response = await fetch('/api/video-analysis/health');
        const data = await response.json();
        setVideoServiceStatus({ running: data.running, checked: true });
      }, 3000);
    } catch (error) {
      console.error('Failed to start video service:', error);
    }
  };

  const addToQueue = () => {
    if (!selectedPerformer) return;
    
    // Check if already in queue
    if (queue.some(p => p.name === selectedPerformer.name)) {
      return;
    }
    
    setQueue(prev => [...prev, {
      ...selectedPerformer,
      status: 'pending', // pending, processing, completed, error
      addedAt: new Date().toISOString()
    }]);
    setSelectedPerformer(null);
  };

  const removeFromQueue = (index) => {
    setQueue(prev => prev.filter((_, i) => i !== index));
  };

  const moveUp = (index) => {
    if (index === 0) return;
    setQueue(prev => {
      const newQueue = [...prev];
      [newQueue[index - 1], newQueue[index]] = [newQueue[index], newQueue[index - 1]];
      return newQueue;
    });
  };

  const moveDown = (index) => {
    if (index === queue.length - 1) return;
    setQueue(prev => {
      const newQueue = [...prev];
      [newQueue[index], newQueue[index + 1]] = [newQueue[index + 1], newQueue[index]];
      return newQueue;
    });
  };

  const clearCompleted = () => {
    setQueue(prev => prev.filter(p => p.status !== 'completed'));
  };

  // Start predictions for a single performer (click on queue item)
  const startSinglePerformer = async (performer) => {
    if (isRunning) return;
    
    try {
      // Get performer images
      const isTemp = performer?.id?.toString().startsWith('temp_');
      const payload = {
        sampleSize: 10000,
      };
      
      if (isTemp) {
        payload.performerName = performer.name;
        payload.basePath = basePath;
      } else {
        payload.performerId = performer.id;
      }
      
      const imagesResponse = await fetch('/api/ml-training/load-test-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (!imagesResponse.ok) {
        throw new Error('Failed to load performer images');
      }
      
      const imagesData = await imagesResponse.json();
      const images = imagesData.images || [];
      
      if (images.length === 0) {
        alert('No images found for this performer');
        return;
      }

      // Create state data for MLBatchResultsPage
      const stateData = {
        performer: performer.name,
        images: images,
        basePath: basePath,
        autoStart: false, // Don't auto-start, let user control
        batchSize: batchSize,
        concurrency: concurrency,
        secureMode: secureMode,
        runMode: runMode,
        fromQueue: false, // Not from queue processing
        queueCallback: false
      };
      
      // Store state and open in new tab
      const stateKey = `ml_batch_state_${Date.now()}`;
      localStorage.setItem(stateKey, JSON.stringify(stateData));
      window.open(`/ml-batch-results?stateKey=${stateKey}`, '_blank');
      
    } catch (error) {
      console.error('Error starting single performer:', error);
      alert('Error loading performer: ' + error.message);
    }
  };

  // View results for a completed performer (opens ML batch results page)
  const viewCompletedResults = (performer) => {
    // Create state data for MLBatchResultsPage - just pass performer info
    // The page will load images with their saved decisions
    const stateData = {
      performer: performer.name,
      basePath: basePath,
      autoStart: false,
      batchSize: batchSize,
      concurrency: concurrency,
      secureMode: secureMode,
      runMode: 'all', // Show all to see previous results
      fromQueue: false,
      queueCallback: false,
      viewMode: true, // Indicates viewing results
      loadFromDatabase: true // Signal to load images from database
    };
    
    // Store state and open in new tab
    const stateKey = `ml_batch_state_${Date.now()}`;
    localStorage.setItem(stateKey, JSON.stringify(stateData));
    window.open(`/ml-batch-results?stateKey=${stateKey}`, '_blank');
  };

  const processQueue = async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    abortRef.current = false;
    setIsRunning(true);

    const pendingItems = queue.filter(p => p.status === 'pending');
    
    for (let i = 0; i < pendingItems.length; i++) {
      if (abortRef.current) break;
      
      const performer = pendingItems[i];
      setCurrentPerformer(performer.name);
      
      // Update status to processing
      setQueue(prev => prev.map(p => 
        p.name === performer.name ? { ...p, status: 'processing' } : p
      ));
      
      try {
        // Get performer images using the same endpoint as MLTrainingPage
        setProgress({ current: 0, total: 0, status: 'Loading images...' });
        
        const isTemp = performer?.id?.toString().startsWith('temp_');
        const payload = {
          sampleSize: 10000, // Large number to get all images
        };
        
        if (isTemp) {
          payload.performerName = performer.name;
          payload.basePath = basePath;
        } else {
          payload.performerId = performer.id;
        }
        
        const imagesResponse = await fetch('/api/ml-training/load-test-images', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        
        if (!imagesResponse.ok) {
          throw new Error('Failed to load performer images');
        }
        
        const imagesData = await imagesResponse.json();
        const images = imagesData.images || [];
        
        if (images.length === 0) {
          // No images to process, mark as completed
          setQueue(prev => prev.map(p => 
            p.name === performer.name ? { ...p, status: 'completed', message: 'No images' } : p
          ));
          continue;
        }

        // Open ML Batch Results page in new tab with auto-start
        const stateData = {
          performer: performer.name,
          images: images,
          basePath: basePath,
          autoStart: true,
          batchSize: batchSize,
          concurrency: concurrency,
          secureMode: secureMode,
          runMode: runMode,
          fromQueue: true,
          queueCallback: true
        };
        
        // Clean up any stale completion data before starting
        const completionKey = `ml_batch_complete_${performer.name}`;
        localStorage.removeItem(completionKey);

        // Store state in localStorage for the new tab to pick up (localStorage works across windows/tabs)
        const stateKey = `ml_batch_state_${Date.now()}`;
        localStorage.setItem(stateKey, JSON.stringify(stateData));
        
        // Open in new tab or reuse existing
        if (autoOpenTabs) {
          const url = `/ml-batch-results?stateKey=${stateKey}`;
          
          if (reuseTab && processingWindowRef.current && !processingWindowRef.current.closed) {
            processingWindowRef.current.location.href = url;
            processingWindowRef.current.focus();
          } else {
            const newWindow = window.open(url, '_blank');
            if (!newWindow) {
              setQueue(prev => prev.map(p => 
                p.name === performer.name ? { ...p, status: 'error', message: 'Popup blocked! Please allow popups.' } : p
              ));
              abortRef.current = true;
              break;
            }
            processingWindowRef.current = newWindow;
          }
        }
        
        // Wait for completion signal from the tab
        setProgress({ current: 0, total: images.length, status: 'Processing in new tab...' });
        
        // Poll for completion (the other tab will update localStorage when done)
        let completed = false;
        let attempts = 0;
        const maxAttempts = 3600; // 1 hour max (checking every second)
        
        while (!completed && attempts < maxAttempts && !abortRef.current) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          const completionData = localStorage.getItem(completionKey);
          if (completionData) {
            try {
              const result = JSON.parse(completionData);
              completed = true;
              localStorage.removeItem(completionKey);
              
              setQueue(prev => prev.map(p => 
                p.name === performer.name ? { 
                  ...p, 
                  status: result.success ? 'completed' : 'error',
                  message: result.message || (result.success ? 'Done' : 'Failed'),
                  stats: result.stats
                } : p
              ));
            } catch (parseError) {
              console.error('Error parsing completion data:', parseError, 'Raw data:', completionData);
              // Remove the corrupted data and continue waiting
              localStorage.removeItem(completionKey);
            }
          }
          
          attempts++;
        }
        
        if (!completed && !abortRef.current) {
          // Timeout - mark as error
          setQueue(prev => prev.map(p => 
            p.name === performer.name ? { ...p, status: 'error', message: 'Timeout' } : p
          ));
        }
        
      } catch (error) {
        console.error('Error processing performer:', error);
        setQueue(prev => prev.map(p => 
          p.name === performer.name ? { ...p, status: 'error', message: error.message } : p
        ));
      }
    }
    
    setCurrentPerformer(null);
    setIsRunning(false);
    processingRef.current = false;
    setProgress({ current: 0, total: 0, status: '' });
  };

  const stopProcessing = () => {
    abortRef.current = true;
    setIsRunning(false);
    processingRef.current = false;
    
    // Reset any processing items back to pending
    setQueue(prev => prev.map(p => 
      p.status === 'processing' ? { ...p, status: 'pending' } : p
    ));
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed':
        return <CheckCircleIcon color="success" />;
      case 'error':
        return <ErrorIcon color="error" />;
      case 'processing':
        return <HourglassEmptyIcon color="primary" />;
      default:
        return <QueueIcon color="disabled" />;
    }
  };

  const pendingCount = queue.filter(p => p.status === 'pending').length;
  const completedCount = queue.filter(p => p.status === 'completed').length;
  const errorCount = queue.filter(p => p.status === 'error').length;

  // Handle resuming a crashed session
  const handleResumeSession = async (session) => {
    try {
      // Get performer images using the same endpoint as MLTrainingPage
      const payload = {
        sampleSize: 10000,
      };
      
      if (session.performer_id) {
        payload.performerId = session.performer_id;
      } else {
        payload.performerName = session.performer_name || session.name;
        payload.basePath = basePath;
      }
      
      const imagesResponse = await fetch('/api/ml-training/load-test-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (!imagesResponse.ok) {
        throw new Error('Failed to load performer images');
      }
      
      const imagesData = await imagesResponse.json();
      const images = imagesData.images || [];
      
      // Merge saved state with current images
      const savedState = session.batch_state || [];
      const savedSettings = session.settings || {};
      
      // Create a map of saved decisions by path
      const savedDecisions = {};
      savedState.forEach(item => {
        savedDecisions[item.path] = item;
      });
      
      // Merge saved state into current images
      const mergedImages = images.map(img => {
        const saved = savedDecisions[img.path];
        if (saved) {
          return { ...img, ...saved };
        }
        return img;
      });
      
      // Create state data for MLBatchResultsPage
      const stateData = {
        performer: {
          id: session.performer_id,
          name: session.performer_name || session.name
        },
        images: mergedImages,
        basePath: basePath,
        autoStart: false, // Don't auto-start, let user review first
        batchSize: savedSettings.batchSize || batchSize,
        concurrency: savedSettings.concurrency || concurrency,
        secureMode: savedSettings.secureMode || false,
        fromQueue: false,
        isRecovery: true
      };
      
      // Store state and open
      const stateKey = `ml_batch_state_${Date.now()}`;
      localStorage.setItem(stateKey, JSON.stringify(stateData));
      window.open(`/ml-batch-results?stateKey=${stateKey}`, '_blank');
      
    } catch (error) {
      console.error('Error resuming session:', error);
      alert('Error resuming session: ' + error.message);
    }
  };
  
  // Handle discarding a crashed session
  const handleDiscardSession = async (session) => {
    if (!window.confirm(`Discard session for ${session.name || session.performer_name}? This cannot be undone.`)) {
      return;
    }
    
    try {
      if (session.performer_id) {
        await fetch(`/api/ml/batch-state/${session.performer_id}`, { method: 'DELETE' });
      } else {
        await fetch(`/api/ml/batch-state-by-name/${encodeURIComponent(session.performer_name)}`, { method: 'DELETE' });
      }
      
      // Refresh list
      loadRecoverableSessions();
    } catch (error) {
      console.error('Error discarding session:', error);
    }
  };

  return (
    <Box sx={{ p: 3, maxWidth: 1200, mx: 'auto' }}>
      <Typography variant="h4" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <QueueIcon fontSize="large" />
        ML Batch Queue
      </Typography>
      
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Add performers to the queue and let it run overnight. Configure batch size and secure mode in settings below.
        Your progress is automatically saved - if your browser crashes, you can resume from where you left off!
      </Typography>

      {/* Mode Toggle */}
      <Box sx={{ mb: 3 }}>
        <ToggleButtonGroup
          value={mode}
          exclusive
          onChange={(_, newMode) => newMode && setMode(newMode)}
          aria-label="batch mode"
        >
          <ToggleButton value="image" aria-label="image mode">
            <ImageIcon sx={{ mr: 1 }} />
            Image Predictions
          </ToggleButton>
          <ToggleButton value="video" aria-label="video mode">
            <VideoLibraryIcon sx={{ mr: 1 }} />
            Video Scene Detection
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {!basePath && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          No base path selected. Please go to the main page and select a base path first.
        </Alert>
      )}

      {/* IMAGE MODE */}
      {mode === 'image' && (
        <>
          {/* Add to Queue Section */}
          <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="h6" gutterBottom>Add Performer to Queue</Typography>
        <Stack direction="row" spacing={2} alignItems="center">
          <Autocomplete
            sx={{ flex: 1 }}
            options={performers.filter(p => !queue.some(q => q.name === p.name))}
            getOptionLabel={(option) => `${option.name} (${option.pics_count || 0} pics)${performersWithResults.has(option.name) ? ' ✓' : ''}`}
            value={selectedPerformer}
            onChange={(_, newValue) => setSelectedPerformer(newValue)}
            renderInput={(params) => (
              <TextField {...params} label="Select Performer" placeholder="Start typing... (sorted by pic count, lowest first)" />
            )}
            renderOption={(props, option) => (
              <li {...props} key={option.id || option.name}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: 1 }}>
                  <span>{option.name}</span>
                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    {performersWithResults.has(option.name) && (
                      <Chip 
                        size="small" 
                        label="Has Results"
                        color="success"
                        variant="outlined"
                      />
                    )}
                    <Chip 
                      size="small" 
                      label={`${option.pics_count || 0} pics`}
                      color={option.pics_count > 100 ? 'warning' : 'default'}
                    />
                  </Box>
                </Box>
              </li>
            )}
            disabled={isRunning}
          />
          <Button
            variant="contained"
            onClick={addToQueue}
            disabled={!selectedPerformer || isRunning}
            startIcon={<QueueIcon />}
          >
            Add to Queue
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          {performers.length} performers available • {performersWithResults.size} with saved results (sorted by image count, lowest first)
        </Typography>
      </Paper>

      {/* Queue Stats */}
      <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
        <Chip label={`Pending: ${pendingCount}`} color="default" />
        <Chip label={`Completed: ${completedCount}`} color="success" />
        {errorCount > 0 && <Chip label={`Errors: ${errorCount}`} color="error" />}
        {recoverableSessions.length > 0 && (
          <Chip 
            icon={<RestoreIcon />}
            label={`${recoverableSessions.length} Recoverable`} 
            color="warning"
            onClick={() => setShowRecovery(!showRecovery)}
            sx={{ cursor: 'pointer' }}
          />
        )}
      </Stack>
      
      {/* Recoverable Sessions */}
      <Collapse in={showRecovery && recoverableSessions.length > 0}>
        <Paper sx={{ p: 2, mb: 3, bgcolor: 'warning.50', border: '1px solid', borderColor: 'warning.main' }}>
          <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <RestoreIcon color="warning" />
            Recoverable Sessions (Browser Crashed?)
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            These sessions were interrupted. Click to resume where you left off.
          </Typography>
          <Stack spacing={1}>
            {recoverableSessions.map((session, idx) => {
              const batchState = session.batch_state || [];
              const completed = batchState.filter(r => r.status === 'done').length;
              const total = batchState.length;
              const keepCount = batchState.filter(r => r.decision === 'KEEP').length;
              const deleteCount = batchState.filter(r => r.decision === 'DELETE').length;
              
              return (
                <Card key={idx} sx={{ bgcolor: 'background.paper' }}>
                  <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Box>
                        <Typography variant="subtitle1">{session.name || session.performer_name}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          Progress: {completed}/{total} • Keep: {keepCount} • Delete: {deleteCount}
                          {session.settings && ` • Batch: ${session.settings.batchSize || 4}`}
                          {session.settings?.secureMode && ' • 🔒 Secure'}
                        </Typography>
                      </Box>
                      <Stack direction="row" spacing={1}>
                        <Button
                          size="small"
                          variant="contained"
                          color="primary"
                          startIcon={<RestoreIcon />}
                          onClick={() => handleResumeSession(session)}
                        >
                          Resume
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          color="error"
                          onClick={() => handleDiscardSession(session)}
                        >
                          Discard
                        </Button>
                      </Stack>
                    </Stack>
                  </CardContent>
                </Card>
              );
            })}
          </Stack>
        </Paper>
      </Collapse>

      {/* Batch Settings */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: showSettings ? 2 : 0 }}>
          <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <SettingsIcon />
            Batch Settings
          </Typography>
          <IconButton onClick={() => setShowSettings(!showSettings)}>
            <ExpandMoreIcon sx={{ transform: showSettings ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.3s' }} />
          </IconButton>
        </Box>
        
        <Collapse in={showSettings}>
          <Grid container spacing={3} alignItems="center">
            <Grid item xs={12} md={3}>
              <TextField
                label="Batch Size"
                type="number"
                value={batchSize}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  if (!isNaN(val) && val > 0) setBatchSize(val);
                }}
                onBlur={saveSettings}
                fullWidth
                size="small"
                inputProps={{ min: 1 }}
                helperText="Images per batch"
                disabled={isRunning}
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <TextField
                label="Concurrency"
                type="number"
                value={concurrency}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  if (!isNaN(val) && val > 0 && val <= 4) setConcurrency(val);
                }}
                onBlur={saveSettings}
                fullWidth
                size="small"
                inputProps={{ min: 1, max: 4 }}
                helperText="Parallel requests"
                disabled={isRunning}
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <FormControlLabel
                control={
                  <Switch
                    checked={secureMode}
                    onChange={(e) => {
                      setSecureMode(e.target.checked);
                      setTimeout(saveSettings, 100);
                    }}
                    color="warning"
                    disabled={isRunning}
                  />
                }
                label="🔒 Secure Mode"
              />
              <Typography variant="caption" display="block" color="text.secondary">
                3x slower, higher accuracy
              </Typography>
            </Grid>
            <Grid item xs={12} md={3}>
              <FormControlLabel
                control={
                  <Switch
                    checked={runMode === 'unpredicted'}
                    onChange={(e) => setRunMode(e.target.checked ? 'unpredicted' : 'all')}
                    color="primary"
                    disabled={isRunning}
                  />
                }
                label={runMode === 'unpredicted' ? 'Run Unpredicted' : 'Run All'}
              />
              <Typography variant="caption" display="block" color="text.secondary">
                {runMode === 'unpredicted' ? 'Skip already predicted' : 'Reprocess all images'}
              </Typography>
            </Grid>
          </Grid>
        </Collapse>
        
        {!showSettings && (
          <Typography variant="body2" color="text.secondary">
            Batch: {batchSize} • Concurrency: {concurrency} • Secure: {secureMode ? 'ON' : 'OFF'} • {runMode === 'unpredicted' ? 'Unpredicted Only' : 'All Images'}
          </Typography>
        )}
      </Paper>

      {/* Controls */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
          {!isRunning ? (
            <Button
              variant="contained"
              color="primary"
              onClick={processQueue}
              disabled={pendingCount === 0}
              startIcon={<PlayArrowIcon />}
            >
              Start Queue ({pendingCount} pending)
            </Button>
          ) : (
            <Button
              variant="contained"
              color="error"
              onClick={stopProcessing}
              startIcon={<StopIcon />}
            >
              Stop Queue
            </Button>
          )}
          
          <Button
            variant="outlined"
            onClick={clearCompleted}
            disabled={completedCount === 0 || isRunning}
          >
            Clear Completed
          </Button>
          
          <FormControlLabel
            control={
              <Switch
                checked={autoOpenTabs}
                onChange={(e) => setAutoOpenTabs(e.target.checked)}
                disabled={isRunning}
              />
            }
            label="Auto-open tabs"
          />
          <FormControlLabel
            control={
              <Switch
                checked={reuseTab}
                onChange={(e) => setReuseTab(e.target.checked)}
                disabled={isRunning}
              />
            }
            label="Reuse tab (prevents popup blocks)"
          />
        </Stack>
        
        {isRunning && currentPerformer && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="body2" color="primary">
              Currently processing: {currentPerformer}
            </Typography>
            {progress.status && (
              <Typography variant="caption" color="text.secondary">
                {progress.status}
              </Typography>
            )}
            <LinearProgress sx={{ mt: 1 }} />
          </Box>
        )}
      </Paper>

      {/* Queue List */}
      <Paper>
        <List>
          {queue.length === 0 ? (
            <ListItem>
              <ListItemText 
                primary="Queue is empty"
                secondary="Add performers above to get started"
              />
            </ListItem>
          ) : (
            queue.map((item, index) => (
              <React.Fragment key={item.name}>
                {index > 0 && <Divider />}
                <Tooltip 
                  title={
                    item.status === 'pending' && !isRunning 
                      ? "Click to start predictions for this performer" 
                      : item.status === 'completed' 
                        ? "Click to view results" 
                        : ""
                  } 
                  placement="left"
                >
                  <ListItem
                    sx={{
                      bgcolor: item.status === 'processing' ? 'action.hover' : 'inherit',
                      cursor: (item.status === 'pending' && !isRunning) || item.status === 'completed' ? 'pointer' : 'default',
                      '&:hover': (item.status === 'pending' && !isRunning) || item.status === 'completed' ? {
                        bgcolor: 'action.hover'
                      } : {}
                    }}
                    onClick={() => {
                      if (item.status === 'pending' && !isRunning) {
                        startSinglePerformer(item);
                      } else if (item.status === 'completed') {
                        viewCompletedResults(item);
                      }
                    }}
                  >
                    <Box sx={{ mr: 2 }}>
                      {getStatusIcon(item.status)}
                    </Box>
                    <ListItemText
                      primary={
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Typography>{item.name}</Typography>
                          <Chip size="small" label={`${item.pics_count || 0} pics`} variant="outlined" />
                          {item.status === 'processing' && (
                            <Chip size="small" label="Processing..." color="primary" />
                          )}
                          {item.status === 'pending' && !isRunning && (
                            <Chip size="small" label="Click to start" color="info" variant="outlined" />
                          )}
                        </Stack>
                      }
                      secondary={
                        <>
                          {item.message && <span>{item.message}</span>}
                          {item.stats && (
                            <span>
                              {' '}• Keep: {item.stats.keep}, Delete: {item.stats.delete}
                            </span>
                          )}
                        </>
                      }
                    />
                    <ListItemSecondaryAction>
                      <Stack direction="row" spacing={0.5}>
                        <IconButton
                          size="small"
                          onClick={(e) => { 
                            e.stopPropagation(); 
                            if (item.status === 'completed') {
                              viewCompletedResults(item);
                            } else {
                              startSinglePerformer(item);
                            }
                          }}
                          disabled={isRunning && item.status === 'pending'}
                          color={item.status === 'completed' ? 'success' : 'primary'}
                          title={item.status === 'completed' ? 'View results' : 'Start predictions'}
                        >
                          <PlayArrowIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          onClick={(e) => { e.stopPropagation(); moveUp(index); }}
                          disabled={index === 0 || isRunning || item.status !== 'pending'}
                        >
                          <ArrowUpwardIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          onClick={(e) => { e.stopPropagation(); moveDown(index); }}
                          disabled={index === queue.length - 1 || isRunning || item.status !== 'pending'}
                        >
                          <ArrowDownwardIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          onClick={(e) => { e.stopPropagation(); removeFromQueue(index); }}
                          disabled={isRunning && item.status === 'processing'}
                          color="error"
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                    </ListItemSecondaryAction>
                  </ListItem>
                </Tooltip>
              </React.Fragment>
            ))
          )}
        </List>
      </Paper>

      {/* Instructions */}
      <Paper sx={{ p: 2, mt: 3, bgcolor: 'background.default' }}>
        <Typography variant="subtitle2" gutterBottom>How it works:</Typography>
        <Typography variant="body2" color="text.secondary">
          1. Add performers to the queue using the dropdown above<br />
          2. Configure batch size and secure mode in the settings panel<br />
          3. <strong>Click any performer</strong> or the ▶ button to start predictions for just that one<br />
          4. Or click "Start Queue" to process all pending performers automatically<br />
          5. <strong>Progress is auto-saved!</strong> If your browser crashes, use "Recoverable Sessions" to resume<br />
          6. When running the full queue, performers process one after another<br />
          7. You can leave queue processing running overnight!
        </Typography>
      </Paper>
        </>
      )}

      {/* VIDEO MODE */}
      {mode === 'video' && (
        <>
          {/* Video Service Status */}
          <Paper sx={{ p: 2, mb: 3, bgcolor: videoServiceStatus.running ? 'success.dark' : 'warning.dark' }}>
            <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between">
              <Stack direction="row" spacing={1} alignItems="center">
                <MovieIcon />
                <Typography>
                  Video Analysis Service: {videoServiceStatus.running ? '🟢 Running' : '🔴 Not Running'}
                </Typography>
              </Stack>
              {!videoServiceStatus.running && (
                <Button variant="contained" onClick={startVideoService} startIcon={<PlayArrowIcon />}>
                  Start Service
                </Button>
              )}
            </Stack>
          </Paper>

          {/* Video Settings */}
          <Paper sx={{ p: 2, mb: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: showVideoSettings ? 2 : 0 }}>
              <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <SettingsIcon />
                Video Settings
              </Typography>
              <IconButton onClick={() => setShowVideoSettings(!showVideoSettings)}>
                <ExpandMoreIcon sx={{ transform: showVideoSettings ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.3s' }} />
              </IconButton>
            </Box>
            
            <Collapse in={showVideoSettings}>
              <Grid container spacing={3} alignItems="flex-start">
                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle2" gutterBottom>Window Size Multiplier: {windowMultiplier.toFixed(1)}x</Typography>
                  <Slider
                    value={windowMultiplier}
                    min={0.5}
                    max={3.0}
                    step={0.1}
                    onChange={(_, value) => setWindowMultiplier(value)}
                    marks={[
                      { value: 0.5, label: '0.5x' },
                      { value: 1, label: '1x' },
                      { value: 2, label: '2x' },
                      { value: 3, label: '3x' }
                    ]}
                    valueLabelDisplay="auto"
                    disabled={isVideoRunning}
                  />
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                    Window sizes with {windowMultiplier.toFixed(1)}x multiplier:
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
                    {exampleDurations.map(dur => (
                      <Chip
                        key={dur}
                        size="small"
                        label={`${formatDuration(dur)} video → ${formatDuration(Math.round(getDefaultWindowSize(dur) * windowMultiplier))} window`}
                        variant="outlined"
                      />
                    ))}
                  </Box>
                </Grid>
                <Grid item xs={12} md={6}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={videoRunMode === 'unprocessed'}
                        onChange={(e) => setVideoRunMode(e.target.checked ? 'unprocessed' : 'all')}
                        color="primary"
                        disabled={isVideoRunning}
                      />
                    }
                    label={videoRunMode === 'unprocessed' ? 'Unprocessed Only' : 'Process All'}
                  />
                  <Typography variant="caption" display="block" color="text.secondary">
                    {videoRunMode === 'unprocessed' ? 'Skip videos that already have segments' : 'Reprocess all videos (overwrite existing segments)'}
                  </Typography>
                </Grid>
              </Grid>
            </Collapse>
            
            {!showVideoSettings && (
              <Typography variant="body2" color="text.secondary">
                Window: {windowMultiplier.toFixed(1)}x • Mode: {videoRunMode === 'unprocessed' ? 'Unprocessed Only' : 'All Videos'}
              </Typography>
            )}
          </Paper>

          {/* Add to Video Queue */}
          <Paper sx={{ p: 2, mb: 3 }}>
            <Typography variant="h6" gutterBottom>Add to Video Queue</Typography>
            
            {/* Performer Selection */}
            <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
              <Autocomplete
                sx={{ flex: 1 }}
                options={performers.filter(p => !videoQueue.some(q => q.type === 'performer' && q.performerName === p.name))}
                getOptionLabel={(option) => option.name}
                value={selectedVideoPerformer}
                onChange={(_, newValue) => setSelectedVideoPerformer(newValue)}
                renderInput={(params) => (
                  <TextField {...params} label="Select Performer" placeholder="Add performer's videos" />
                )}
                disabled={isVideoRunning}
              />
              <Button
                variant="contained"
                onClick={addVideoPerformerToQueue}
                disabled={!selectedVideoPerformer || isVideoRunning}
                startIcon={<QueueIcon />}
              >
                Add Performer
              </Button>
            </Stack>
            
            {/* Custom Folder */}
            <Stack direction="row" spacing={2} alignItems="center">
              <TextField
                sx={{ flex: 1 }}
                label="Custom Folder Path"
                placeholder="e.g., D:\Videos\MyFolder"
                value={customFolderPath}
                onChange={(e) => setCustomFolderPath(e.target.value)}
                disabled={isVideoRunning}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <FolderOpenIcon />
                    </InputAdornment>
                  )
                }}
              />
              <Button
                variant="outlined"
                onClick={addCustomFolderToQueue}
                disabled={!customFolderPath.trim() || isVideoRunning}
                startIcon={<FolderOpenIcon />}
              >
                Add Folder
              </Button>
            </Stack>
          </Paper>

          {/* Video Queue Stats */}
          <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
            <Chip label={`Pending: ${videoQueue.filter(v => v.status === 'pending').length}`} color="default" />
            <Chip label={`Completed: ${videoQueue.filter(v => v.status === 'completed').length}`} color="success" />
            {videoQueue.filter(v => v.status === 'error').length > 0 && (
              <Chip label={`Errors: ${videoQueue.filter(v => v.status === 'error').length}`} color="error" />
            )}
          </Stack>

          {/* Video Controls */}
          <Paper sx={{ p: 2, mb: 3 }}>
            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
              {!isVideoRunning ? (
                <Button
                  variant="contained"
                  color="primary"
                  onClick={processVideoQueue}
                  disabled={videoQueue.filter(v => v.status === 'pending').length === 0 || !videoServiceStatus.running}
                  startIcon={<PlayArrowIcon />}
                >
                  Start Video Queue ({videoQueue.filter(v => v.status === 'pending').length} pending)
                </Button>
              ) : (
                <Button
                  variant="contained"
                  color="error"
                  onClick={stopVideoProcessing}
                  startIcon={<StopIcon />}
                >
                  Stop Processing
                </Button>
              )}
              
              <Button
                variant="outlined"
                onClick={clearCompletedVideos}
                disabled={videoQueue.filter(v => v.status === 'completed').length === 0 || isVideoRunning}
              >
                Clear Completed
              </Button>
            </Stack>
            
            {isVideoRunning && currentVideo && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="body2" color="primary">
                  Currently processing: {currentVideo}
                </Typography>
                {videoProgress.status && (
                  <Typography variant="caption" color="text.secondary">
                    {videoProgress.status} ({videoProgress.current}/{videoProgress.total})
                  </Typography>
                )}
                <LinearProgress sx={{ mt: 1 }} />
              </Box>
            )}
            
            {!videoServiceStatus.running && (
              <Alert severity="warning" sx={{ mt: 2 }}>
                Video analysis service is not running. Start it to process videos.
              </Alert>
            )}
          </Paper>

          {/* Video Queue List */}
          <Paper>
            <List>
              {videoQueue.length === 0 ? (
                <ListItem>
                  <ListItemText 
                    primary="Video queue is empty"
                    secondary="Add performers or custom folders above to get started"
                  />
                </ListItem>
              ) : (
                videoQueue.map((item, index) => (
                  <React.Fragment key={item.id}>
                    {index > 0 && <Divider />}
                    <Tooltip 
                      title={item.status === 'pending' && !isVideoRunning ? "Click to process this source" : ""} 
                      placement="left"
                    >
                      <ListItem
                        sx={{
                          bgcolor: item.status === 'processing' ? 'action.hover' : 'inherit',
                          cursor: item.status === 'pending' && !isVideoRunning ? 'pointer' : 'default',
                          '&:hover': item.status === 'pending' && !isVideoRunning ? {
                            bgcolor: 'action.hover'
                          } : {}
                        }}
                        onClick={() => {
                          if (item.status === 'pending' && !isVideoRunning) {
                            startSingleVideoSource(item);
                          }
                        }}
                      >
                        <Box sx={{ mr: 2 }}>
                          {item.status === 'completed' && <CheckCircleIcon color="success" />}
                          {item.status === 'error' && <ErrorIcon color="error" />}
                          {item.status === 'pending' && <HourglassEmptyIcon color="action" />}
                          {item.status === 'processing' && <PlayArrowIcon color="primary" />}
                        </Box>
                        <ListItemText
                          primary={
                            <Stack direction="row" spacing={1} alignItems="center">
                              {item.type === 'performer' ? <ImageIcon fontSize="small" /> : <FolderOpenIcon fontSize="small" />}
                              <Typography>{item.type === 'performer' ? item.performerName : item.displayName}</Typography>
                              <Chip 
                                size="small" 
                                label={item.type === 'performer' ? 'Performer' : 'Folder'} 
                                variant="outlined"
                                color={item.type === 'performer' ? 'primary' : 'secondary'}
                              />
                              {item.status === 'processing' && (
                                <Chip size="small" label="Processing..." color="primary" />
                              )}
                              {item.status === 'pending' && !isVideoRunning && (
                                <Chip size="small" label="Click to start" color="info" variant="outlined" />
                              )}
                            </Stack>
                          }
                          secondary={
                            <>
                              {item.type === 'folder' && <span>{item.folderPath}</span>}
                              {item.message && <span> • {item.message}</span>}
                            </>
                          }
                        />
                        <ListItemSecondaryAction>
                          <Stack direction="row" spacing={0.5}>
                            <IconButton
                              size="small"
                              onClick={(e) => { e.stopPropagation(); startSingleVideoSource(item); }}
                              disabled={isVideoRunning || item.status !== 'pending'}
                              color="primary"
                              title="Process videos"
                            >
                              <PlayArrowIcon fontSize="small" />
                            </IconButton>
                            <IconButton
                              size="small"
                              onClick={(e) => { e.stopPropagation(); moveVideoUp(index); }}
                              disabled={index === 0 || isVideoRunning || item.status !== 'pending'}
                            >
                              <ArrowUpwardIcon fontSize="small" />
                            </IconButton>
                            <IconButton
                              size="small"
                              onClick={(e) => { e.stopPropagation(); moveVideoDown(index); }}
                              disabled={index === videoQueue.length - 1 || isVideoRunning || item.status !== 'pending'}
                            >
                              <ArrowDownwardIcon fontSize="small" />
                            </IconButton>
                            <IconButton
                              size="small"
                              onClick={(e) => { e.stopPropagation(); removeVideoFromQueue(item.id); }}
                              disabled={isVideoRunning && item.status === 'processing'}
                              color="error"
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                            <IconButton
                              size="small"
                              onClick={(e) => { 
                                e.stopPropagation(); 
                                toggleExpandVideoItem(item);
                              }}
                              color="info"
                              title="Show video details"
                            >
                              <ExpandMoreIcon 
                                fontSize="small" 
                                sx={{ 
                                  transform: expandedVideoItems[item.id] ? 'rotate(180deg)' : 'rotate(0deg)',
                                  transition: 'transform 0.3s'
                                }} 
                              />
                            </IconButton>
                          </Stack>
                        </ListItemSecondaryAction>
                      </ListItem>
                    </Tooltip>
                    
                    {/* Collapsible Video Results */}
                    <Collapse in={expandedVideoItems[item.id]}>
                      <Box sx={{ pl: 6, pr: 2, pb: 2, bgcolor: 'action.hover' }}>
                        {/* Loading state when no results yet */}
                        {!item.videoResults && (
                          <Box sx={{ py: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                            <HourglassTopIcon color="info" fontSize="small" />
                            <Typography variant="body2" color="text.secondary">
                              Loading video list...
                            </Typography>
                          </Box>
                        )}
                        
                        {/* Pending Videos (during processing) */}
                        {item.videoResults && (item.videoResults.pending || []).length > 0 && (
                          <Box sx={{ mb: 2 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                              <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <HourglassTopIcon color="info" fontSize="small" />
                                Pending ({item.videoResults.pending.length})
                              </Typography>
                              {item.status === 'pending' && (
                                <Box sx={{ display: 'flex', gap: 0.5 }}>
                                  <Button
                                    size="small"
                                    onClick={() => refreshSettingsStatus(item)}
                                    sx={{ fontSize: '0.7rem' }}
                                    title="Quick refresh settings status only"
                                  >
                                    ⚡ Settings
                                  </Button>
                                  <Button
                                    size="small"
                                    onClick={async () => {
                                      // Force reload by clearing results first
                                      setVideoQueue(prev => prev.map(v => 
                                        v.id === item.id ? { ...v, videoResults: null } : v
                                      ));
                                      setTimeout(() => loadVideoListForItem(item), 100);
                                    }}
                                    sx={{ fontSize: '0.7rem' }}
                                    title="Full reload (slower)"
                                  >
                                    🔄 Full
                                  </Button>
                                </Box>
                              )}
                            </Box>
                              <Stack spacing={0.5}>
                                {item.videoResults.pending.map((video, idx) => (
                                  <Box 
                                    key={idx} 
                                    sx={{ 
                                      display: 'flex', 
                                      alignItems: 'center', 
                                      justifyContent: 'space-between',
                                      p: 0.5,
                                      borderRadius: 1,
                                      '&:hover': { bgcolor: 'action.selected' }
                                    }}
                                  >
                                    <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                                      <Typography variant="body2" color="text.secondary">
                                        {video.name}
                                      </Typography>
                                      {video.hasSavedSettings && (
                                        <Chip label="Has Settings" size="small" color="info" variant="outlined" sx={{ height: 20 }} />
                                      )}
                                    </Box>
                                    <Button
                                      size="small"
                                      startIcon={<OpenInNewIcon />}
                                      onClick={() => window.open(`/scene-editor?video=${encodeURIComponent(video.path)}`, '_blank')}
                                    >
                                      Configure
                                    </Button>
                                  </Box>
                                ))}
                              </Stack>
                            </Box>
                          )}
                          
                          {/* Processed Videos */}
                          {item.videoResults && (item.videoResults.processed || []).length > 0 && (
                            <Box sx={{ mb: 2 }}>
                              <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                <CheckCircleIcon color="success" fontSize="small" />
                                Processed ({item.videoResults.processed.length})
                              </Typography>
                              <Stack spacing={0.5}>
                                {item.videoResults.processed.map((video, idx) => (
                                  <Box 
                                    key={idx} 
                                    sx={{ 
                                      display: 'flex', 
                                      alignItems: 'center', 
                                      justifyContent: 'space-between',
                                      p: 0.5,
                                      borderRadius: 1,
                                      '&:hover': { bgcolor: 'action.selected' }
                                    }}
                                  >
                                    <Typography variant="body2" sx={{ flex: 1 }}>
                                      {video.name}
                                      {video.segments !== undefined && (
                                        <Chip size="small" label={`${video.segments} segments`} sx={{ ml: 1 }} />
                                      )}
                                      {video.usedSettings && (
                                        <Chip size="small" label="Custom Settings" color="info" sx={{ ml: 1 }} />
                                      )}
                                      {video.reprocessed && (
                                        <Chip size="small" label="Reprocessed" color="warning" sx={{ ml: 1 }} />
                                      )}
                                    </Typography>
                                    <Stack direction="row" spacing={0.5}>
                                      <Tooltip title="Reprocess with action labels">
                                        <IconButton
                                          size="small"
                                          onClick={() => setRequeueDialog({ open: true, video, queueItemId: item.id, actionLabels: '' })}
                                          disabled={isVideoRunning}
                                        >
                                          <ReplayIcon fontSize="small" />
                                        </IconButton>
                                      </Tooltip>
                                      <Button
                                        size="small"
                                        startIcon={<OpenInNewIcon />}
                                        onClick={() => window.open(`/scene-editor?video=${encodeURIComponent(video.path)}`, '_blank')}
                                      >
                                        Scene Manager
                                      </Button>
                                    </Stack>
                                  </Box>
                                ))}
                              </Stack>
                            </Box>
                          )}
                          
                          {/* Skipped Videos */}
                          {item.videoResults && (item.videoResults.skipped || []).length > 0 && (
                            <Box sx={{ mb: 2 }}>
                              <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                <SkipNextIcon color="warning" fontSize="small" />
                                Skipped ({item.videoResults.skipped.length})
                              </Typography>
                              <Stack spacing={0.5}>
                                {item.videoResults.skipped.map((video, idx) => (
                                  <Box 
                                    key={idx} 
                                    sx={{ 
                                      display: 'flex', 
                                      alignItems: 'center', 
                                      justifyContent: 'space-between',
                                      p: 0.5,
                                      borderRadius: 1,
                                      '&:hover': { bgcolor: 'action.selected' }
                                    }}
                                  >
                                    <Typography variant="body2" sx={{ flex: 1 }}>
                                      {video.name}
                                      <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                                        ({video.reason})
                                      </Typography>
                                    </Typography>
                                    <Stack direction="row" spacing={0.5}>
                                      <Tooltip title="Process with action labels">
                                        <IconButton
                                          size="small"
                                          onClick={() => setRequeueDialog({ open: true, video, queueItemId: item.id, actionLabels: '' })}
                                          disabled={isVideoRunning}
                                        >
                                          <ReplayIcon fontSize="small" />
                                        </IconButton>
                                      </Tooltip>
                                      <Button
                                        size="small"
                                        startIcon={<OpenInNewIcon />}
                                        onClick={() => window.open(`/scene-editor?video=${encodeURIComponent(video.path)}`, '_blank')}
                                      >
                                        Scene Manager
                                      </Button>
                                    </Stack>
                                  </Box>
                                ))}
                              </Stack>
                            </Box>
                          )}
                          
                          {/* Error Videos */}
                          {item.videoResults && (item.videoResults.errors || []).length > 0 && (
                            <Box>
                              <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                <ErrorIcon color="error" fontSize="small" />
                                Errors ({item.videoResults.errors.length})
                              </Typography>
                              <Stack spacing={0.5}>
                                {item.videoResults.errors.map((video, idx) => (
                                  <Box 
                                    key={idx} 
                                    sx={{ 
                                      display: 'flex', 
                                      alignItems: 'center', 
                                      justifyContent: 'space-between',
                                      p: 0.5,
                                      borderRadius: 1,
                                      '&:hover': { bgcolor: 'action.selected' }
                                    }}
                                  >
                                    <Typography variant="body2" sx={{ flex: 1 }}>
                                      {video.name}
                                      <Typography component="span" variant="caption" color="error" sx={{ ml: 1 }}>
                                        ({video.error})
                                      </Typography>
                                    </Typography>
                                    <Stack direction="row" spacing={0.5}>
                                      <Tooltip title="Retry with action labels">
                                        <IconButton
                                          size="small"
                                          onClick={() => setRequeueDialog({ open: true, video, queueItemId: item.id, actionLabels: '' })}
                                          disabled={isVideoRunning}
                                        >
                                          <ReplayIcon fontSize="small" />
                                        </IconButton>
                                      </Tooltip>
                                      <Button
                                        size="small"
                                        startIcon={<OpenInNewIcon />}
                                        onClick={() => window.open(`/scene-editor?video=${encodeURIComponent(video.path)}`, '_blank')}
                                      >
                                        Scene Manager
                                      </Button>
                                    </Stack>
                                  </Box>
                                ))}
                              </Stack>
                            </Box>
                          )}
                      </Box>
                    </Collapse>
                  </React.Fragment>
                ))
              )}
            </List>
          </Paper>

          {/* Video Instructions */}
          <Paper sx={{ p: 2, mt: 3, bgcolor: 'background.default' }}>
            <Typography variant="subtitle2" gutterBottom>How Video Mode works:</Typography>
            <Typography variant="body2" color="text.secondary">
              1. Make sure the Video Analysis Service is running (green status)<br />
              2. Add performers (uses their content folder) or custom folder paths<br />
              3. Adjust window multiplier - larger = fewer segments, smaller = more detailed<br />
              4. Toggle "Unprocessed Only" to skip videos that already have segments<br />
              5. <strong>Click any item</strong> or the ▶ button to process just that source<br />
              6. Or click "Start Video Queue" to process all pending sources<br />
              7. Use the ↻ button on any video to reprocess with optional action labels<br />
              8. Segments are saved as JSON files next to each video
            </Typography>
          </Paper>
        </>
      )}

      {/* Requeue Video Dialog */}
      <Dialog 
        open={requeueDialog.open} 
        onClose={() => setRequeueDialog({ open: false, video: null, queueItemId: null, actionLabels: '' })}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Reprocess Video
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {requeueDialog.video?.name}
          </Typography>
          <TextField
            label="Action Labels (optional)"
            placeholder="e.g., blowjob, handjob, cowgirl"
            fullWidth
            value={requeueDialog.actionLabels}
            onChange={(e) => setRequeueDialog(prev => ({ ...prev, actionLabels: e.target.value }))}
            helperText="Comma-separated list of actions to look for in the video. Leave empty for automatic detection."
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRequeueDialog({ open: false, video: null, queueItemId: null, actionLabels: '' })}>
            Cancel
          </Button>
          <Button 
            variant="contained" 
            onClick={handleRequeueVideo}
            startIcon={<ReplayIcon />}
          >
            Reprocess
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default BatchQueuePage;
