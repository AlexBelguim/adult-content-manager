import React, { useState, useRef, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
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
  Alert,
  Autocomplete,
  Select,
  MenuItem
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
  SkipPrevious as SkipPreviousIcon
} from '@mui/icons-material';
import { useAsk, useNotify, errorText, plural } from '../components/ui';

// A failed request as an error: what we tried, then the server's own words.
const failure = async (response, what) => {
  const payload = await response.json().catch(() => ({}));
  return new Error(payload.error ? `${what}: ${payload.error}` : what);
};

const fileNameOfPath = (p) => String(p || '').split(/[\\/]/).pop();

const SceneManagerModal = ({ open, onClose, videoSrc, filePath, variant = 'modal' }) => {
  const ask = useAsk();
  const notify = useNotify();
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
  const [leftPaneWidth, setLeftPaneWidth] = useState(600);
  const isDraggingRef = useRef(false);

  // Merge Scenes
  const mergeSelectedScenes = async () => {
    if (selectedScenes.size < 2) return;
    const count = selectedScenes.size;

    const merged = await ask({
      title: `Merge ${count} scenes into one?`,
      text: 'The first is stretched to the end of the last; the others are deleted.',
      okLabel: `Merge ${count} scenes`,
      busyLabel: 'Merging…',
      run: async () => {
        setLoading(true);
        try {
          // Selected scene objects, by start time
          const selected = scenes.filter(s => selectedScenes.has(s.id));
          selected.sort((a, b) => a.startTime - b.startTime);

          const first = selected[0];
          const last = selected[selected.length - 1];

          // Stretch the first scene to the end of the last
          const updatedScene = {
            ...first,
            endTime: last.endTime,
          };

          const updated = await fetch('/api/scenes/update', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sceneId: first.id, scene: updatedScene })
          });
          if (!updated.ok) throw await failure(updated, 'Could not merge the scenes');

          // Delete the others (the id goes in the path). A 404 means it is already gone,
          // so trying again after a failure goes through.
          try {
            for (let i = 1; i < selected.length; i++) {
              const removed = await fetch(`/api/scenes/delete/${selected[i].id}`, { method: 'DELETE' });
              if (!removed.ok && removed.status !== 404) {
                throw await failure(removed, `Could not delete the scene "${selected[i].name}"`);
              }
            }
          } finally {
            // The first scene is stretched by now, whatever happened after
            await loadScenes();
          }
          setSelectedScenes(new Set());
        } catch (err) {
          console.error('Merge failed', err);
          throw new Error(errorText(err, 'Could not merge the scenes'));
        } finally {
          setLoading(false);
        }
      },
    });
    if (merged) notify(`Merged ${count} scenes`);
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loads again only for a new video
  }, [open, filePath]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-attaches when a new <video> element is in the ref
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the handler reads the video through its ref
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
    const scene = scenes.find(s => s.id === sceneId);
    const sure = await ask({
      title: scene ? `Delete the scene "${scene.name}"?` : 'Delete this scene?',
      text: 'Only the scene marker goes; the video is not touched.',
      okLabel: 'Delete scene',
      danger: true,
    });
    if (!sure) return;

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

    let result = null;
    const done = await ask({
      title: `Cut "${scene.name}" out of the video?`,
      rows: [
        ['Video', fileNameOfPath(filePath)],
        ['Part', `${formatTime(scene.startTime)} – ${formatTime(scene.endTime)}`],
      ],
      text: 'The original file is rewritten without this part. Later scenes and the funscript shift to match. ' +
        'Scenes that overlap this part lose that footage and no longer line up. Cannot be undone.',
      okLabel: 'Cut from the video',
      danger: true,
      busyLabel: 'Cutting…',
      run: async () => {
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
          if (!response.ok) throw await failure(response, 'Could not cut the scene');
          result = await response.json();

          // Reload scenes to reflect the updated timestamps
          await loadScenes();

          // Notify FunscriptPlayer components about scene changes
          window.dispatchEvent(new CustomEvent('scenesUpdated'));
        } catch (err) {
          throw new Error(errorText(err, 'Could not cut the scene'));
        } finally {
          setLoading(false);
        }
      },
    });
    if (!done) return;

    const shifted = result?.updatedScenes > 0 ? `; ${plural(result.updatedScenes, 'later scene')} shifted` : '';
    notify(`Cut "${scene.name}" from the video${shifted}`);
  };

  const cutMultipleScenes = async () => {
    if (selectedScenes.size === 0) return;

    const scenesToCut = Array.from(selectedScenes).map(id =>
      scenes.find(s => s.id === id)
    ).filter(Boolean);
    const count = scenesToCut.length;
    const inOrder = [...scenesToCut].sort((a, b) => a.startTime - b.startTime);

    const done = await ask({
      title: `Cut ${count} scenes out of the video?`,
      rows: [
        ['Video', fileNameOfPath(filePath)],
        ...inOrder.map(s => [s.name, `${formatTime(s.startTime)} – ${formatTime(s.endTime)}`]),
      ],
      text: 'The original file is rewritten without these parts. Later scenes and the funscript shift to match. ' +
        'Scenes that overlap a part lose that footage and no longer line up, and scenes between two cut parts end up too early. ' +
        'Cannot be undone.',
      okLabel: `Cut ${count} scenes`,
      danger: true,
      busyLabel: 'Cutting…',
      run: async () => {
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
          if (!response.ok) throw await failure(response, 'Could not cut the scenes');

          // Clear selection and reload scenes
          setSelectedScenes(new Set());
          await loadScenes();

          // Notify FunscriptPlayer components about scene changes
          window.dispatchEvent(new CustomEvent('scenesUpdated'));
        } catch (err) {
          throw new Error(errorText(err, 'Could not cut the scenes'));
        } finally {
          setLoading(false);
        }
      },
    });
    if (done) notify(`Cut ${count} scenes from the video`);
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
        notify(`Exported to ${result.exportPath}`);
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
    const fileName = file ? file.name : 'the file';

    let result = null;
    const done = await ask({
      title: file ? `Delete the exported file "${fileName}"?` : 'Delete this exported file?',
      text: 'The video file and its funscript are deleted from disk. ' +
        'When it sits in its own funscript folder, that whole folder goes, with everything in it.',
      okLabel: 'Delete file',
      danger: true,
      busyLabel: 'Deleting…',
      run: async () => {
        setLoading(true);
        setError('');
        try {
          const response = await fetch(`/api/scenes/exported-file/${fileId}`, {
            method: 'DELETE'
          });
          if (!response.ok) throw await failure(response, 'Could not delete the file');
          result = await response.json();
          await loadExportedFiles();
        } catch (err) {
          throw new Error(errorText(err, 'Could not delete the file'));
        } finally {
          setLoading(false);
        }
      },
    });
    if (!done) return;

    if (result?.fileDeleted) {
      const also = result.folderDeleted ? ' and its folder' : result.funscriptDeleted ? ' and its funscript' : '';
      notify(`Deleted ${fileName}${also}`);
    } else {
      notify({ severity: 'warning', message: 'The record is gone, but the file may still be on disk' });
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

    const videoName = fileNameOfPath(filePath).replace(/\.[^.]+$/, '');
    let result = null;
    const done = await ask({
      title: 'Move this video to the funscript section?',
      text: `The video and the funscripts named like it move to funscript/${videoName}/ in its folder, ` +
        'and the funscripts of its exported scenes are copied there. Scenes and exported files follow it.',
      okLabel: 'Move video',
      busyLabel: 'Moving…',
      run: async () => {
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
          if (!response.ok) throw await failure(response, 'Could not move the video');
          result = await response.json();

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
        } catch (err) {
          console.error('Move to funscript error:', err);
          throw new Error(errorText(err, 'Could not move the video'));
        } finally {
          setLoading(false);
        }
      },
    });
    if (!done) return;

    const copied = result?.funscriptsCopied > 0 ? `, ${plural(result.funscriptsCopied, 'funscript')} copied` : '';
    notify(`Moved to ${result?.newVideoPath}${copied}`);
  };

  // Move video back from funscript folder
  const moveFromFunscript = async () => {
    if (!filePath) return;

    let result = null;
    const done = await ask({
      title: 'Move this video back to the videos section?',
      text: 'The video and the funscripts named like it move out of the funscript folder. ' +
        'Afterwards the server deletes every funscript named like the video in the target folder, ' +
        'which includes the ones it just moved.',
      okLabel: 'Move back',
      danger: true,
      busyLabel: 'Moving…',
      run: async () => {
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
          if (!response.ok) throw await failure(response, 'Could not move the video back');
          result = await response.json();

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
        } catch (err) {
          console.error('Move from funscript error:', err);
          throw new Error(errorText(err, 'Could not move the video back'));
        } finally {
          setLoading(false);
        }
      },
    });
    if (done) notify(`Moved to ${result?.newVideoPath}`);
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
              color: 'var(--text)', 
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
            <Box sx={{ p: 2, borderBottom: '1px solid #404040', backgroundColor: 'background.paper' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6" sx={{ color: 'text.primary' }}>
                  Scenes ({scenes.length})
                </Typography>
              </Box>
              
              
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
                          backgroundColor: 'var(--warn-quiet)'
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
                          backgroundColor: 'var(--ok-quiet)'
                        }
                      }}
                    >
                      Merge ({selectedScenes.size})
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
                            label={scene.funscriptPath.split(/[\\/]/).pop()}
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
                <Box sx={{ position: 'relative', mb: 2, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg)', overflow: 'hidden' }}>
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
                                backgroundColor: 'var(--info)'
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
                                backgroundColor: playbackRate === speed ? '#45a049' : 'var(--ok-quiet)'
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

  if (variant === 'page') {
    return (
      
        <Box sx={{ height: '100vh', backgroundColor: 'background.default', color: 'text.primary', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <Box sx={{ width: '98%', mx: 'auto', py: 2, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {header}
            {content}
          </Box>
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
    </>
  );
};

export default SceneManagerModal;
