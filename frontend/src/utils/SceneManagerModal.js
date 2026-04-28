import React, { useState, useRef, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Button,
  TextField,
  Typography,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Slider,
  FormControlLabel,
  Checkbox,
  Chip,
  Paper,
  Grid,
  Divider,
  Alert,
  CircularProgress,
  Autocomplete,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Tabs,
  Tab
} from '@mui/material';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  Save as SaveIcon,
  Cancel as CancelIcon,
  PlayArrow as PlayIcon,
  Pause as PauseIcon,
  Add as AddIcon,
  GetApp as ExportIcon,
  ContentCut as CutIcon,
  FastForward as FastForwardIcon,
  FastRewind as FastRewindIcon,
  SkipNext as SkipNextIcon,
  SkipPrevious as SkipPreviousIcon,
  AutoFixHigh as AutoFixHighIcon,
  Terminal as TerminalIcon,
  Movie as MovieIcon
} from '@mui/icons-material';


const SceneManagerModal = ({ open, onClose, videoSrc, filePath, variant = 'modal' }) => {
  const videoRef = useRef(null);
  const pendingSeekRef = useRef(null); // For seeking after stream reload
  const streamOffsetRef = useRef(0); // Current stream offset for event handlers
  const [scenes, setScenes] = useState([]);
  const [exportedFiles, setExportedFiles] = useState([]);
  const [currentScene, setCurrentScene] = useState({
    name: '',
    startTime: 0,
    endTime: 0
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [bufferedRanges, setBufferedRanges] = useState([]);
  const [cachedDuration, setCachedDuration] = useState(null);
  const [streamOffset, setStreamOffset] = useState(0); // For remuxed streams: the start time offset
  
  // Keep ref in sync with state for use in event handlers
  useEffect(() => {
    streamOffsetRef.current = streamOffset;
  }, [streamOffset]);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [editingScene, setEditingScene] = useState(null);
  const [editingFile, setEditingFile] = useState(null);
  const [newTag, setNewTag] = useState('');
  const [allTags, setAllTags] = useState([]);
  const [exportOptions, setExportOptions] = useState({
    includeFunscript: false,
    createFunscriptFolder: false
  });
  const [selectedScenes, setSelectedScenes] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [availableFunscripts, setAvailableFunscripts] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  // Get the actual file path for streaming
  const actualFilePath = React.useMemo(() => {
    if (filePath) return filePath;
    if (videoSrc?.includes('/api/files/raw?path=')) {
      try {
        const url = new URL(videoSrc, window.location.origin);
        return url.searchParams.get('path');
      } catch (e) {
        console.error('Failed to parse videoSrc URL:', e);
      }
    }
    return videoSrc;
  }, [videoSrc, filePath]);

  // Use streaming endpoint with startTime for seek support
  const streamingVideoSrc = React.useMemo(() => {
    if (!actualFilePath) return videoSrc;
    if (videoSrc?.startsWith('blob:')) return videoSrc;
    
    let url = `/api/files/stream-video?path=${encodeURIComponent(actualFilePath)}`;
    if (streamOffset > 0) {
      url += `&startTime=${streamOffset}`;
    }
    return url;
  }, [actualFilePath, videoSrc, streamOffset]);
  const [showAnalysisConfig, setShowAnalysisConfig] = useState(false);
  const [analysisConfig, setAnalysisConfig] = useState({
    allowedActions: '',
    windowSize: '',
    preserveExisting: true
  });
  const [settingsModified, setSettingsModified] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [analysisTarget, setAnalysisTarget] = useState(null); // 'full' or 'selected'
  const [analysisProgress, setAnalysisProgress] = useState('');
  
  // New state for transition analysis
  const [showTransitionDialog, setShowTransitionDialog] = useState(false);
  const [transitionParams, setTransitionParams] = useState({
    prompt: '',
    windowSize: 4,
    startTime: 0,
    endTime: 0
  });
  
  // Tabs and Logs state
  const [activeTab, setActiveTab] = useState(0);
  const [serviceLogs, setServiceLogs] = useState([]);
  const logsEndRef = useRef(null);
  const logsContainerRef = useRef(null);
  const shouldScrollRef = useRef(true);
  const [leftPaneWidth, setLeftPaneWidth] = useState(600);
  const isDraggingRef = useRef(false);

  // Merge Scenes
  const mergeSelectedScenes = async () => {
    if (selectedScenes.size < 2) return;
    
    if (!window.confirm(`Merge ${selectedScenes.size} scenes into one?`)) return;
    
    setLoading(true);
    try {
      // Get selected scene objects
      const selected = scenes.filter(s => selectedScenes.has(s.id));
      // Sort by start time
      selected.sort((a, b) => a.startTime - b.startTime);
      
      const first = selected[0];
      const last = selected[selected.length - 1];
      
      // Update first scene
      const updatedScene = {
        ...first,
        endTime: last.endTime,
      };
      
      await fetch('/api/scenes/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sceneId: first.id, scene: updatedScene })
      });
      
      // Delete others
      for (let i = 1; i < selected.length; i++) {
        await fetch('/api/scenes/delete', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sceneId: selected[i].id })
        });
      }
      
      await loadScenes();
      setSelectedScenes(new Set());
      
    } catch (err) {
      console.error('Merge failed', err);
      setError('Failed to merge scenes');
    } finally {
      setLoading(false);
    }
  };

  // Open Transition Dialog
  const openTransitionDialog = () => {
    if (selectedScenes.size !== 2) return;
    
    const selected = scenes.filter(s => selectedScenes.has(s.id));
    selected.sort((a, b) => a.startTime - b.startTime);
    
    const s1 = selected[0];
    const s2 = selected[1];
    
    // Define transition range: End of S1 - 5s to Start of S2 + 5s
    let start = Math.max(0, s1.endTime - 5);
    let end = Math.min(videoDuration, s2.startTime + 5);
    
    if (start >= end) {
        start = Math.max(0, s1.endTime - 5);
        end = s1.endTime + 5;
    }
    
    setTransitionParams({
        prompt: `${s1.name}, ${s2.name}`, 
        windowSize: 4,
        startTime: start,
        endTime: end
    });
    setShowTransitionDialog(true);
  };

  const runTransitionAnalysis = async () => {
    setShowTransitionDialog(false);
    
    // Auto-run exact cut finding
    await findExactTransition();
  };

  const findExactTransition = async () => {
    setShowTransitionDialog(false);
    setLoading(true);
    setIsAnalyzing(true);
    setAnalysisProgress('Finding exact transition point...');
    
    try {
        const labels = transitionParams.prompt.split(',').map(s => s.trim());
        if (labels.length < 2) {
            throw new Error("Need two labels for transition search");
        }
        
        const res = await fetch('/api/video-analysis/find-transition-point', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                videoPath: filePath,
                startTime: transitionParams.startTime,
                endTime: transitionParams.endTime,
                label1: labels[0],
                label2: labels[1],
                originalWindowSize: transitionParams.windowSize || 0
            })
        });
        
        const result = await res.json();
        if (result.success) {
            const splitPoint = result.transition_point;
            
            // Update the two scenes
            const selected = scenes.filter(s => selectedScenes.has(s.id));
            selected.sort((a, b) => a.startTime - b.startTime);
            
            if (selected.length === 2) {
                // Update Scene 1 End
                await fetch('/api/scenes/update', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        sceneId: selected[0].id, 
                        scene: { ...selected[0], endTime: splitPoint } 
                    })
                });
                
                // Update Scene 2 Start
                await fetch('/api/scenes/update', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        sceneId: selected[1].id, 
                        scene: { ...selected[1], startTime: splitPoint } 
                    })
                });
                
                await loadScenes();
                alert(`Transition found at ${formatTime(splitPoint)}! Scenes updated.`);
            }
        } else {
            throw new Error(result.error || "Failed to find transition");
        }
    } catch (err) {
        console.error(err);
        setError('Transition search failed: ' + err.message);
    } finally {
        setLoading(false);
        setIsAnalyzing(false);
        setAnalysisProgress('');
    }
  };

  const handleMouseDown = (e) => {
    isDraggingRef.current = true;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (e) => {
    if (!isDraggingRef.current) return;
    setLeftPaneWidth(prev => {
      const newWidth = prev + e.movementX;
      return Math.max(300, Math.min(1200, newWidth));
    });
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };

  // Poll logs when tab is active
  useEffect(() => {
    let interval;
    if (activeTab === 2) {
      shouldScrollRef.current = true; // Reset on tab open
      const fetchLogs = async () => {
        try {
          const res = await fetch('/api/video-analysis/logs');
          if (res.ok) {
            const data = await res.json();
            
            // Check scroll position before updating state
            if (logsContainerRef.current) {
                const { scrollTop, scrollHeight, clientHeight } = logsContainerRef.current;
                // If user is scrolled up (more than 50px from bottom), don't auto-scroll
                const isAtBottom = (scrollHeight - scrollTop - clientHeight) < 50;
                shouldScrollRef.current = isAtBottom;
            }

            setServiceLogs(prevLogs => {
              if (data.length !== prevLogs.length) return data;
              if (data.length > 0) {
                const lastNew = data[data.length - 1];
                const lastOld = prevLogs[prevLogs.length - 1];
                if (lastNew.timestamp !== lastOld.timestamp || lastNew.message !== lastOld.message) {
                  return data;
                }
              }
              return prevLogs;
            });
          }
        } catch (e) {
          console.error('Failed to fetch logs', e);
        }
      };
      
      fetchLogs();
      interval = setInterval(fetchLogs, 2000);
    }
    return () => clearInterval(interval);
  }, [activeTab]);

  // Auto-scroll logs
  useEffect(() => {
    if (activeTab === 2 && logsEndRef.current && shouldScrollRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [serviceLogs, activeTab]);
  
  // New action-based analysis state
  const [supportedActions, setSupportedActions] = useState([]);
  const [selectedAction, setSelectedAction] = useState('');
  const [showActionPicker, setShowActionPicker] = useState(false);
  const [serviceRunning, setServiceRunning] = useState(null); // null = unknown, true/false = checked
  const [startingService, setStartingService] = useState(false);

  // Load supported actions from the video analysis service
  const loadSupportedActions = async () => {
    try {
      const response = await fetch('/api/video-analysis/supported-actions');
      if (response.ok) {
        const data = await response.json();
        setSupportedActions(data.actions || []);
      }
    } catch (err) {
      console.error('Failed to load supported actions:', err);
    }
  };

  // Reset state when modal opens with new video
  useEffect(() => {
    if (open && filePath) {
      // Reset all video-related state
      setVideoDuration(0);
      setCachedDuration(null);
      setBufferedRanges([]);
      setCurrentTime(0);
      setStreamOffset(0);
      setScenes([]);
      setIsPlaying(false);
      
      // Load data for new video
      loadScenes();
      loadExportedFiles();
      loadAllTags();
      loadAvailableFunscripts();
      loadSupportedActions();
      loadAnalysisSettings();
    }
  }, [open, filePath]);

  // Load saved analysis settings for this video
  const loadAnalysisSettings = async () => {
    if (!filePath) return;
    try {
      const response = await fetch(`/api/video-analysis/settings?videoPath=${encodeURIComponent(filePath)}`);
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.settings) {
          setAnalysisConfig({
            allowedActions: data.settings.allowedActions || '',
            windowSize: data.settings.windowSize || '',
            preserveExisting: data.settings.preserveExisting !== false
          });
          setSettingsModified(false);
          setSettingsSaved(!!data.settings.updatedAt);
        }
      }
    } catch (err) {
      console.error('Failed to load analysis settings:', err);
    }
  };

  // Save analysis settings for this video
  const saveAnalysisSettings = async () => {
    if (!filePath) return;
    try {
      const response = await fetch('/api/video-analysis/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoPath: filePath,
          ...analysisConfig
        })
      });
      if (response.ok) {
        setSettingsModified(false);
        setSettingsSaved(true);
      }
    } catch (err) {
      console.error('Failed to save analysis settings:', err);
    }
  };

  // Track when settings are modified
  const updateAnalysisConfig = (updates) => {
    setAnalysisConfig(prev => ({ ...prev, ...updates }));
    setSettingsModified(true);
  };

  // Calculate effective duration - use cached duration (most reliable), or last scene end time
  const effectiveDuration = React.useMemo(() => {
    // First priority: cached duration from API (most reliable)
    if (cachedDuration && cachedDuration > 0) {
      return cachedDuration;
    }
    // Second: last scene's end time
    if (scenes.length > 0) {
      const maxEndTime = Math.max(...scenes.map(s => s.endTime || 0));
      if (maxEndTime > 0) {
        return maxEndTime;
      }
    }
    // Last resort: video element duration (unreliable for remuxed streams)
    if (videoDuration && isFinite(videoDuration) && videoDuration > 0 && streamOffset === 0) {
      return videoDuration;
    }
    return 0;
  }, [videoDuration, cachedDuration, scenes, streamOffset]);

  // Fetch video duration from API for remuxed streams
  useEffect(() => {
    if (filePath && open) {
      fetch(`/api/files/video-duration?path=${encodeURIComponent(filePath)}`)
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data?.duration) {
            setCachedDuration(data.duration);
          }
        })
        .catch(err => console.error('Failed to fetch video duration:', err));
    }
  }, [filePath, open]);

  // Video event handlers
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const updateBufferedRanges = () => {
      // Update buffered ranges
      const ranges = [];
      for (let i = 0; i < video.buffered.length; i++) {
        ranges.push({
          start: video.buffered.start(i),
          end: video.buffered.end(i)
        });
      }
      setBufferedRanges(ranges);
    };

    const handleLoadedMetadata = () => {
      if (isFinite(video.duration) && video.duration > 0) {
        setVideoDuration(video.duration);
        setCurrentScene(prev => ({ ...prev, endTime: video.duration }));
      }
      updateBufferedRanges();
      
      // Apply pending seek after stream loads
      if (pendingSeekRef.current !== null) {
        const targetTime = pendingSeekRef.current;
        pendingSeekRef.current = null;
        // Small delay to ensure video is ready
        setTimeout(() => {
          if (video) {
            video.currentTime = targetTime;
          }
        }, 100);
      }
    };

    const handleTimeUpdate = () => {
      // Add stream offset to get actual video time (use ref for current value)
      setCurrentTime(video.currentTime + streamOffsetRef.current);
      // Also update buffer on timeupdate for remuxed streams
      updateBufferedRanges();
    };

    const handleProgress = () => {
      updateBufferedRanges();
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    // Periodic buffer check for streaming content
    const bufferInterval = setInterval(updateBufferedRanges, 500);

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('progress', handleProgress);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);

    return () => {
      clearInterval(bufferInterval);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('progress', handleProgress);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
    };
  }, [videoRef.current]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e) => {
      // Prevent default behavior if we're handling the key
      const activeElement = document.activeElement;
      const isInputFocused = activeElement && (
        activeElement.tagName === 'INPUT' || 
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.contentEditable === 'true'
      );

      // Don't handle shortcuts if an input is focused
      if (isInputFocused) return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          handlePlayPause();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (e.shiftKey) {
            seekBackward(0.2); // 200ms
          } else if (e.ctrlKey) {
            seekBackward(1); // 1s
          } else if (e.altKey) {
            seekBackward(15); // 15s
          } else {
            seekBackward(5); // 5s (default)
          }
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (e.shiftKey) {
            seekForward(0.2); // 200ms
          } else if (e.ctrlKey) {
            seekForward(1); // 1s
          } else if (e.altKey) {
            seekForward(15); // 15s
          } else {
            seekForward(5); // 5s (default)
          }
          break;
        case ',':
          e.preventDefault();
          seekBackward(0.04); // Frame by frame (assuming 25fps)
          break;
        case '.':
          e.preventDefault();
          seekForward(0.04); // Frame by frame (assuming 25fps)
          break;
        default:
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const loadScenes = async () => {
    try {
      const response = await fetch(`/api/scenes/video?path=${encodeURIComponent(filePath)}`);
      if (response.ok) {
        const data = await response.json();
        setScenes(data.scenes || []);
        // If API returns video duration, use it
        if (data.durationSeconds && data.durationSeconds > 0) {
          setCachedDuration(data.durationSeconds);
        }
      }
    } catch (err) {
      console.error('Failed to load scenes:', err);
      setError('Failed to load scenes');
    }
  };

  const loadExportedFiles = async () => {
    try {
      const response = await fetch(`/api/scenes/exported-files?path=${encodeURIComponent(filePath)}`);
      if (response.ok) {
        const data = await response.json();
        setExportedFiles(data.exportedFiles || []);
      }
    } catch (err) {
      console.error('Failed to load exported files:', err);
      setError('Failed to load exported files');
    }
  };

  const loadAllTags = async () => {
    try {
      const response = await fetch('/api/tags/all');
      if (response.ok) {
        const data = await response.json();
        setAllTags(data.tags || []);
      }
    } catch (err) {
      console.error('Failed to load tags:', err);
    }
  };

  const loadAvailableFunscripts = async () => {
    try {
      const response = await fetch(`/api/scenes/video/funscripts?videoPath=${encodeURIComponent(filePath)}`);
      if (response.ok) {
        const data = await response.json();
        setAvailableFunscripts(data.funscripts || []);
      }
    } catch (err) {
      console.error('Failed to load available funscripts:', err);
    }
  };

  const assignFunscriptToScene = async (sceneId, funscriptPath) => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`/api/scenes/scene/${sceneId}/assign-funscript`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          funscriptPath
        })
      });

      if (response.ok) {
        // Reload scenes to show updated funscript assignments
        await loadScenes();
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to assign funscript');
      }
    } catch (err) {
      setError('Failed to assign funscript');
      console.error('Assign funscript error:', err);
    } finally {
      setLoading(false);
    }
  };

  const removeFunscriptFromScene = async (sceneId) => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`/api/scenes/scene/${sceneId}/funscript`, {
        method: 'DELETE'
      });

      if (response.ok) {
        // Reload scenes to show updated funscript assignments
        await loadScenes();
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to remove funscript');
      }
    } catch (err) {
      setError('Failed to remove funscript');
      console.error('Remove funscript error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleScenePlayback = async (sceneId, startTime) => {
    try {
      // Check if Handy is connected (you'll need to get this from your app's context)
      const isHandyConnected = window.handyConnected || false;
      
      const response = await fetch(`/api/scenes/scene/${sceneId}/play`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isHandyConnected })
      });

      if (response.ok) {
        const data = await response.json();
        
        // If there's an auto-upload funscript, handle it
        if (data.autoUpload && isHandyConnected) {
          const { funscriptFile, sceneName } = data.autoUpload;
          
          // Load funscript on Handy device
          try {
            const loadResponse = await fetch('/api/handy/load-script', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                funscriptPath: funscriptFile
              })
            });

            if (loadResponse.ok) {
              console.log(`Loaded funscript for scene "${sceneName}"`);
              
              // Sync to the scene start time (convert to milliseconds)
              const syncResponse = await fetch('/api/handy/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  positionMs: Math.floor(startTime * 1000)
                })
              });

              if (syncResponse.ok) {
                console.log(`Synced Handy to scene start time: ${startTime}s`);
                // Show success notification
                setError(`✅ Funscript loaded and synced for scene "${sceneName}"`);
                setTimeout(() => setError(''), 3000); // Clear message after 3 seconds
              } else {
                console.error('Failed to sync Handy to scene start time');
              }
            } else {
              console.error('Failed to load funscript on Handy');
              setError('Failed to load funscript on Handy device');
            }
          } catch (uploadErr) {
            console.error('Error loading funscript:', uploadErr);
            setError('Error loading funscript on Handy device');
          }
        }
      }
    } catch (err) {
      console.error('Error handling scene playback:', err);
    }
  };

  const handlePlayPause = async () => {
    const video = videoRef.current;
    if (!video) return;

    const isHandyConnected = window.handyConnected || false;

    if (isPlaying) {
      video.pause();
      // Pause Handy device if connected
      if (isHandyConnected) {
        try {
          await fetch('/api/handy/pause', { method: 'POST' });
        } catch (err) {
          console.error('Failed to pause Handy:', err);
        }
      }
    } else {
      video.play();
      // Start Handy device if connected
      if (isHandyConnected) {
        try {
          await fetch('/api/handy/play', { method: 'POST' });
        } catch (err) {
          console.error('Failed to start Handy:', err);
        }
      }
    }
  };

  const handleSeek = (newTime) => {
    const video = videoRef.current;
    if (!video) return;
    
    // Check if this is a remuxed stream (MKV, etc.) by checking file extension
    const ext = actualFilePath?.toLowerCase().split('.').pop();
    const isRemuxedFormat = ['mkv', 'avi', 'wmv', 'flv'].includes(ext);
    
    if (isRemuxedFormat) {
      // For remuxed streams, we need to reload with new startTime
      // Only reload if seeking significantly (more than 5 seconds from buffered)
      const isBuffered = bufferedRanges.some(r => 
        newTime >= (r.start + streamOffset) && newTime <= (r.end + streamOffset)
      );
      
      if (!isBuffered && Math.abs(newTime - (video.currentTime + streamOffset)) > 5) {
        // Reload stream from new position
        const newOffset = Math.max(0, newTime - 2); // Start 2 seconds before for context
        pendingSeekRef.current = newTime - newOffset; // Seek to this position after load
        setStreamOffset(newOffset);
        setCurrentTime(newTime);
        return;
      }
      // Seek within the remuxed stream (adjust for offset)
      const adjustedTime = newTime - streamOffset;
      if (adjustedTime >= 0) {
        video.currentTime = adjustedTime;
      }
    } else {
      // Regular seek for non-remuxed formats
      video.currentTime = newTime;
    }
    setCurrentTime(newTime);
  };

  const handlePlaybackRateChange = (newRate) => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = newRate;
    setPlaybackRate(newRate);
  };

  const seekBy = (seconds) => {
    const video = videoRef.current;
    if (!video) return;
    
    // Use effectiveDuration and account for offset
    const actualCurrentTime = video.currentTime + streamOffset;
    const maxTime = effectiveDuration || (video.duration + streamOffset) || 0;
    const newTime = Math.max(0, Math.min(maxTime, actualCurrentTime + seconds));
    handleSeek(newTime);
  };

  const seekBackward = (seconds) => seekBy(-seconds);
  const seekForward = (seconds) => seekBy(seconds);

  const setCurrentTimeAsStart = () => {
    const video = videoRef.current;
    const videoCurrentTime = video ? video.currentTime : 0;
    const stateCurrentTime = currentTime;
    const actualTime = videoCurrentTime || stateCurrentTime || 0;
    const roundedTime = Math.round(actualTime * 100) / 100;
    
    if (editingScene !== null) {
      const updatedScenes = [...scenes];
      updatedScenes[editingScene].startTime = roundedTime;
      setScenes(updatedScenes);
    } else {
      setCurrentScene(prev => ({ ...prev, startTime: roundedTime }));
    }
  };

  const setCurrentTimeAsEnd = () => {
    const video = videoRef.current;
    const videoCurrentTime = video ? video.currentTime : 0;
    const stateCurrentTime = currentTime;
    const actualTime = videoCurrentTime || stateCurrentTime || 0;
    const roundedTime = Math.round(actualTime * 100) / 100;
    
    if (editingScene !== null) {
      const updatedScenes = [...scenes];
      updatedScenes[editingScene].endTime = roundedTime;
      setScenes(updatedScenes);
    } else {
      setCurrentScene(prev => ({ ...prev, endTime: roundedTime }));
    }
  };

  const setStartToPreviousEnd = () => {
    const timeRef = videoRef.current ? videoRef.current.currentTime : currentTime;
    // Find scenes that end before or at the current time
    const previousScenes = scenes.filter(s => s.endTime <= timeRef + 0.1); // small buffer
    
    if (previousScenes.length === 0) return;
    
    // Sort by end time descending to get the closest one
    previousScenes.sort((a, b) => b.endTime - a.endTime);
    const prevEndTime = previousScenes[0].endTime;
    
    if (editingScene !== null) {
      const updatedScenes = [...scenes];
      updatedScenes[editingScene].startTime = prevEndTime;
      setScenes(updatedScenes);
    } else {
      setCurrentScene(prev => ({ ...prev, startTime: prevEndTime }));
    }
    
    // Seek to verify
    if (videoRef.current) {
      videoRef.current.currentTime = prevEndTime;
      setCurrentTime(prevEndTime);
    }
  };

  const setEndToNextStart = () => {
    const timeRef = videoRef.current ? videoRef.current.currentTime : currentTime;
    // Find scenes that start after or at the current time
    const nextScenes = scenes.filter(s => s.startTime >= timeRef - 0.1); // small buffer
    
    if (nextScenes.length === 0) return;
    
    // Sort by start time ascending to get the closest one
    nextScenes.sort((a, b) => a.startTime - b.startTime);
    const nextStartTime = nextScenes[0].startTime;
    
    if (editingScene !== null) {
      const updatedScenes = [...scenes];
      updatedScenes[editingScene].endTime = nextStartTime;
      setScenes(updatedScenes);
    } else {
      setCurrentScene(prev => ({ ...prev, endTime: nextStartTime }));
    }
    
    // Seek to verify
    if (videoRef.current) {
      videoRef.current.currentTime = nextStartTime;
      setCurrentTime(nextStartTime);
    }
  };

  const snapToScenePoint = (sceneId, pointType) => {
    const scene = scenes.find(s => s.id === sceneId);
    if (!scene) return;

    const time = pointType === 'start' ? scene.startTime : scene.endTime;
    if (editingScene === null) {
      setCurrentScene(prev => ({ 
        ...prev, 
        [pointType === 'start' ? 'startTime' : 'endTime']: time 
      }));
    } else {
      const updatedScenes = [...scenes];
      updatedScenes[editingScene][pointType === 'start' ? 'startTime' : 'endTime'] = time;
      setScenes(updatedScenes);
    }
  };

  const playScene = async (sceneId) => {
    const scene = scenes.find(s => s.id === sceneId);
    if (!scene) return;

    // Seek to scene start
    handleSeek(scene.startTime);
    
    // Handle funscript upload for this scene
    await handleScenePlayback(sceneId, scene.startTime);
    
    // Start playing the video
    const video = videoRef.current;
    if (video && !isPlaying) {
      video.play();
    }
  };

  const addTag = () => {
    if (!newTag.trim() || editingFile === null) return;
    
    console.log('Adding tag:', newTag.trim(), 'to file index:', editingFile);
    
    const file = exportedFiles[editingFile];
    console.log('Current file before adding tag:', file);
    
    const currentTags = Array.isArray(file.tags) ? file.tags : [];
    const updatedTags = [...currentTags, newTag.trim()];
    
    console.log('Updated tags:', updatedTags);
    
    // Force a complete state update
    setExportedFiles(prevFiles => {
      const newFiles = [...prevFiles];
      newFiles[editingFile] = {
        ...newFiles[editingFile],
        tags: updatedTags
      };
      console.log('New files state:', newFiles);
      console.log('Updated file in new state:', newFiles[editingFile]);
      return newFiles;
    });
    
    setNewTag('');
  };

  const removeTag = (tagToRemove) => {
    if (editingFile === null) return;
    
    console.log('Removing tag:', tagToRemove, 'from file index:', editingFile);
    
    const file = exportedFiles[editingFile];
    const currentTags = Array.isArray(file.tags) ? file.tags : [];
    const updatedTags = currentTags.filter(tag => tag !== tagToRemove);
    
    console.log('Updated tags after removal:', updatedTags);
    
    // Force a complete state update
    setExportedFiles(prevFiles => {
      const newFiles = [...prevFiles];
      newFiles[editingFile] = {
        ...newFiles[editingFile],
        tags: updatedTags
      };
      console.log('Updated file after tag removal:', newFiles[editingFile]);
      return newFiles;
    });
  };

  const saveScene = async () => {
    if (!currentScene.name.trim()) {
      setError('Scene name is required');
      return;
    }

    if (currentScene.startTime >= currentScene.endTime) {
      setError('Start time must be before end time');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const sceneToSave = {
        name: currentScene.name,
        startTime: Math.round((currentScene.startTime ?? 0) * 100) / 100,
        endTime: Math.round((currentScene.endTime ?? 0) * 100) / 100
      };

      const response = await fetch('/api/scenes/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoPath: filePath,
          scene: sceneToSave
        })
      });

      if (response.ok) {
        await loadScenes();
        setCurrentScene({
          name: '',
          startTime: currentTime,
          endTime: videoDuration
        });
        
        // Notify FunscriptPlayer components about scene changes
        window.dispatchEvent(new CustomEvent('scenesUpdated'));
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to save scene');
      }
    } catch (err) {
      setError('Failed to save scene');
    } finally {
      setLoading(false);
    }
  };

  const updateScene = async (sceneId) => {
    const scene = scenes.find(s => s.id === sceneId);
    if (!scene) return;

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/scenes/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sceneId,
          scene
        })
      });

      if (response.ok) {
        await loadScenes();
        setEditingScene(null);
        
        // Notify FunscriptPlayer components about scene changes
        window.dispatchEvent(new CustomEvent('scenesUpdated'));
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to update scene');
      }
    } catch (err) {
      setError('Failed to update scene');
    } finally {
      setLoading(false);
    }
  };

  const deleteScene = async (sceneId) => {
    if (!window.confirm('Are you sure you want to delete this scene?')) return;

    setLoading(true);
    setError('');

    try {
      const response = await fetch(`/api/scenes/delete/${sceneId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        await loadScenes();
        
        // Notify FunscriptPlayer components about scene changes
        window.dispatchEvent(new CustomEvent('scenesUpdated'));
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to delete scene');
      }
    } catch (err) {
      setError('Failed to delete scene');
    } finally {
      setLoading(false);
    }
  };

  const cutScene = async (sceneId) => {
    const scene = scenes.find(s => s.id === sceneId);
    if (!scene) return;

    const confirmMessage = `⚠️ WARNING: This will permanently cut scene "${scene.name}" from the original video file!\n\n` +
      `This action will:\n` +
      `• Remove the scene (${formatTime(scene.startTime)} - ${formatTime(scene.endTime)}) from the video\n` +
      `• Adjust timestamps of all subsequent scenes\n` +
      `• Update the funscript file if present\n` +
      `• Delete the backup after successful completion\n\n` +
      `This cannot be undone.\n\n` +
      `Are you absolutely sure you want to proceed?`;

    if (!window.confirm(confirmMessage)) return;

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/scenes/cut', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoPath: filePath,
          sceneId
        })
      });

      if (response.ok) {
        const result = await response.json();
        alert(`Scene cut successfully!\n\n${result.message}`);
        
        // Reload scenes to reflect the updated timestamps
        await loadScenes();
        
        // Notify FunscriptPlayer components about scene changes
        window.dispatchEvent(new CustomEvent('scenesUpdated'));
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to cut scene');
      }
    } catch (err) {
      setError('Failed to cut scene');
    } finally {
      setLoading(false);
    }
  };

  const cutMultipleScenes = async () => {
    if (selectedScenes.size === 0) return;

    const scenesToCut = Array.from(selectedScenes).map(id => 
      scenes.find(s => s.id === id)
    ).filter(Boolean);

    const sceneNames = scenesToCut.map(s => s.name).join(', ');
    const confirmMessage = `⚠️ WARNING: This will permanently cut ${scenesToCut.length} scene(s) from the original video file!\n\n` +
      `Scenes to cut: ${sceneNames}\n\n` +
      `This action will:\n` +
      `• Remove all selected scenes from the video\n` +
      `• Adjust timestamps of all subsequent scenes\n` +
      `• Update the funscript file if present\n` +
      `• Delete the backup after successful completion\n\n` +
      `This cannot be undone.\n\n` +
      `Are you absolutely sure you want to proceed?`;

    if (!window.confirm(confirmMessage)) return;

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/scenes/cut', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoPath: filePath,
          sceneIds: Array.from(selectedScenes)
        })
      });

      if (response.ok) {
        const result = await response.json();
        alert(`Multiple scenes cut successfully!\n\n${result.message}`);
        
        // Clear selection and reload scenes
        setSelectedScenes(new Set());
        await loadScenes();
        
        // Notify FunscriptPlayer components about scene changes
        window.dispatchEvent(new CustomEvent('scenesUpdated'));
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to cut scenes');
      }
    } catch (err) {
      setError('Failed to cut scenes');
    } finally {
      setLoading(false);
    }
  };

  const toggleSceneSelection = (sceneId) => {
    const newSelection = new Set(selectedScenes);
    if (newSelection.has(sceneId)) {
      newSelection.delete(sceneId);
    } else {
      newSelection.add(sceneId);
    }
    setSelectedScenes(newSelection);
  };

  const selectAllScenes = () => {
    if (selectedScenes.size === scenes.length) {
      setSelectedScenes(new Set());
    } else {
      setSelectedScenes(new Set(scenes.map(s => s.id)));
    }
  };

  // Stop the video analysis service
  const stopVideoService = async () => {
    if (!window.confirm('Are you sure you want to stop the AI service? Analysis will be interrupted.')) return;
    
    try {
      const response = await fetch('/api/video-analysis/stop-service', { method: 'POST' });
      const data = await response.json();
      if (data.success) {
        setServiceRunning(false);
        setIsAnalyzing(false);
        setAnalysisProgress('');
        // Add a log entry locally to show it stopped
        setServiceLogs(prev => [...prev, { timestamp: new Date(), type: 'info', message: 'Service stopped by user' }]);
      } else {
        alert('Failed to stop service: ' + data.message);
      }
    } catch (err) {
      console.error('Error stopping service:', err);
      alert('Error stopping service');
    }
  };

  // Show the action picker dialog instead of auto-analyzing everything
  // Start the video analysis service
  const startVideoService = async (shouldRunAnalysis = true) => {
    setStartingService(true);
    setError('');
    
    try {
      const response = await fetch('/api/video-analysis/start-service', {
        method: 'POST'
      });
      const data = await response.json();
      
      if (data.success) {
        setError('');
        // Poll for service to be ready
        let attempts = 0;
        const checkReady = setInterval(async () => {
          attempts++;
          try {
            const health = await fetch('/api/video-analysis/health');
            const healthData = await health.json();
            if (healthData.running) {
              clearInterval(checkReady);
              setServiceRunning(true);
              setStartingService(false);
              setShowActionPicker(false);
              
              // Only run analysis if requested
              if (shouldRunAnalysis) {
                await runVideoAnalysis();
              }
            }
          } catch (e) {
            // Still starting...
          }
          if (attempts > 60) { // 2 minutes timeout
            clearInterval(checkReady);
            setStartingService(false);
            setError('Service took too long to start. Check the terminal window.');
          }
        }, 2000);
      } else {
        setError(data.error || 'Failed to start service');
        setStartingService(false);
      }
    } catch (err) {
      console.error('Start service error:', err);
      setError('Failed to start video analysis service');
      setStartingService(false);
    }
  };

  // Run the actual video analysis
  const runVideoAnalysis = async (allowedActions = [], startTime = undefined, endTime = undefined, options = {}, windowSize = undefined, preserveExisting = false) => {
    const { skipStateReset = false, skipAlerts = false } = options;

    setIsAnalyzing(true);
    setAnalysisProgress('Analyzing video with AI... This may take a few minutes.');
    setError('');
    setShowActionPicker(false);

    try {
      const response = await fetch('/api/video-analysis/analyze-and-create-scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoPath: filePath,
          sampleInterval: 12,  // 12 second segments
          minSegment: 10,      // Minimum 10 second scenes
          saveScenes: true,
          allowedActions: allowedActions,
          startTime: startTime,
          endTime: endTime,
          windowSize: windowSize,
          preserveExisting: preserveExisting
        })
      });

      if (response.ok) {
        const result = await response.json();
        
        if (result.success) {
          setAnalysisProgress('Analysis complete!');
          await loadScenes();
          
          if (!skipAlerts) {
            if (result.scenesCreated > 0) {
              const summary = result.scenes
                .map(s => `${formatTime(s.startTime)} - ${formatTime(s.endTime)}: ${s.name}`)
                .join('\n');
              
              alert(`✅ Found ${result.scenesCreated} action segments!\n\n${summary}`);
            } else {
              alert('No action segments detected in the video.');
            }
          }
          
          window.dispatchEvent(new CustomEvent('scenesUpdated'));
        } else {
          setError(result.error || 'Analysis failed');
        }
      } else {
        const errorData = await response.json();
        setError(errorData.error || errorData.hint || 'Failed to analyze video');
      }
    } catch (err) {
      console.error('Analysis error:', err);
      setError('Failed to analyze video. Is the AI service running?');
    } finally {
      if (!skipStateReset) {
        setIsAnalyzing(false);
        setAnalysisProgress('');
      }
    }
  };

  const executeFullAnalysis = async (allowedActions, windowSize, preserveExisting = false) => {
    if (!filePath) return;

    setError('');
    
    // First check if the service is running
    try {
      console.log('Checking video analysis health...');
      const healthResponse = await fetch('/api/video-analysis/health');
      const healthData = await healthResponse.json();
      
      if (!healthData.running) {
        console.log('Service not running, showing start dialog');
        setServiceRunning(false);
        setShowActionPicker(true); // Show dialog to start service
        return;
      }
      
      console.log('Health check passed, starting analysis...');
      setServiceRunning(true);
      await runVideoAnalysis(allowedActions, undefined, undefined, {}, windowSize, preserveExisting);
      
    } catch (err) {
      console.error('Health check error:', err);
      setServiceRunning(false);
      setShowActionPicker(true); // Show dialog to start service
    }
  };

  const executeSelectedScenesAnalysis = async (allowedActions, windowSize) => {
    if (selectedScenes.size === 0) return;

    setIsAnalyzing(true);
    setAnalysisProgress('Starting batch analysis...');
    
    const scenesToAnalyze = scenes.filter(s => selectedScenes.has(s.id));
    
    for (let i = 0; i < scenesToAnalyze.length; i++) {
        const scene = scenesToAnalyze[i];
        setAnalysisProgress(`Analyzing scene ${i+1}/${scenesToAnalyze.length}: ${scene.name}...`);
        
        try {
            // Delete the existing scene first to avoid duplicates/overlaps
            await fetch(`/api/scenes/delete/${scene.id}`, { method: 'DELETE' });

            // Run analysis on the same time range
            await runVideoAnalysis(allowedActions, scene.startTime, scene.endTime, { skipStateReset: true, skipAlerts: true }, windowSize);
        } catch (e) {
            console.error(e);
        }
    }
    
    setIsAnalyzing(false);
    setAnalysisProgress('');
    alert('Batch analysis complete!');
    await loadScenes();
    setSelectedScenes(new Set()); // Clear selection
  };

  const analyzeSelectedScenes = () => {
    if (selectedScenes.size === 0) return;
    setAnalysisTarget('selected');
    // Don't reset config - use persistent values
    setShowAnalysisConfig(true);
  };

  const analyzeFullVideo = () => {
    if (!filePath) return;
    setAnalysisTarget('full');
    // Don't reset config - use persistent values
    setShowAnalysisConfig(true);
  };

  const handleStartAnalysis = async () => {
    setShowAnalysisConfig(false);
    const allowedActions = analysisConfig.allowedActions.trim()
      ? analysisConfig.allowedActions.split(',').map(s => s.trim()).filter(s => s.length > 0)
      : [];
    const windowSize = analysisConfig.windowSize ? parseInt(analysisConfig.windowSize) : undefined;
    const preserveExisting = analysisConfig.preserveExisting;

    if (analysisTarget === 'full') {
      await executeFullAnalysis(allowedActions, windowSize, preserveExisting);
    } else if (analysisTarget === 'selected') {
      await executeSelectedScenesAnalysis(allowedActions, windowSize);
    }
  };

  // Find specific action in the video
  const findActionInVideo = async (actionId) => {
    if (!filePath || !actionId) return;

    setShowActionPicker(false);
    setIsAnalyzing(true);
    setSelectedAction(actionId);
    
    const action = supportedActions.find(a => a.id === actionId);
    setAnalysisProgress(`Looking for "${action?.name || actionId}" segments...`);
    setError('');

    try {
      const response = await fetch('/api/video-analysis/find-action-and-create-scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoPath: filePath,
          action: actionId,
          minDuration: 5,
          saveScenes: true
        })
      });

      if (response.ok) {
        const result = await response.json();
        
        if (result.success) {
          setAnalysisProgress('Search complete!');
          
          // Reload scenes to show the new scenes
          await loadScenes();
          
          if (result.scenesCreated > 0) {
            const summary = result.scenes
              .map(s => `${formatTime(s.startTime)} - ${formatTime(s.endTime)}: ${s.name}`)
              .join('\n');
            
            alert(`✅ Found ${result.scenesCreated} "${result.actionName}" segments!\n\n${summary}`);
          } else {
            alert(`No "${result.actionName}" segments found in untagged portions of the video.`);
          }
          
          // Notify FunscriptPlayer components about scene changes
          window.dispatchEvent(new CustomEvent('scenesUpdated'));
        } else {
          setError(result.error || 'Search failed');
        }
      } else {
        const errorData = await response.json();
        setError(errorData.error || errorData.hint || 'Failed to find action');
      }
    } catch (err) {
      console.error('Find action error:', err);
      setError('Failed to search for action. Is the vision-llm-video service running?');
    } finally {
      setIsAnalyzing(false);
      setAnalysisProgress('');
      setSelectedAction('');
    }
  };

  // Legacy auto-analyze (kept for backward compatibility)
  const autoAnalyzeVideo = async () => {
    if (!filePath) return;

    const confirmMessage = `🤖 Auto-Analyze Video\n\n` +
      `This will use AI to analyze the video and automatically create scenes based on detected actions.\n\n` +
      `• Existing [Auto] scenes will be replaced\n` +
      `• Manual scenes will be preserved\n` +
      `• This may take several minutes for long videos\n\n` +
      `Make sure the vision-llm-video service is running.\n\n` +
      `Continue?`;

    if (!window.confirm(confirmMessage)) return;

    setIsAnalyzing(true);
    setAnalysisProgress('Starting video analysis...');
    setError('');

    try {
      // First check if the service is running
      const healthResponse = await fetch('/api/video-analysis/health');
      if (!healthResponse.ok) {
        const healthData = await healthResponse.json();
        setError(healthData.hint || 'Video analysis service not running');
        setIsAnalyzing(false);
        return;
      }

      setAnalysisProgress('Analyzing video frames with AI...');

      // Call the analyze-and-create-scenes endpoint
      const response = await fetch('/api/video-analysis/analyze-and-create-scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoPath: filePath,
          sampleInterval: 30,  // Sample every 30 seconds initially
          minSegment: 10,      // Minimum 10 second segments
          saveScenes: true
        })
      });

      if (response.ok) {
        const result = await response.json();
        
        if (result.success) {
          setAnalysisProgress('Analysis complete!');
          
          // Reload scenes to show the new auto-generated scenes
          await loadScenes();
          
          // Show summary
          const summary = result.analysis.segments
            .map(s => `${s.start} - ${s.end}: ${s.action}`)
            .join('\\n');
          
          alert(`✅ Video analysis complete!\\n\\nFound ${result.scenesCreated} action segments:\\n${summary}`);
          
          // Notify FunscriptPlayer components about scene changes
          window.dispatchEvent(new CustomEvent('scenesUpdated'));
        } else {
          setError(result.error || 'Analysis failed');
        }
      } else {
        const errorData = await response.json();
        setError(errorData.error || errorData.hint || 'Failed to analyze video');
      }
    } catch (err) {
      console.error('Auto-analyze error:', err);
      setError('Failed to analyze video. Is the vision-llm-video service running?');
    } finally {
      setIsAnalyzing(false);
      setAnalysisProgress('');
    }
  };

  const exportScene = async (sceneId) => {
    const scene = scenes.find(s => s.id === sceneId);
    if (!scene) return;

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/scenes/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoPath: filePath,
          sceneId,
          options: exportOptions
        })
      });

      if (response.ok) {
        const result = await response.json();
        alert(`Scene exported successfully to: ${result.exportPath}`);
        // Reload exported files to show the new export
        await loadExportedFiles();
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to export scene');
      }
    } catch (err) {
      setError('Failed to export scene');
    } finally {
      setLoading(false);
    }
  };

  const updateExportedFileTags = async (fileId) => {
    const fileIndex = exportedFiles.findIndex(f => f.id === fileId);
    if (fileIndex === -1) {
      console.error('File not found with ID:', fileId);
      return;
    }

    const file = exportedFiles[fileIndex];
    console.log('File found for tag update:', file);

    // Get the current tags from the updated state
    const tagsToSave = Array.isArray(file.tags) ? [...file.tags] : [];
    
    console.log('Sending tags to backend:', tagsToSave); // Debug log

    setLoading(true);
    setError('');

    try {
      const response = await fetch(`/api/scenes/exported-file/${fileId}/tags`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tags: tagsToSave
        })
      });

      if (response.ok) {
        setEditingFile(null);
        await loadExportedFiles();
        // Notify about tag changes
        window.dispatchEvent(new CustomEvent('scenesUpdated'));
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to update tags');
      }
    } catch (err) {
      setError('Failed to update tags');
    } finally {
      setLoading(false);
    }
  };

  const deleteExportedFile = async (fileId) => {
    const file = exportedFiles.find(f => f.id === fileId);
    const fileName = file ? file.name : 'this file';
    
    if (!window.confirm(`Are you sure you want to delete the exported file "${fileName}"?\n\nThis will permanently delete the physical video file from disk and cannot be undone.`)) return;

    setLoading(true);
    setError('');

    try {
      const response = await fetch(`/api/scenes/exported-file/${fileId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        const result = await response.json();
        let message = `File "${fileName}" has been successfully deleted from disk.`;
        
        if (result.funscriptDeleted) {
          message += '\nAssociated funscript file was also deleted.';
        }
        
        if (result.folderDeleted) {
          message += '\nThe funscript folder was also removed as it was empty.';
        }
        
        if (result.fileDeleted) {
          alert(message);
        } else {
          alert(`Database record removed, but file may not have been deleted from disk.`);
        }
        await loadExportedFiles();
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to delete exported file');
      }
    } catch (err) {
      setError('Failed to delete exported file');
    } finally {
      setLoading(false);
    }
  };

  // Check if video is in funscript folder structure
  const isInFunscriptFolder = () => {
    if (!filePath) return false;
    return filePath.toLowerCase().includes('/funscript/') || filePath.toLowerCase().includes('\\funscript\\');
  };

  // Move video to funscript folder
  const moveToFunscript = async () => {
    if (!filePath) return;

    const confirmMessage = `Move this video to the funscript section?\n\n` +
      `This will:\n` +
      `• Create a funscript folder in the current directory\n` +
      `• Create a subfolder with the video's name inside the funscript folder\n` +
      `• Copy all funscript files from exported scenes to this new folder\n` +
      `• Keep the main video file in its current location\n` +
      `• Update all scene data to track the new funscript locations\n` +
      `• Preserve all your work on this video\n\n` +
      `Continue?`;

    if (!window.confirm(confirmMessage)) return;

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/scenes/video/move-to-funscript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoPath: filePath,
          copyExportedFunscripts: true
        })
      });

      if (response.ok) {
        const result = await response.json();
        console.log('Move to funscript result:', result); // Debug log
        let successMessage = `✅ Video moved successfully!\n\nNew location: ${result.newVideoPath}\n\nAll scenes and exported files have been updated to the new location.`;
        
        if (result.funscriptsCopied && result.funscriptsCopied > 0) {
          successMessage += `\n\n📁 ${result.funscriptsCopied} funscript file(s) copied from exported scenes to the main video folder.`;
        } else {
          successMessage += `\n\n📁 No funscript files were copied from exported scenes.`;
        }
        
        alert(successMessage);
        
        // Reload data to reflect new paths
        await loadScenes();
        await loadExportedFiles();
        
        // Notify parent components about the change
        window.dispatchEvent(new CustomEvent('videoMoved', { 
          detail: { 
            oldPath: filePath, 
            newPath: result.newVideoPath 
          } 
        }));
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to move video to funscript folder');
      }
    } catch (err) {
      setError('Failed to move video to funscript folder');
      console.error('Move to funscript error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Move video back from funscript folder
  const moveFromFunscript = async () => {
    if (!filePath) return;

    const confirmMessage = `Move this video back to the regular video section?\n\n` +
      `This will:\n` +
      `• Move the video file out of the funscript folder structure\n` +
      `• Move any associated funscript files with it\n` +
      `• Update all scene data and exported files to track the new location\n` +
      `• Preserve all your work on this video\n\n` +
      `Continue?`;

    if (!window.confirm(confirmMessage)) return;

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/scenes/video/move-from-funscript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoPath: filePath
        })
      });

      if (response.ok) {
        const result = await response.json();
        alert(`✅ Video moved successfully!\n\nNew location: ${result.newVideoPath}\n\nAll scenes and exported files have been updated to the new location.`);
        
        // Reload data to reflect new paths
        await loadScenes();
        await loadExportedFiles();
        
        // Notify parent components about the change
        window.dispatchEvent(new CustomEvent('videoMoved', { 
          detail: { 
            oldPath: filePath, 
            newPath: result.newVideoPath 
          } 
        }));
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to move video from funscript folder');
      }
    } catch (err) {
      setError('Failed to move video from funscript folder');
      console.error('Move from funscript error:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (seconds) => {
    if (isNaN(seconds) || seconds === undefined || seconds === null) {
      return '0:00';
    }
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getSceneColor = (index) => {
    const colors = ['primary.main', 'success.main', 'warning.main', 'secondary.main', '#F44336', '#00BCD4'];
    return colors[index % colors.length];
  };

  // Render unbuffered overlay (darkens parts of scenes that aren't buffered)
  const renderUnbufferedOverlay = () => {
    if (!effectiveDuration || scenes.length === 0) return null;

    // Create dark overlays for unbuffered portions of each scene
    const overlays = [];
    
    // Convert buffered ranges to absolute time (add stream offset)
    const absoluteBufferedRanges = bufferedRanges.map(r => ({
      start: r.start + streamOffset,
      end: r.end + streamOffset
    }));
    
    scenes.forEach((scene, sceneIndex) => {
      const sceneStart = scene.startTime;
      const sceneEnd = scene.endTime;
      
      // Find which parts of this scene are NOT buffered
      // Start with the whole scene as unbuffered
      let unbufferedRanges = [{ start: sceneStart, end: sceneEnd }];
      
      // Subtract buffered ranges (now in absolute time)
      absoluteBufferedRanges.forEach(buffered => {
        const newUnbuffered = [];
        unbufferedRanges.forEach(range => {
          // If buffered range doesn't overlap, keep the unbuffered range
          if (buffered.end <= range.start || buffered.start >= range.end) {
            newUnbuffered.push(range);
          } else {
            // Buffered range overlaps - split the unbuffered range
            if (buffered.start > range.start) {
              newUnbuffered.push({ start: range.start, end: Math.min(buffered.start, range.end) });
            }
            if (buffered.end < range.end) {
              newUnbuffered.push({ start: Math.max(buffered.end, range.start), end: range.end });
            }
          }
        });
        unbufferedRanges = newUnbuffered;
      });
      
      // Render dark overlay for each unbuffered portion
      unbufferedRanges.forEach((range, rangeIndex) => {
        const startPercent = (range.start / effectiveDuration) * 100;
        const widthPercent = ((range.end - range.start) / effectiveDuration) * 100;
        
        if (widthPercent > 0.1) { // Only render if visible
          overlays.push(
            <Box
              key={`unbuffered-${sceneIndex}-${rangeIndex}`}
              sx={{
                position: 'absolute',
                left: `${startPercent}%`,
                width: `${widthPercent}%`,
                height: '24px',
                top: '8px',
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                zIndex: 1, // Above scene colors but below thumb
                pointerEvents: 'none'
              }}
            />
          );
        }
      });
    });
    
    return overlays;
  };

  const renderSceneOverlays = () => {
    if (!effectiveDuration) return null;

    return scenes.map((scene, index) => {
      const startPercent = (scene.startTime / effectiveDuration) * 100;
      const widthPercent = ((scene.endTime - scene.startTime) / effectiveDuration) * 100;
      const color = getSceneColor(index);

      return (
        <Box
          key={scene.id}
          sx={{
            position: 'absolute',
            left: `${startPercent}%`,
            width: `${widthPercent}%`,
            height: '24px',
            top: '8px', // Align with slider track
            backgroundColor: color,
            opacity: 0.6,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            borderLeft: '1px solid rgba(255,255,255,0.3)',
            borderRight: '1px solid rgba(255,255,255,0.3)',
            zIndex: 0, // Behind slider thumb
            '&:hover': {
              opacity: 0.9,
              zIndex: 2
            }
          }}
          title={`${scene.name} (${formatTime(scene.startTime)} - ${formatTime(scene.endTime)})`}
          onClick={() => handleSeek(scene.startTime)}
        >
          {widthPercent > 5 && (
            <Typography variant="caption" sx={{ 
              color: '#fff', 
              fontSize: '0.65rem', 
              whiteSpace: 'nowrap',
              textShadow: '1px 1px 2px black',
              px: 0.5
            }}>
              {scene.name}
            </Typography>
          )}
        </Box>
      );
    });
  };

  const handleCloseClick = (event) => {
    event?.preventDefault();
    if (onClose) {
      onClose();
    }
  };

  const closeLabel = variant === 'page' ? 'Close' : '×';

  const header = null;

  const content = (
    <DialogContent sx={{ 
        p: 0, 
        backgroundColor: 'background.default',
        color: 'text.primary',
        display: 'flex',
        flexDirection: 'row',
        height: '100%',
        overflow: 'hidden'
      }}>
        {/* Close Button Overlay */}
        <Button
          onClick={onClose}
          sx={{ 
            position: 'absolute', 
            right: 8, 
            top: 8,
            zIndex: 1000,
            color: 'text.primary',
            fontSize: '1.5rem',
            minWidth: 'auto',
            padding: '4px 8px',
            backgroundColor: 'rgba(0,0,0,0.5)',
            '&:hover': { backgroundColor: 'rgba(0,0,0,0.8)' }
          }}
        >
          <CancelIcon />
        </Button>

        {/* Left Pane - Scenes List & Logs */}
        <Box sx={{ 
          width: `${leftPaneWidth}px`, 
          borderRight: '1px solid #404040', 
          display: 'flex', 
          flexDirection: 'column', 
          backgroundColor: 'background.paper',
          overflow: 'hidden',
          flexShrink: 0,
          position: 'relative'
        }}>
            {/* Resizer Handle */}
            <Box
              onMouseDown={handleMouseDown}
              sx={{
                position: 'absolute',
                right: 0,
                top: 0,
                bottom: 0,
                width: '5px',
                cursor: 'col-resize',
                zIndex: 100,
                '&:hover': {
                  backgroundColor: 'primary.main'
                }
              }}
            />
            {/* Tabs Header */}
            <Box sx={{ borderBottom: 1, borderColor: 'divider', backgroundColor: 'background.paper' }}>
              <Tabs value={activeTab} onChange={(e, v) => setActiveTab(v)} textColor="inherit" indicatorColor="primary" variant="fullWidth">
                <Tab icon={<MovieIcon />} iconPosition="start" label={`Scenes (${scenes.length})`} sx={{ color: '#fff', minHeight: '48px' }} />
                <Tab icon={<AutoFixHighIcon />} iconPosition="start" label="AI" sx={{ color: '#fff', minHeight: '48px' }} />
                <Tab icon={<TerminalIcon />} iconPosition="start" label="Logs" sx={{ color: '#fff', minHeight: '48px' }} />
              </Tabs>
            </Box>

            {/* Tab 0: Scenes List */}
            {activeTab === 0 && (
              <>
            <Box sx={{ p: 2, borderBottom: '1px solid #404040', backgroundColor: 'background.paper' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6" sx={{ color: 'text.primary' }}>
                  Scenes ({scenes.length})
                </Typography>
                <Box>
                  {selectedScenes.size > 0 && (
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={analyzeSelectedScenes}
                      disabled={isAnalyzing || loading}
                      sx={{
                        mr: 1,
                        borderColor: 'warning.main',
                        color: 'warning.main',
                        '&:hover': {
                          borderColor: 'warning.dark',
                          backgroundColor: 'rgba(255, 152, 0, 0.1)'
                        },
                        '&:disabled': {
                          borderColor: 'divider',
                          color: '#777777'
                        }
                      }}
                      startIcon={<AutoFixHighIcon />}
                    >
                      Analyze
                    </Button>
                  )}
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={analyzeFullVideo}
                    disabled={isAnalyzing || loading}
                    sx={{
                      borderColor: 'secondary.main',
                      color: 'secondary.main',
                      '&:hover': {
                        borderColor: 'secondary.dark',
                        backgroundColor: 'rgba(156, 39, 176, 0.1)'
                      },
                      '&:disabled': {
                        borderColor: 'divider',
                        color: '#777777'
                      }
                    }}
                  >
                    {isAnalyzing ? '🔄' : '🤖 AI'}
                  </Button>
                </Box>
              </Box>
              
              {/* Analysis Progress */}
              {isAnalyzing && analysisProgress && (
                <Alert severity="info" sx={{ mb: 2 }}>
                  {analysisProgress}
                </Alert>
              )}
              
              {/* Export Options */}
              <Box sx={{ mb: 1 }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={exportOptions.includeFunscript}
                      onChange={(e) => setExportOptions(prev => ({ 
                        ...prev, 
                        includeFunscript: e.target.checked 
                      }))}
                      sx={{ color: 'text.primary', '& .MuiSvgIcon-root': { fontSize: 18 } }}
                    />
                  }
                  label={<Typography variant="body2">Include Funscript</Typography>}
                  sx={{ color: 'text.primary', mr: 1 }}
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={exportOptions.createFunscriptFolder}
                      onChange={(e) => setExportOptions(prev => ({ 
                        ...prev, 
                        createFunscriptFolder: e.target.checked 
                      }))}
                      sx={{ color: 'text.primary', '& .MuiSvgIcon-root': { fontSize: 18 } }}
                    />
                  }
                  label={<Typography variant="body2">Create Folder</Typography>}
                  sx={{ color: 'text.primary' }}
                />
              </Box>
              
              {/* Bulk Actions */}
              {scenes.length > 0 && (
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Button
                    size="small"
                    onClick={selectAllScenes}
                    sx={{ color: 'primary.main', borderColor: 'primary.main', fontSize: '0.7rem' }}
                  >
                    {selectedScenes.size === scenes.length ? 'Deselect All' : 'Select All'}
                  </Button>
                  {selectedScenes.size > 0 && (
                    <Button
                      size="small"
                      onClick={cutMultipleScenes}
                      disabled={loading}
                      sx={{ 
                        color: 'warning.main', 
                        borderColor: 'warning.main',
                        fontSize: '0.7rem',
                        '&:hover': {
                          backgroundColor: 'rgba(255, 152, 0, 0.1)'
                        }
                      }}
                      startIcon={<CutIcon />}
                    >
                      Cut ({selectedScenes.size})
                    </Button>
                  )}
                  {selectedScenes.size >= 2 && (
                    <Button
                      size="small"
                      onClick={mergeSelectedScenes}
                      disabled={loading}
                      sx={{ 
                        color: 'success.main', 
                        borderColor: 'success.main',
                        fontSize: '0.7rem',
                        '&:hover': {
                          backgroundColor: 'rgba(76, 175, 80, 0.1)'
                        }
                      }}
                    >
                      Merge ({selectedScenes.size})
                    </Button>
                  )}
                  {selectedScenes.size === 2 && (
                    <Button
                      size="small"
                      onClick={openTransitionDialog}
                      disabled={loading || isAnalyzing}
                      sx={{ 
                        color: 'secondary.main', 
                        borderColor: 'secondary.main',
                        fontSize: '0.7rem',
                        '&:hover': {
                          backgroundColor: 'rgba(156, 39, 176, 0.1)'
                        }
                      }}
                    >
                      Analyze Transition
                    </Button>
                  )}
                </Box>
              )}
            </Box>

            <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
              <List>
                {scenes.map((scene, index) => (
                  <ListItem
                    key={scene.id}
                    sx={{
                      border: '1px solid',
                      borderColor: getSceneColor(index),
                      borderRadius: 1,
                      mb: 1,
                      flexDirection: 'column',
                      alignItems: 'stretch',
                      backgroundColor: 'rgba(0,0,0,0.2)'
                    }}
                  >
                    <Box sx={{ display: 'flex', width: '100%', alignItems: 'center' }}>
                      <Checkbox
                        checked={selectedScenes.has(scene.id)}
                        onChange={() => toggleSceneSelection(scene.id)}
                        sx={{ 
                          color: 'text.primary',
                          p: 0.5,
                          '&.Mui-checked': {
                            color: getSceneColor(index)
                          }
                        }}
                      />
                      <ListItemText
                        primary={scene.name}
                        secondary={`${formatTime(scene.startTime)} - ${formatTime(scene.endTime)}`}
                        onClick={() => playScene(scene.id)}
                        sx={{ 
                          cursor: 'pointer', 
                          flex: 1,
                          ml: 1,
                          '& .MuiListItemText-primary': { color: 'text.primary', fontSize: '0.9rem' },
                          '& .MuiListItemText-secondary': { color: 'text.secondary', fontSize: '0.8rem' }
                        }}
                      />
                      <ListItemSecondaryAction>
                        <IconButton
                          edge="end"
                          onClick={() => playScene(scene.id)}
                          size="small"
                          sx={{ color: 'primary.main' }}
                        >
                          <PlayIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          edge="end"
                          onClick={() => setEditingScene(index)}
                          size="small"
                          sx={{ color: 'text.primary' }}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          edge="end"
                          onClick={() => exportScene(scene.id)}
                          size="small"
                          disabled={loading}
                          sx={{ color: 'success.main' }}
                        >
                          <ExportIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          edge="end"
                          onClick={() => cutScene(scene.id)}
                          size="small"
                          disabled={loading}
                          sx={{ color: 'warning.main' }}
                        >
                          <CutIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          edge="end"
                          onClick={() => deleteScene(scene.id)}
                          size="small"
                          color="error"
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </ListItemSecondaryAction>
                    </Box>
                    
                    {/* Snap to Points */}
                    <Box sx={{ mt: 0.5, display: 'flex', gap: 1 }}>
                      <Button
                        size="small"
                        onClick={() => snapToScenePoint(scene.id, 'start')}
                        sx={{ 
                          color: 'primary.main',
                          fontSize: '0.65rem',
                          minWidth: 'auto',
                          p: '2px 4px'
                        }}
                      >
                        Use Start
                      </Button>
                      <Button
                        size="small"
                        onClick={() => snapToScenePoint(scene.id, 'end')}
                        sx={{
                          color: 'warning.main',
                          fontSize: '0.65rem',
                          minWidth: 'auto',
                          p: '2px 4px'
                        }}
                      >
                        Use End
                      </Button>
                    </Box>

                    {/* Funscript Assignment */}
                    <Box sx={{ mt: 1, p: 0.5, backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 1 }}>
                      {scene.funscriptPath ? (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Chip
                            label={scene.funscriptPath.split(/[\\\/]/).pop()}
                            size="small"
                            sx={{
                              backgroundColor: 'success.main',
                              color: 'text.primary',
                              height: '20px',
                              fontSize: '0.7rem',
                              maxWidth: '150px'
                            }}
                          />
                          <IconButton
                            size="small"
                            onClick={() => removeFunscriptFromScene(scene.id)}
                            sx={{ color: 'error.main', p: 0.5 }}
                          >
                            <CancelIcon fontSize="small" />
                          </IconButton>
                        </Box>
                      ) : (
                        <Select
                          value=""
                          displayEmpty
                          onChange={(e) => assignFunscriptToScene(scene.id, e.target.value)}
                          disabled={loading || availableFunscripts.length === 0}
                          variant="standard"
                          disableUnderline
                          sx={{
                            color: 'text.secondary',
                            fontSize: '0.75rem',
                            width: '100%'
                          }}
                        >
                          <MenuItem value="" disabled>
                            {availableFunscripts.length > 0 ? 'Assign Funscript' : 'No funscripts found in folder'}
                          </MenuItem>
                          {availableFunscripts.map((funscript, idx) => (
                            <MenuItem key={idx} value={funscript.path}>{funscript.name}</MenuItem>
                          ))}
                        </Select>
                      )}
                    </Box>
                  </ListItem>
                ))}
              </List>
            </Box>
            </>
            )}

            {/* Tab 1: AI Settings */}
            {activeTab === 1 && (
              <Box sx={{ p: 2, overflow: 'auto', flex: 1 }}>
                <Typography variant="h6" sx={{ color: 'secondary.main', mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <AutoFixHighIcon /> AI Video Analysis
                </Typography>
                
                {/* Analysis Status */}
                {isAnalyzing && (
                  <Alert severity="info" sx={{ mb: 2, backgroundColor: 'info.dark', color: '#fff' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <CircularProgress size={16} sx={{ color: '#fff' }} />
                      <span>{analysisProgress || 'Analyzing...'}</span>
                    </Box>
                  </Alert>
                )}
                
                {/* Service Status */}
                <Box sx={{ mb: 3, p: 2, backgroundColor: 'background.paper', borderRadius: 1, border: '1px solid #333' }}>
                  <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 1 }}>Service Status</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Chip 
                      label={serviceRunning ? 'Running' : 'Stopped'} 
                      size="small" 
                      sx={{ 
                        backgroundColor: serviceRunning ? 'success.main' : 'text.disabled',
                        color: '#fff'
                      }} 
                    />
                    {!serviceRunning ? (
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={() => startVideoService(false)}
                        disabled={startingService}
                        sx={{ borderColor: 'success.main', color: 'success.main' }}
                      >
                        {startingService ? 'Starting...' : 'Start Service'}
                      </Button>
                    ) : (
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={stopVideoService}
                        sx={{ borderColor: 'error.main', color: 'error.main' }}
                      >
                        Stop Service
                      </Button>
                    )}
                  </Box>
                </Box>

                {/* Analysis Configuration */}
                <Box sx={{ mb: 3, p: 2, backgroundColor: 'background.paper', borderRadius: 1, border: '1px solid #333' }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <Typography variant="subtitle2" sx={{ color: 'text.secondary' }}>Analysis Settings</Typography>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      {settingsSaved && !settingsModified && (
                        <Chip label="Saved" size="small" color="success" variant="outlined" />
                      )}
                      {settingsModified && (
                        <Chip label="Modified" size="small" color="warning" variant="outlined" />
                      )}
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={saveAnalysisSettings}
                        disabled={!settingsModified}
                        sx={{ 
                          borderColor: settingsModified ? 'success.main' : 'text.disabled',
                          color: settingsModified ? 'success.main' : 'text.disabled'
                        }}
                      >
                        Save for Batch
                      </Button>
                    </Box>
                  </Box>
                  
                  <TextField
                    label="Allowed Actions"
                    fullWidth
                    value={analysisConfig.allowedActions}
                    onChange={(e) => updateAnalysisConfig({ allowedActions: e.target.value })}
                    placeholder="e.g. reverse-cowgirl, blowjob, doggy (leave empty for all actions)"
                    helperText="Comma-separated list of actions to detect. Leave empty to detect all."
                    sx={{ 
                      mb: 2,
                      '& .MuiInputLabel-root': { color: 'text.disabled' }, 
                      '& .MuiOutlinedInput-root': { 
                        color: '#fff',
                        '& fieldset': { borderColor: 'divider' },
                        '&:hover fieldset': { borderColor: 'text.disabled' }
                      },
                      '& .MuiFormHelperText-root': { color: 'text.disabled' }
                    }}
                  />
                  
                  <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <TextField
                      label="Window Size (seconds)"
                      type="number"
                      value={analysisConfig.windowSize}
                      onChange={(e) => updateAnalysisConfig({ windowSize: e.target.value })}
                      placeholder="Auto"
                      helperText="Analysis window size. Leave empty for auto."
                      sx={{ 
                        width: 180,
                        '& .MuiInputLabel-root': { color: 'text.disabled' }, 
                        '& .MuiOutlinedInput-root': { 
                          color: '#fff',
                          '& fieldset': { borderColor: 'divider' },
                          '&:hover fieldset': { borderColor: 'text.disabled' }
                        },
                        '& .MuiFormHelperText-root': { color: 'text.disabled' }
                      }}
                    />
                    
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={analysisConfig.preserveExisting}
                          onChange={(e) => updateAnalysisConfig({ preserveExisting: e.target.checked })}
                          sx={{ color: 'text.disabled', '&.Mui-checked': { color: 'success.main' } }}
                        />
                      }
                      label={
                        <Box>
                          <Typography sx={{ color: '#fff' }}>Keep Existing Scenes</Typography>
                          <Typography variant="caption" sx={{ color: 'text.disabled' }}>Don't delete previous [Auto] scenes</Typography>
                        </Box>
                      }
                      sx={{ mt: 1 }}
                    />
                  </Box>
                  
                  <Typography variant="caption" sx={{ color: 'text.disabled', mt: 2, display: 'block' }}>
                    💡 Tip: Save settings for batch processing. When the batch queue processes this video, it will use these saved settings.
                  </Typography>
                </Box>

                {/* Action Buttons */}
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                  <Button
                    variant="contained"
                    size="large"
                    onClick={() => {
                      setAnalysisTarget('full');
                      handleStartAnalysis();
                    }}
                    disabled={isAnalyzing || loading || !serviceRunning}
                    sx={{ 
                      backgroundColor: 'secondary.main', 
                      '&:hover': { backgroundColor: 'secondary.dark' },
                      flex: 1,
                      minWidth: 200
                    }}
                    startIcon={<AutoFixHighIcon />}
                  >
                    Analyze Full Video
                  </Button>
                  
                  {selectedScenes.size > 0 && (
                    <Button
                      variant="outlined"
                      size="large"
                      onClick={() => {
                        setAnalysisTarget('selected');
                        handleStartAnalysis();
                      }}
                      disabled={isAnalyzing || loading || !serviceRunning}
                      sx={{ 
                        borderColor: 'warning.main', 
                        color: 'warning.main',
                        '&:hover': { borderColor: 'warning.dark', backgroundColor: 'rgba(255, 152, 0, 0.1)' },
                        flex: 1,
                        minWidth: 200
                      }}
                    >
                      Analyze {selectedScenes.size} Selected
                    </Button>
                  )}
                  
                  {isAnalyzing && (
                    <Button
                      variant="outlined"
                      size="large"
                      onClick={async () => {
                        if(window.confirm('Stop current analysis? Already-detected segments will be preserved.')) {
                          try {
                            await fetch('/api/video-analysis/cancel-analysis', { method: 'POST' });
                          } catch(e) { console.error(e); }
                          setIsAnalyzing(false);
                          setAnalysisProgress('');
                          await loadScenes();
                        }
                      }}
                      sx={{ 
                        borderColor: 'error.main', 
                        color: 'error.main',
                        '&:hover': { borderColor: 'error.dark', backgroundColor: 'rgba(244, 67, 54, 0.1)' }
                      }}
                    >
                      ⏹ Stop Analysis
                    </Button>
                  )}
                </Box>

                {!serviceRunning && (
                  <Alert severity="warning" sx={{ mt: 2, backgroundColor: '#5d4037', color: '#fff' }}>
                    Start the AI service first to run analysis.
                  </Alert>
                )}
              </Box>
            )}

            {/* Tab 2: Logs */}
            {activeTab === 2 && (
              <>
                <Box sx={{ p: 2, backgroundColor: 'background.paper', borderBottom: '1px solid #333' }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="subtitle2" sx={{ color: 'text.secondary' }}>Service Output</Typography>
                    <Box>
                      {!serviceRunning && (
                        <Button 
                          size="small" 
                          onClick={() => startVideoService(false)} 
                          sx={{ color: 'success.main', mr: 1, borderColor: 'success.main' }} 
                          variant="outlined"
                          disabled={startingService}
                        >
                          {startingService ? 'Starting...' : 'Start Service'}
                        </Button>
                      )}
                      {serviceRunning && (
                        <Button 
                          size="small" 
                          onClick={stopVideoService} 
                          sx={{ color: 'error.light', mr: 1, borderColor: 'error.light' }} 
                          variant="outlined"
                        >
                          Stop Service
                        </Button>
                      )}
                      {isAnalyzing && (
                        <Button 
                          size="small" 
                          onClick={async () => {
                            if(window.confirm('Stop current analysis? Any already-detected segments will be preserved.')) {
                              try {
                                await fetch('/api/video-analysis/cancel-analysis', { method: 'POST' });
                              } catch(e) { console.error(e); }
                              setIsAnalyzing(false);
                              setAnalysisProgress('');
                              // Reload scenes to show any segments that were saved before cancellation
                              await loadScenes();
                            }
                          }} 
                          sx={{ color: 'warning.main', mr: 1, borderColor: 'warning.main' }} 
                          variant="outlined"
                        >
                          Stop Analysis
                        </Button>
                      )}
                      <Button size="small" onClick={() => setServiceLogs([])} sx={{ color: 'text.secondary' }}>Clear</Button>
                    </Box>
                  </Box>
                </Box>

                <Box 
                  ref={logsContainerRef}
                  sx={{ flex: 1, overflow: 'auto', p: 2, backgroundColor: 'background.paper', fontFamily: 'monospace' }}
                >
                  {serviceLogs.length === 0 ? (
                    <Typography sx={{ color: 'text.disabled', fontStyle: 'italic', mt: 2, textAlign: 'center' }}>
                      No logs available.<br/>Start the service to see output.
                    </Typography>
                  ) : (
                    serviceLogs.map((log, i) => (
                      <Box key={i} sx={{ 
                        mb: 0.5, 
                        color: log.type === 'stderr' ? 'error.light' : 'text.secondary', 
                        fontSize: '0.8rem', 
                        whiteSpace: 'pre', 
                        width: 'fit-content',
                        minWidth: '100%',
                        pr: 2
                      }}>
                        <span style={{ color: 'text.disabled', marginRight: '8px', userSelect: 'none' }}>[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                        {log.message}
                      </Box>
                    ))
                  )}
                  <div ref={logsEndRef} />
                </Box>
              </>
            )}
        </Box>



        {/* Middle Pane - Exported Files (Conditional) */}
        {exportedFiles.length > 0 && (
          <Box sx={{ 
            width: '350px', 
            borderRight: '1px solid #404040', 
            display: 'flex', 
            flexDirection: 'column', 
            backgroundColor: 'background.paper',
            overflow: 'hidden'
          }}>
            <Box sx={{ p: 2, borderBottom: '1px solid #404040', backgroundColor: 'background.paper' }}>
              <Typography variant="h6" sx={{ color: 'text.primary' }}>
                Exported Files ({exportedFiles.length})
              </Typography>
            </Box>
            <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
              <List dense>
                {exportedFiles.map((file, index) => (
                  <ListItem
                    key={file.id}
                    sx={{
                      border: '1px solid #555555',
                      borderRadius: 1,
                      mb: 1,
                      flexDirection: 'column',
                      alignItems: 'stretch',
                      backgroundColor: 'rgba(0,0,0,0.2)'
                    }}
                  >
                    <Box sx={{ display: 'flex', width: '100%', alignItems: 'center' }}>
                      <ListItemText
                        primary={file.name}
                        secondary={
                          <Box>
                            <Typography variant="body2" color="text.secondary">
                              Size: {file.file_size ? (file.file_size / 1024 / 1024).toFixed(1) + ' MB' : 'Unknown'}
                            </Typography>
                            {file.content_type === 'funscript' && file.funscriptCount !== undefined && (
                              <Typography variant="body2" color="text.secondary">
                                Funscripts: {file.funscriptCount}
                              </Typography>
                            )}
                            <Chip
                              label={file.content_type === 'funscript' ? 'Funscript' : 'Video'}
                              size="small"
                              variant="outlined"
                              sx={{
                                mt: 0.5,
                                height: 20,
                                fontSize: '0.65rem',
                                borderColor: file.content_type === 'funscript' ? 'warning.main' : 'primary.main',
                                color: file.content_type === 'funscript' ? 'warning.main' : 'primary.main'
                              }}
                            />
                          </Box>
                        }
                        sx={{ 
                          flex: 1,
                          '& .MuiListItemText-primary': { 
                            color: 'text.primary',
                            fontSize: '0.9rem',
                            wordBreak: 'break-word'
                          },
                          '& .MuiListItemText-secondary': { color: 'text.secondary' }
                        }}
                      />
                      <ListItemSecondaryAction>
                        <IconButton
                          edge="end"
                          onClick={() => setEditingFile(editingFile === index ? null : index)}
                          size="small"
                          sx={{ color: editingFile === index ? 'success.main' : 'text.primary' }}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          edge="end"
                          onClick={() => deleteExportedFile(file.id)}
                          size="small"
                          color="error"
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </ListItemSecondaryAction>
                    </Box>
                    
                    {/* Tags */}
                    {file.tags && file.tags.length > 0 && (
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
                        {file.tags.map((tag, tagIndex) => (
                          <Chip
                            key={tagIndex}
                            label={tag}
                            size="small"
                            variant="outlined"
                            sx={{
                              borderColor: 'success.main',
                              color: 'success.main',
                              height: 20,
                              fontSize: '0.65rem'
                            }}
                          />
                        ))}
                      </Box>
                    )}
                    
                    {/* Tag editing interface */}
                    {editingFile === index && (
                      <Box sx={{ mt: 2 }}>
                        {/* Show existing tags for editing */}
                        {file.tags && file.tags.length > 0 && (
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                            {file.tags.map((tag, tagIndex) => (
                              <Chip
                                key={tagIndex}
                                label={tag}
                                onDelete={() => removeTag(tag)}
                                size="small"
                                sx={{
                                  backgroundColor: 'divider',
                                  color: 'text.primary',
                                  '& .MuiChip-deleteIcon': { color: 'text.primary' }
                                }}
                              />
                            ))}
                          </Box>
                        )}
                        
                        {/* Tag input */}
                        <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                          <Autocomplete
                            fullWidth
                            freeSolo
                            options={allTags}
                            value={newTag}
                            onChange={(event, newValue) => {
                              if (newValue && newValue.trim()) {
                                const file = exportedFiles[editingFile];
                                const currentTags = Array.isArray(file.tags) ? file.tags : [];
                                if (!currentTags.includes(newValue.trim())) {
                                  const updatedTags = [...currentTags, newValue.trim()];
                                  setExportedFiles(prevFiles => {
                                    const newFiles = [...prevFiles];
                                    newFiles[editingFile] = {
                                      ...newFiles[editingFile],
                                      tags: updatedTags
                                    };
                                    return newFiles;
                                  });
                                }
                              }
                              setNewTag(newValue || '');
                            }}
                            onInputChange={(event, newInputValue) => {
                              setNewTag(newInputValue);
                            }}
                            renderInput={(params) => (
                              <TextField
                                {...params}
                                label="Add Tag"
                                size="small"
                                onKeyPress={(e) => {
                                  if (e.key === 'Enter') {
                                    addTag();
                                  }
                                }}
                                sx={{
                                  '& .MuiInputLabel-root': { color: 'text.primary' },
                                  '& .MuiOutlinedInput-root': {
                                    color: 'text.primary',
                                    '& fieldset': { borderColor: 'divider' },
                                    '&:hover fieldset': { borderColor: 'primary.main' },
                                    '&.Mui-focused fieldset': { borderColor: 'primary.main' }
                                  }
                                }}
                              />
                            )}
                            sx={{
                              '& .MuiAutocomplete-popupIndicator': { color: 'text.primary' },
                              '& .MuiAutocomplete-clearIndicator': { color: 'text.primary' }
                            }}
                          />
                          <Button
                            variant="outlined"
                            onClick={addTag}
                            size="small"
                            sx={{ minWidth: 'auto', p: 1 }}
                          >
                            <AddIcon fontSize="small" />
                          </Button>
                        </Box>
                        
                        {/* Save/Cancel buttons */}
                        <Box sx={{ display: 'flex', gap: 1 }}>
                          <Button
                            variant="contained"
                            onClick={() => updateExportedFileTags(file.id)}
                            disabled={loading}
                            size="small"
                            fullWidth
                            sx={{ backgroundColor: 'success.main' }}
                          >
                            Save
                          </Button>
                          <Button
                            variant="outlined"
                            onClick={() => setEditingFile(null)}
                            size="small"
                            fullWidth
                            sx={{ borderColor: 'text.disabled', color: 'text.primary' }}
                          >
                            Cancel
                          </Button>
                        </Box>
                      </Box>
                    )}
                  </ListItem>
                ))}
              </List>
            </Box>
          </Box>
        )}

        {/* Right Pane - Main Content */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', p: 2, gap: 2 }}>
          {/* Video Player Section */}
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <Paper sx={{ 
              p: 2, 
              backgroundColor: 'background.paper',
              border: '1px solid #404040',
              display: 'flex',
              flexDirection: 'column',
              height: '100%'
            }}>
                <Box sx={{ position: 'relative', mb: 2, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#000', overflow: 'hidden' }}>
                  <video
                    ref={videoRef}
                    src={streamingVideoSrc}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain'
                    }}
                    controls={false}
                    preload="metadata"
                  />
                </Box>
                  
                  {/* Custom Controls */}
                  <Box sx={{ mt: 'auto' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                      <IconButton 
                        onClick={handlePlayPause}
                        sx={{ color: 'text.primary' }}
                      >
                        {isPlaying ? <PauseIcon /> : <PlayIcon />}
                      </IconButton>
                      <Typography variant="body2" sx={{ mx: 1, color: 'text.primary' }}>
                        {formatTime(currentTime)} / {formatTime(effectiveDuration)}
                        {bufferedRanges.length > 0 && effectiveDuration > 1 && (
                          <span style={{ color: 'text.disabled', marginLeft: 8, fontSize: '0.8em' }}>
                            (buffered: {Math.min(100, Math.round((bufferedRanges.reduce((acc, r) => acc + (r.end - r.start), 0) / effectiveDuration) * 100))}%)
                          </span>
                        )}
                      </Typography>
                      <Typography variant="body2" sx={{ mx: 1, color: 'text.primary' }}>
                        Speed: {playbackRate}x
                      </Typography>
                    </Box>
                    
                    {/* Timeline with Scene Overlays */}
                    <Box sx={{ position: 'relative', mb: 5, height: '40px', display: 'flex', alignItems: 'center' }}>
                      <Slider
                        value={currentTime}
                        min={0}
                        max={effectiveDuration > 0 ? effectiveDuration : 100}
                        onChange={(_, value) => handleSeek(value)}
                        valueLabelDisplay="auto"
                        valueLabelFormat={formatTime}
                        sx={{ 
                          padding: 0,
                          height: '40px',
                          '& .MuiSlider-track': { height: 4, backgroundColor: 'primary.main', opacity: 0.5 },
                          '& .MuiSlider-thumb': { 
                            color: 'primary.main', 
                            width: 2, 
                            height: 40, 
                            borderRadius: 0,
                            zIndex: 10,
                            '&::after': {
                              content: '""',
                              position: 'absolute',
                              top: 45,
                              left: '50%',
                              transform: 'translateX(-50%)',
                              width: 40,
                              height: 20,
                              backgroundColor: 'currentColor',
                              borderRadius: 6,
                              boxShadow: '0 2px 4px rgba(0,0,0,0.5)'
                            },
                            '&:hover, &.Mui-focusVisible': {
                              boxShadow: 'none',
                              '&::after': {
                                backgroundColor: '#64B5F6'
                              }
                            }
                          },
                          '& .MuiSlider-rail': { backgroundColor: 'divider', height: 4 }
                        }}
                      />
                      {renderSceneOverlays()}
                      {renderUnbufferedOverlay()}
                    </Box>
                    
                    {/* Playback Rate Control */}
                    <Box sx={{ mb: 2 }}>
                      <Box sx={{ display: 'flex', gap: 0.5, mt: 1, justifyContent: 'center', flexWrap: 'wrap' }}>
                        {[0.1, 0.25, 0.5, 1, 2, 5, 10, 15].map(speed => (
                          <Button
                            key={speed}
                            size="small"
                            variant={playbackRate === speed ? "contained" : "outlined"}
                            onClick={() => handlePlaybackRateChange(speed)}
                            sx={{ 
                              minWidth: 'auto',
                              fontSize: '0.6rem',
                              padding: '2px 4px',
                              color: playbackRate === speed ? 'text.primary' : 'success.main',
                              borderColor: 'success.main',
                              backgroundColor: playbackRate === speed ? 'success.main' : 'transparent',
                              '&:hover': {
                                backgroundColor: playbackRate === speed ? '#45a049' : 'rgba(76, 175, 80, 0.1)'
                              }
                            }}
                          >
                            {speed}x
                          </Button>
                        ))}
                      </Box>
                    </Box>

                    {/* Seeking Controls */}
                    <Box sx={{ mb: 2 }}>
                      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 1, mb: 1 }}>
                        {/* Backward Controls */}
                        <Button size="small" onClick={() => seekBackward(15)} sx={{ color: 'warning.main', borderColor: 'warning.main', fontSize: '0.7rem', minWidth: 'auto', padding: '4px 8px' }} startIcon={<FastRewindIcon />}>15s</Button>
                        <Button size="small" onClick={() => seekBackward(5)} sx={{ color: 'warning.main', borderColor: 'warning.main', fontSize: '0.7rem', minWidth: 'auto', padding: '4px 8px' }} startIcon={<SkipPreviousIcon />}>5s</Button>
                        <Button size="small" onClick={() => seekBackward(1)} sx={{ color: 'warning.main', borderColor: 'warning.main', fontSize: '0.7rem', minWidth: 'auto', padding: '4px 8px' }} startIcon={<SkipPreviousIcon />}>1s</Button>
                        <Button size="small" onClick={() => seekBackward(0.2)} sx={{ color: 'warning.main', borderColor: 'warning.main', fontSize: '0.7rem', minWidth: 'auto', padding: '4px 8px' }} startIcon={<SkipPreviousIcon />}>.2s</Button>
                        
                        {/* Forward Controls */}
                        <Button size="small" onClick={() => seekForward(0.2)} sx={{ color: 'primary.main', borderColor: 'primary.main', fontSize: '0.7rem', minWidth: 'auto', padding: '4px 8px' }} endIcon={<SkipNextIcon />}>.2s</Button>
                        <Button size="small" onClick={() => seekForward(1)} sx={{ color: 'primary.main', borderColor: 'primary.main', fontSize: '0.7rem', minWidth: 'auto', padding: '4px 8px' }} endIcon={<SkipNextIcon />}>1s</Button>
                        <Button size="small" onClick={() => seekForward(5)} sx={{ color: 'primary.main', borderColor: 'primary.main', fontSize: '0.7rem', minWidth: 'auto', padding: '4px 8px' }} endIcon={<SkipNextIcon />}>5s</Button>
                        <Button size="small" onClick={() => seekForward(15)} sx={{ color: 'primary.main', borderColor: 'primary.main', fontSize: '0.7rem', minWidth: 'auto', padding: '4px 8px' }} endIcon={<FastForwardIcon />}>15s</Button>
                      </Box>
                    </Box>
                  </Box>
                
                
                {/* Video Management Controls */}
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap', mt: 2 }}>
                  <Typography variant="body2" sx={{ color: 'text.secondary', flex: '1 1 auto' }}>
                    Location: {isInFunscriptFolder() ? 'Funscript Section' : 'Regular Videos'}
                  </Typography>
                  
                  {!isInFunscriptFolder() ? (
                    <Button
                      variant="contained"
                      size="small"
                      onClick={moveToFunscript}
                      disabled={loading}
                      sx={{ backgroundColor: 'warning.main', color: 'text.primary' }}
                    >
                      📁 Move to Funscript
                    </Button>
                  ) : (
                    <Button
                      variant="contained"
                      size="small"
                      onClick={moveFromFunscript}
                      disabled={loading}
                      sx={{ backgroundColor: 'primary.main', color: 'text.primary' }}
                    >
                      ↩️ Move Back
                    </Button>
                  )}
                </Box>
              </Paper>
            </Box>
            
            {/* Scene Creation Controls */}
            <Paper sx={{ 
              p: 2,
              backgroundColor: 'background.paper',
              border: '1px solid #404040',
              flex: '0 0 auto'
            }}>
              <Typography variant="h6" gutterBottom sx={{ color: 'text.primary' }}>
                {editingScene !== null ? 'Edit Scene' : 'Create New Scene'}
              </Typography>
              
              {error && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {error}
                </Alert>
              )}
              
              <Grid container spacing={2}>
                {/* Row 1: Scene Name */}
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Scene Name"
                    size="small"
                    value={editingScene !== null ? scenes[editingScene]?.name || '' : currentScene.name}
                    onChange={(e) => {
                      if (editingScene !== null) {
                        const updatedScenes = [...scenes];
                        updatedScenes[editingScene].name = e.target.value;
                        setScenes(updatedScenes);
                      } else {
                        setCurrentScene(prev => ({ ...prev, name: e.target.value }));
                      }
                    }}
                    sx={{
                      '& .MuiInputLabel-root': { color: 'text.primary' },
                      '& .MuiOutlinedInput-root': {
                        color: 'text.primary',
                        '& fieldset': { borderColor: 'divider' },
                        '&:hover fieldset': { borderColor: 'primary.main' },
                        '&.Mui-focused fieldset': { borderColor: 'primary.main' }
                      }
                    }}
                  />
                </Grid>
                
                {/* Row 2: Start Time and End Time */}
                <Grid item xs={6}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <TextField
                      fullWidth
                      label="Start"
                      size="small"
                      type="number"
                      value={editingScene !== null ? 
                        (isNaN(scenes[editingScene]?.startTime) ? 0 : Math.round((scenes[editingScene]?.startTime ?? 0) * 100) / 100) : 
                        (isNaN(currentScene.startTime) ? 0 : Math.round((currentScene.startTime ?? 0) * 100) / 100)
                      }
                      onChange={(e) => {
                        const value = parseFloat(e.target.value);
                        const finalValue = isNaN(value) ? 0 : Math.round(value * 100) / 100;
                        if (editingScene !== null) {
                          const updatedScenes = [...scenes];
                          updatedScenes[editingScene].startTime = finalValue;
                          setScenes(updatedScenes);
                        } else {
                          setCurrentScene(prev => ({ ...prev, startTime: finalValue }));
                        }
                      }}
                      InputProps={{ step: 0.1 }}
                      sx={{
                        '& .MuiInputLabel-root': { color: 'text.primary' },
                        '& .MuiOutlinedInput-root': {
                          color: 'text.primary',
                          '& fieldset': { borderColor: 'divider' }
                        }
                      }}
                    />
                    <Button
                      variant="outlined"
                      onClick={setCurrentTimeAsStart}
                      sx={{ borderColor: 'primary.main', color: 'primary.main', minWidth: '60px' }}
                    >
                      NOW
                    </Button>
                    <Button
                      variant="outlined"
                      onClick={setStartToPreviousEnd}
                      sx={{ borderColor: 'warning.main', color: 'warning.main', minWidth: '60px', fontSize: '0.65rem', lineHeight: 1.2 }}
                    >
                      PREV END
                    </Button>
                  </Box>
                </Grid>
                
                <Grid item xs={6}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <TextField
                      fullWidth
                      label="End"
                      size="small"
                      type="number"
                      value={editingScene !== null ? 
                        (isNaN(scenes[editingScene]?.endTime) ? 0 : Math.round((scenes[editingScene]?.endTime ?? 0) * 100) / 100) : 
                        (isNaN(currentScene.endTime) ? 0 : Math.round((currentScene.endTime ?? 0) * 100) / 100)
                      }
                      onChange={(e) => {
                        const value = parseFloat(e.target.value);
                        const finalValue = isNaN(value) ? 0 : Math.round(value * 100) / 100;
                        if (editingScene !== null) {
                          const updatedScenes = [...scenes];
                          updatedScenes[editingScene].endTime = finalValue;
                          setScenes(updatedScenes);
                        } else {
                          setCurrentScene(prev => ({ ...prev, endTime: finalValue }));
                        }
                      }}
                      InputProps={{ step: 0.1 }}
                      sx={{
                        '& .MuiInputLabel-root': { color: 'text.primary' },
                        '& .MuiOutlinedInput-root': {
                          color: 'text.primary',
                          '& fieldset': { borderColor: 'divider' }
                        }
                      }}
                    />
                    <Button
                      variant="outlined"
                      onClick={setCurrentTimeAsEnd}
                      sx={{ borderColor: 'primary.main', color: 'primary.main', minWidth: '60px' }}
                    >
                      NOW
                    </Button>
                    <Button
                      variant="outlined"
                      onClick={setEndToNextStart}
                      sx={{ borderColor: 'warning.main', color: 'warning.main', minWidth: '60px', fontSize: '0.65rem', lineHeight: 1.2 }}
                    >
                      NEXT START
                    </Button>
                  </Box>
                </Grid>
                
                {/* Row 3: Action Buttons */}
                <Grid item xs={12}>
                  <Button
                    variant="contained"
                    onClick={editingScene !== null ? () => updateScene(scenes[editingScene].id) : saveScene}
                    disabled={loading}
                    startIcon={<SaveIcon />}
                    fullWidth
                    sx={{
                      backgroundColor: 'primary.main',
                      color: 'text.primary',
                      fontWeight: 'bold',
                      '&:hover': { backgroundColor: 'primary.dark' }
                    }}
                  >
                    {editingScene !== null ? 'UPDATE SCENE' : 'SAVE SCENE'}
                  </Button>
                  {editingScene !== null && (
                    <Button
                      variant="outlined"
                      onClick={() => setEditingScene(null)}
                      fullWidth
                      sx={{ mt: 1, borderColor: 'text.disabled', color: 'text.primary' }}
                      startIcon={<CancelIcon />}
                    >
                      Cancel Edit
                    </Button>
                  )}
                </Grid>
              </Grid>
            </Paper>
        </Box>
    </DialogContent>
  );

  const extraDialogs = (
    <>
      {/* Action Picker Dialog */}
      {/* Start Service Dialog - shown when AI Analyze clicked but service not running */}
      <Dialog
        open={showActionPicker}
        onClose={() => setShowActionPicker(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: { 
            backgroundColor: 'background.paper',
            color: 'text.primary'
          }
        }}
      >
        <DialogTitle sx={{ backgroundColor: 'background.default', borderBottom: '1px solid #404040' }}>
          🤖 AI Video Analysis
        </DialogTitle>
        <DialogContent sx={{ p: 3 }}>
          {/* Service not running - show start button */}
          {serviceRunning === false && !startingService && (
            <Box sx={{ textAlign: 'center', py: 3 }}>
              <Typography variant="body1" sx={{ mb: 2, color: '#ff9800' }}>
                ⚠️ Video Analysis Service Not Running
              </Typography>
              <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
                The Qwen2-VL video analysis service needs to be started.
              </Typography>
              <Typography variant="body2" sx={{ mb: 3, color: 'text.disabled' }}>
                This will start the AI service in the background.
                First load may take 2-3 minutes to download and initialize.
                You can view the progress in the "Logs" tab.
              </Typography>
              <Button
                variant="contained"
                onClick={startVideoService}
                sx={{
                  backgroundColor: 'secondary.main',
                  '&:hover': { backgroundColor: 'secondary.dark' }
                }}
              >
                🚀 Start AI Service
              </Button>
            </Box>
          )}
          
          {/* Service starting */}
          {startingService && (
            <Box sx={{ textAlign: 'center', py: 3 }}>
              <CircularProgress sx={{ mb: 2, color: 'secondary.main' }} />
              <Typography variant="body1" sx={{ color: 'secondary.main' }}>
                Starting service & loading model...
              </Typography>
              <Typography variant="body2" sx={{ mt: 1, color: 'text.secondary' }}>
                This may take 1-2 minutes. Check the Logs tab for progress.
              </Typography>
              <Typography variant="body2" sx={{ mt: 2, color: 'text.disabled' }}>
                Once ready, analysis will start automatically.
              </Typography>
            </Box>
          )}
          
          {/* Unknown state - checking */}
          {serviceRunning === null && !startingService && (
            <Box sx={{ textAlign: 'center', py: 3 }}>
              <CircularProgress size={24} sx={{ color: 'secondary.main' }} />
              <Typography variant="body2" sx={{ mt: 2, color: 'text.secondary' }}>
                Checking service status...
              </Typography>
            </Box>
          )}
        </DialogContent>
        <Box sx={{ p: 2, borderTop: '1px solid #404040', display: 'flex', justifyContent: 'flex-end' }}>
          <Button 
            onClick={() => setShowActionPicker(false)}
            sx={{ color: 'text.secondary' }}
          >
            Cancel
          </Button>
        </Box>
      </Dialog>

      {/* Analysis Configuration Dialog */}
      <Dialog
        open={showAnalysisConfig}
        onClose={() => setShowAnalysisConfig(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: { backgroundColor: 'background.paper', color: 'text.primary' }
        }}
      >
        <DialogTitle sx={{ backgroundColor: 'background.default', borderBottom: '1px solid #404040' }}>
          {analysisTarget === 'selected' ? 'Batch Analysis Configuration' : 'Full Video Analysis Configuration'}
        </DialogTitle>
        <DialogContent sx={{ p: 3 }}>
          <Typography variant="body2" sx={{ mb: 3, color: 'text.secondary' }}>
            Configure the AI analysis parameters.
          </Typography>
          
          <TextField
            label="Allowed Actions (comma separated)"
            fullWidth
            value={analysisConfig.allowedActions}
            onChange={(e) => setAnalysisConfig(prev => ({ ...prev, allowedActions: e.target.value }))}
            placeholder="e.g. reverse-cowgirl, blowjob, handjob"
            sx={{ mb: 3, '& .MuiInputLabel-root': { color: 'text.secondary' }, '& .MuiOutlinedInput-root': { color: '#fff', '& fieldset': { borderColor: 'divider' } } }}
            helperText="Leave empty to detect all supported actions."
          />

          <TextField
            label="Window Size (seconds)"
            fullWidth
            type="number"
            value={analysisConfig.windowSize}
            onChange={(e) => setAnalysisConfig(prev => ({ ...prev, windowSize: e.target.value }))}
            placeholder={videoDuration ? `${Math.max(4, Math.min(8, Math.floor(videoDuration * 0.025)))}` : "Auto"}
            sx={{ mb: 1, '& .MuiInputLabel-root': { color: 'text.secondary' }, '& .MuiOutlinedInput-root': { color: '#fff', '& fieldset': { borderColor: 'divider' } } }}
            helperText={`Controls the context window for analysis. Default is calculated based on video length.`}
          />
        </DialogContent>
        <DialogActions sx={{ p: 2, borderTop: '1px solid #404040' }}>
          <Button onClick={() => setShowAnalysisConfig(false)} sx={{ color: 'text.secondary' }}>
            Cancel
          </Button>
          <Button 
            onClick={handleStartAnalysis}
            variant="contained"
            sx={{ backgroundColor: 'primary.main', '&:hover': { backgroundColor: 'primary.dark' } }}
          >
            Run Analysis
          </Button>
        </DialogActions>
      </Dialog>

      {/* Transition Analysis Dialog */}
      <Dialog
        open={showTransitionDialog}
        onClose={() => setShowTransitionDialog(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: { backgroundColor: 'background.paper', color: 'text.primary' }
        }}
      >
        <DialogTitle sx={{ backgroundColor: 'background.default', borderBottom: '1px solid #404040' }}>
          Detailed Transition Analysis
        </DialogTitle>
        <DialogContent sx={{ p: 3 }}>
          <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
            Analyze the transition between the two selected scenes with higher precision.
          </Typography>
          
          <TextField
            label="Allowed Actions (comma separated)"
            fullWidth
            value={transitionParams.prompt}
            onChange={(e) => setTransitionParams(prev => ({ ...prev, prompt: e.target.value }))}
            sx={{ mb: 3, mt: 1, '& .MuiInputLabel-root': { color: 'text.secondary' }, '& .MuiOutlinedInput-root': { color: '#fff', '& fieldset': { borderColor: 'divider' } } }}
            helperText="Leave empty to allow all actions, or specify expected actions."
          />
          
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField
                label="Start Time (s)"
                type="number"
                value={Math.round(transitionParams.startTime * 100) / 100}
                onChange={(e) => setTransitionParams(prev => ({ ...prev, startTime: parseFloat(e.target.value) || 0 }))}
                fullWidth
                inputProps={{ step: 0.1 }}
                helperText={formatTime(transitionParams.startTime)}
                sx={{ '& .MuiInputLabel-root': { color: 'text.secondary' }, '& .MuiOutlinedInput-root': { color: '#fff', '& fieldset': { borderColor: 'divider' } }, '& .MuiFormHelperText-root': { color: 'text.disabled' } }}
            />
            <TextField
                label="End Time (s)"
                type="number"
                value={Math.round(transitionParams.endTime * 100) / 100}
                onChange={(e) => setTransitionParams(prev => ({ ...prev, endTime: parseFloat(e.target.value) || 0 }))}
                fullWidth
                inputProps={{ step: 0.1 }}
                helperText={formatTime(transitionParams.endTime)}
                sx={{ '& .MuiInputLabel-root': { color: 'text.secondary' }, '& .MuiOutlinedInput-root': { color: '#fff', '& fieldset': { borderColor: 'divider' } }, '& .MuiFormHelperText-root': { color: 'text.disabled' } }}
            />
            <TextField
                label="Original Window (s)"
                type="number"
                value={transitionParams.windowSize || 0}
                onChange={(e) => setTransitionParams(prev => ({ ...prev, windowSize: parseFloat(e.target.value) || 0 }))}
                fullWidth
                inputProps={{ step: 1, min: 0 }}
                helperText="Window size used in analysis"
                sx={{ '& .MuiInputLabel-root': { color: 'text.secondary' }, '& .MuiOutlinedInput-root': { color: '#fff', '& fieldset': { borderColor: 'divider' } }, '& .MuiFormHelperText-root': { color: 'text.disabled' } }}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2, borderTop: '1px solid #404040' }}>
          <Button onClick={() => setShowTransitionDialog(false)} sx={{ color: 'text.secondary' }}>Cancel</Button>
          <Button onClick={runTransitionAnalysis} variant="contained" color="primary">Find Exact Cut</Button>
        </DialogActions>
      </Dialog>
    </>
  );

  if (variant === 'page') {
    return (
      
        <Box sx={{ height: '100vh', backgroundColor: 'background.default', color: 'text.primary', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <Box sx={{ width: '98%', mx: 'auto', py: 2, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {header}
            {content}
          </Box>
          {extraDialogs}
        </Box>
      
    );
  }

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth={false}
        fullWidth
        PaperProps={{
          sx: { 
            width: '98vw',
            maxWidth: '100vw',
            height: '95vh', 
            maxHeight: '95vh',
            backgroundColor: 'background.default',
            color: 'text.primary',
            m: 1
          }
        }}
      >
        {header}
        {content}
      </Dialog>
      {extraDialogs}
    </>
  );
};

export default SceneManagerModal;
