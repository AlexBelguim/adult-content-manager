import React, { useState, useEffect, useCallback, useRef } from 'react';
import { loadShortcuts } from '../utils/settings';
import BackgroundTaskQueue from './BackgroundTaskQueue';
import '../utils/FunscriptPlayer.js'; // Register custom element
import './FunscriptPlayerEmbed.css';
import {
  Container,
  Typography,
  Box,
  Button,
  CardMedia,
  LinearProgress,
  IconButton,
  FormControl,
  Select,
  MenuItem,
  InputLabel,
  Switch,
  FormControlLabel
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Image as ImageIcon,
  Movie as MovieIcon,
  SportsEsports as GameIcon,
  KeyboardArrowLeft as PrevIcon,
  KeyboardArrowRight as NextIcon,
  Upload as UploadIcon
} from '@mui/icons-material';

function PerformerFilterView({ performer, onBack, onNext, onComplete, handyIntegration, handyConnected, initialTab }) {
  const [currentTab, setCurrentTab] = useState(initialTab || 'pics'); // 'pics', 'vids', 'funscript_vids'
  const [files, setFiles] = useState([]);
  const [totalFiles, setTotalFiles] = useState(0);
  const [hasMoreFiles, setHasMoreFiles] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [sortBy, setSortBy] = useState(() => localStorage.getItem('performerFilterSortBy') || 'name'); // can be 'name', 'funscript_count', etc.
  const [shortcuts, setShortcuts] = useState({});
  const [sortOrder, setSortOrder] = useState(() => localStorage.getItem('performerFilterSortOrder') || 'asc');
  const [progress, setProgress] = useState(0);
  const [hideKeptFiles, setHideKeptFiles] = useState(true);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingMoreFiles, setLoadingMoreFiles] = useState(false);
  const [abortController, setAbortController] = useState(null);
  const [isGoingBack, setIsGoingBack] = useState(false);
  const [filesLoaded, setFilesLoaded] = useState(0);
  const [backgroundTasks, setBackgroundTasks] = useState([]);
  const pollingIntervalRef = useRef(null);

  // Missing ML variables definition (added to fix runtime errors)
  const [mlEnabled, setMlEnabled] = useState(false);
  const [loadingPredictions, setLoadingPredictions] = useState(false);
  const [predictions, setPredictions] = useState({});
  const [activeModel, setActiveModel] = useState(null);



  // Update currentTab when initialTab prop changes
  useEffect(() => {
    if (initialTab && initialTab !== currentTab) {
      setCurrentTab(initialTab);
    }
  }, [initialTab]);

  // Load files for current tab with progressive loading
  useEffect(() => {
    // Cancel any previous loading
    if (abortController) {
      abortController.abort();
    }

    const controller = new AbortController();
    setAbortController(controller);

    const loadFiles = async () => {
      setLoadingFiles(true);
      setFiles([]);
      setTotalFiles(0);
      setHasMoreFiles(false);
      setFilesLoaded(0);

      try {
        // Load FIRST file only (limit=1) to start filtering immediately
        const response = await fetch(`/api/filter/files/${performer.id}?type=${currentTab}&sortBy=${sortBy}&sortOrder=${sortOrder}&hideKept=${hideKeptFiles}&limit=1&offset=0`, {
          signal: controller.signal
        });
        if (response.ok) {
          const data = await response.json();

          // Check if we were aborted
          if (controller.signal.aborted) return;

          // Check if response is paginated or legacy format
          if (data.files && data.total !== undefined) {
            // New paginated format
            let filesList = data.files;

            // If sorting by funscript count, sort client-side if not supported by backend
            if (sortBy === 'funscript_count') {
              filesList = [...filesList].sort((a, b) => {
                return sortOrder === 'asc'
                  ? (a.funscript_count || 0) - (b.funscript_count || 0)
                  : (b.funscript_count || 0) - (a.funscript_count || 0);
              });
            }

            setFiles(filesList);
            setTotalFiles(data.total);
            setHasMoreFiles(data.hasMore);
            setCurrentIndex(0);
            setFilesLoaded(1);

            // Continue loading more files in background ONE AT A TIME
            if (data.hasMore && !controller.signal.aborted) {
              loadMoreFilesInBackground(1, controller);
            }
          } else {
            // Legacy format - all files returned at once
            let filesList = data;
            if (sortBy === 'funscript_count') {
              filesList = [...filesList].sort((a, b) => {
                return sortOrder === 'asc'
                  ? (a.funscript_count || 0) - (b.funscript_count || 0)
                  : (b.funscript_count || 0) - (a.funscript_count || 0);
              });
            }
            setFiles(filesList);
            setTotalFiles(filesList.length);
            setHasMoreFiles(false);
            setCurrentIndex(0);
            setFilesLoaded(filesList.length);
          }
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Error loading files:', err);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoadingFiles(false);
        }
      }
    };

    if (performer?.id) {
      loadFiles();
    }

    // Cleanup: abort on unmount or when dependencies change
    return () => {
      controller.abort();
    };
  }, [performer.id, currentTab, sortBy, sortOrder, hideKeptFiles]);



  // Load more files in background with smart batching
  const loadMoreFilesInBackground = async (currentOffset, controller) => {
    console.log(`[${currentTab}] loadMoreFilesInBackground called - offset: ${currentOffset}, filesLoaded: ${filesLoaded}`);

    if (controller.signal.aborted) {
      console.log(`[${currentTab}] Skipping - aborted: ${controller.signal.aborted}`);
      return;
    }

    setLoadingMoreFiles(true);
    try {
      // Determine batch size based on progress
      // First 5 files: load one at a time
      // After that: batch load (40 for pics, keep 1 for videos/funscripts)
      let batchSize = 1;
      if (filesLoaded >= 5) {
        if (currentTab === 'pics') {
          batchSize = 40;
        }
        // For videos and funscripts, keep loading one at a time (batchSize stays 1)
      }

      console.log(`[${currentTab}] Fetching with batchSize: ${batchSize}, offset: ${currentOffset}`);

      const response = await fetch(`/api/filter/files/${performer.id}?type=${currentTab}&sortBy=${sortBy}&sortOrder=${sortOrder}&hideKept=${hideKeptFiles}&limit=${batchSize}&offset=${currentOffset}`, {
        signal: controller.signal
      });
      if (response.ok) {
        const data = await response.json();

        console.log(`[${currentTab}] Received ${data.files?.length || 0} files, hasMore: ${data.hasMore}`);

        // Check if we were aborted
        if (controller.signal.aborted) return;

        if (data.files && data.files.length > 0) {
          let newFiles = data.files;

          // If sorting by funscript count, sort client-side
          if (sortBy === 'funscript_count') {
            newFiles = [...newFiles].sort((a, b) => {
              return sortOrder === 'asc'
                ? (a.funscript_count || 0) - (b.funscript_count || 0)
                : (b.funscript_count || 0) - (a.funscript_count || 0);
            });
          }

          setFiles(prevFiles => [...prevFiles, ...newFiles]);
          setFilesLoaded(prev => prev + newFiles.length);
          setHasMoreFiles(data.hasMore);

          // Continue loading if there are more files and not aborted
          if (data.hasMore && !controller.signal.aborted) {
            console.log(`[${currentTab}] Scheduling next batch in 10ms`);
            setTimeout(() => loadMoreFilesInBackground(currentOffset + batchSize, controller), 10);
          } else {
            console.log(`[${currentTab}] No more files to load`);
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error(`[${currentTab}] Error loading more files:`, err);
      }
    } finally {
      console.log(`[${currentTab}] Finished loading batch`);
      setLoadingMoreFiles(false);
    }
  };

  // Save sort states to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('performerFilterSortBy', sortBy);
  }, [sortBy]);

  useEffect(() => {
    localStorage.setItem('performerFilterSortOrder', sortOrder);
  }, [sortOrder]);

  // Load filter progress
  useEffect(() => {
    const loadProgress = async () => {
      try {
        const response = await fetch(`/api/filter/stats/${performer.id}`);
        if (response.ok) {
          const stats = await response.json();

          // Calculate progress based on current tab
          let tabProgress = 0;
          if (currentTab === 'pics') {
            tabProgress = stats.picsCompletion || 0;
          } else if (currentTab === 'vids') {
            tabProgress = stats.vidsCompletion || 0;
          } else if (currentTab === 'funscript_vids') {
            tabProgress = stats.funscriptCompletion || 0;
          }

          setProgress(tabProgress);

          console.log('Progress update:', {
            currentTab,
            tabProgress,
            fullStats: stats
          });
        }
      } catch (err) {
        console.error('Error loading progress:', err);
      }
    };

    if (performer?.id) {
      loadProgress();
    }
  }, [performer.id, files, currentTab]);

  const handleFilterAction = useCallback(async (action) => {
    if (!files[currentIndex]) return;

    console.log('Filter action:', action, 'for file:', files[currentIndex].path);

    // Check if media is currently in fullscreen or modal
    let isCurrentlyFullscreen = document.fullscreenElement !== null;

    // Check custom funscript-player fullscreen
    if (!isCurrentlyFullscreen && mediaContainerRef.current) {
      const funscriptPlayer = mediaContainerRef.current.querySelector('funscript-player');
      if (funscriptPlayer && funscriptPlayer.classList.contains('fullscreen')) {
        isCurrentlyFullscreen = true;
      }
    }

    // More robust modal detection for pics tab
    let isCurrentlyModal = false;
    if (currentTab === 'pics') {
      // Check for common modal indicators
      const modalElements = document.querySelectorAll('.modal, .modal-open, [data-modal="true"], .MuiDialog-root, .modal-backdrop, .overlay, .lightbox');
      isCurrentlyModal = modalElements.length > 0;

      // Alternative: check if any element has modal-related styles
      if (!isCurrentlyModal) {
        const bodyClasses = document.body.className;
        isCurrentlyModal = bodyClasses.includes('modal-open') || bodyClasses.includes('no-scroll') || bodyClasses.includes('overlay-open');
      }

      // Another approach: check for elements with high z-index that might be modals
      if (!isCurrentlyModal) {
        const highZElements = Array.from(document.querySelectorAll('*')).filter(el => {
          const zIndex = window.getComputedStyle(el).zIndex;
          return zIndex !== 'auto' && parseInt(zIndex) > 1000;
        });
        isCurrentlyModal = highZElements.length > 0;
      }
    }

    let fullscreenElement = null;
    if (isCurrentlyFullscreen) {
      fullscreenElement = document.fullscreenElement;
      console.log('Media is currently in fullscreen, will restore after action');
    }

    if (isCurrentlyModal) {
      console.log('Image is currently in modal, will restore after action');
    }

    try {
      let response;

      if (currentTab === 'funscript') {
        // For funscript filtering, we're working with videos that have funscript files
        response = await fetch('/api/filter/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            performerId: performer.id,
            filePath: files[currentIndex].path,
            action
          })
        });
      } else {
        // For regular filtering
        response = await fetch('/api/filter/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            performerId: performer.id,
            filePath: files[currentIndex].path,
            action
          })
        });
      }

      console.log('Response status:', response.status);

      if (response.ok) {
        const result = await response.json();
        console.log('Filter action result:', result);

        // Store the fullscreen and modal states before updating
        const wasFullscreen = isCurrentlyFullscreen;
        const wasModal = isCurrentlyModal;

        // Optimized: Update local state immediately instead of reloading all files
        const updatedFiles = [...files];

        if (hideKeptFiles && (action === 'keep' || action === 'move_to_funscript')) {
          // Remove the file from the array since it will be hidden
          updatedFiles.splice(currentIndex, 1);
          setFiles(updatedFiles);

          // Stay at the same index (which now shows the next file)
          if (currentIndex >= updatedFiles.length) {
            // If we're at the end, go to the last available file or start over
            setCurrentIndex(updatedFiles.length > 0 ? updatedFiles.length - 1 : 0);
          }
        } else if (action === 'delete') {
          // Remove the file from the array since it's deleted
          updatedFiles.splice(currentIndex, 1);
          setFiles(updatedFiles);

          // Stay at the same index (which now shows the next file)
          if (currentIndex >= updatedFiles.length) {
            // If we're at the end, go to the last available file or start over
            setCurrentIndex(updatedFiles.length > 0 ? updatedFiles.length - 1 : 0);
          }
        } else {
          // Update the file's filtered status in place
          if (updatedFiles[currentIndex]) {
            updatedFiles[currentIndex].filtered = action;
          }
          setFiles(updatedFiles);

          // Normal navigation - move to next file if possible
          if (currentIndex < updatedFiles.length - 1) {
            setCurrentIndex(currentIndex + 1);
          } else if (updatedFiles.length > 0) {
            setCurrentIndex(0);
          }
        }

        // Force re-render with fullscreen/modal restoration
        if (wasFullscreen && (currentTab === 'vids' || currentTab === 'funscript_vids')) {
          console.log('Setting shouldRestoreFullscreen to true');
          setShouldRestoreFullscreen(true);
        }

        if (wasModal && currentTab === 'pics') {
          console.log('Setting shouldRestoreModal to true');
          setShouldRestoreModal(true);
        }

        // Update progress statistics less frequently (async, non-blocking)
        setTimeout(async () => {
          try {
            const progressResponse = await fetch(`/api/filter/stats/${performer.id}`);
            if (progressResponse.ok) {
              const stats = await progressResponse.json();

              // Calculate progress based on current tab
              let tabProgress = 0;
              if (currentTab === 'pics') {
                tabProgress = stats.picsCompletion || 0;
              } else if (currentTab === 'vids') {
                tabProgress = stats.vidsCompletion || 0;
              } else if (currentTab === 'funscript_vids') {
                tabProgress = stats.funscriptCompletion || 0;
              }

              setProgress(tabProgress);
            }
          } catch (err) {
            console.error('Error updating progress:', err);
          }
        }, 100); // Small delay to not block the UI
      } else {
        const errorText = await response.text();
        console.error('Filter action failed:', response.status, errorText);
      }
    } catch (err) {
      console.error('Error performing filter action:', err);
    }
  }, [files, currentIndex, performer.id, currentTab, sortBy, sortOrder, hideKeptFiles]);

  const handleUndo = useCallback(async () => {
    try {
      const response = await fetch('/api/filter/undo', {
        method: 'POST'
      });

      if (response.ok) {
        // Reload files after undo (undo is less frequent, so full reload is acceptable)
        const updatedResponse = await fetch(`/api/filter/files/${performer.id}?type=${currentTab}&sortBy=${sortBy}&sortOrder=${sortOrder}&hideKept=${hideKeptFiles}`);
        if (updatedResponse.ok) {
          const updatedFiles = await updatedResponse.json();
          setFiles(updatedFiles);
          if (currentIndex > 0) {
            setCurrentIndex(currentIndex - 1);
          }
        }

        // Update progress statistics (async, non-blocking)
        setTimeout(async () => {
          try {
            const progressResponse = await fetch(`/api/filter/stats/${performer.id}`);
            if (progressResponse.ok) {
              const stats = await progressResponse.json();

              // Calculate progress based on current tab
              let tabProgress = 0;
              if (currentTab === 'pics') {
                tabProgress = stats.picsCompletion || 0;
              } else if (currentTab === 'vids') {
                tabProgress = stats.vidsCompletion || 0;
              } else if (currentTab === 'funscript_vids') {
                tabProgress = stats.funscriptCompletion || 0;
              }

              setProgress(tabProgress);
            }
          } catch (err) {
            console.error('Error updating progress after undo:', err);
          }
        }, 100);
      }
    } catch (err) {
      console.error('Error undoing action:', err);
    }
  }, [performer.id, currentTab, sortBy, sortOrder, hideKeptFiles, currentIndex]);

  const handleFunscriptAction = useCallback(async (action, funscriptFile) => {
    if (!files[currentIndex] || currentTab !== 'funscript_vids') return;

    try {
      const response = await fetch('/api/filter/funscript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          performerId: performer.id,
          videoFolder: files[currentIndex].folderName,
          action,
          funscriptFile
        })
      });

      if (response.ok) {
        // Reload files to get updated funscript list
        const updatedResponse = await fetch(`/api/filter/files/${performer.id}?type=${currentTab}&sortBy=${sortBy}&sortOrder=${sortOrder}&hideKept=${hideKeptFiles}`);
        if (updatedResponse.ok) {
          const updatedFiles = await updatedResponse.json();
          setFiles(updatedFiles);
        }
      }
    } catch (err) {
      console.error('Error performing funscript action:', err);
    }
  }, [performer.id, files, currentIndex, currentTab, sortBy, sortOrder, hideKeptFiles]);

  const handleFunscriptRename = useCallback(async (funscriptFile) => {
    if (!files[currentIndex] || currentTab !== 'funscript_vids') return;

    const newName = prompt('Enter new name for funscript file:', funscriptFile);
    if (newName && newName !== funscriptFile) {
      try {
        const response = await fetch('/api/filter/funscript', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            performerId: performer.id,
            videoFolder: files[currentIndex].folderName,
            action: 'rename',
            funscriptFile,
            options: { newName }
          })
        });

        if (response.ok) {
          // Reload files to get updated funscript list
          const updatedResponse = await fetch(`/api/filter/files/${performer.id}?type=${currentTab}&sortBy=${sortBy}&sortOrder=${sortOrder}&hideKept=${hideKeptFiles}`);
          if (updatedResponse.ok) {
            const updatedFiles = await updatedResponse.json();
            setFiles(updatedFiles);
          }
        }
      } catch (err) {
        console.error('Error renaming funscript file:', err);
      }
    }
  }, [performer.id, files, currentIndex, currentTab, sortBy, sortOrder, hideKeptFiles]);

  const handleFunscriptUpload = useCallback(async (funscriptFile) => {
    if (!files[currentIndex] || currentTab !== 'funscript_vids') return;

    if (!handyIntegration || !handyConnected) {
      alert('Handy not connected. Please connect your Handy device first.');
      return;
    }

    try {
      // Get the full path to the funscript file
      const folderPath = files[currentIndex].path.substring(0, files[currentIndex].path.lastIndexOf('\\'));
      const funscriptPath = `${folderPath}\\${funscriptFile}`;

      console.log('Loading funscript from:', funscriptPath);

      // Load the funscript content
      const response = await fetch(`/api/files/raw?path=${encodeURIComponent(funscriptPath)}`);

      if (!response.ok) {
        throw new Error(`Failed to load funscript: ${response.status}`);
      }

      const funscriptContent = await response.json();

      const scriptData = {
        content: funscriptContent,
        fileName: funscriptFile
      };

      // Find the video element if it exists
      const videoElement = document.querySelector('video');

      // Create a temporary button for progress feedback
      const tempButton = {
        textContent: 'Uploading...',
        setAttribute: () => { },
        removeAttribute: () => { },
        disabled: false
      };

      // Upload and set the script
      await handyIntegration.uploadAndSetScript(videoElement, scriptData, tempButton);

      alert(`Funscript uploaded to Handy: ${funscriptFile}`);

    } catch (err) {
      console.error('Error uploading funscript to Handy:', err);
      alert('Error uploading funscript to Handy: ' + err.message);
    }
  }, [files, currentIndex, currentTab, handyIntegration, handyConnected]);

  const currentFile = files[currentIndex];
  const [shouldRestoreFullscreen, setShouldRestoreFullscreen] = useState(false);
  const [shouldRestoreModal, setShouldRestoreModal] = useState(false);
  const mediaContainerRef = React.useRef(null);

  // Fullscreen restoration - the FunscriptPlayer component handles this natively
  // via the autofullscreen attribute, so we just clear the flag after it's been consumed
  useEffect(() => {
    if (shouldRestoreFullscreen && (currentTab === 'vids' || currentTab === 'funscript_vids')) {
      // The flag is consumed by passing autofullscreen="true" to the funscript-player.
      // Clear it after a short delay so the attribute is applied first.
      const timeout = setTimeout(() => {
        setShouldRestoreFullscreen(false);
      }, 500);
      return () => clearTimeout(timeout);
    }
  }, [shouldRestoreFullscreen, currentTab, currentFile]);

  // Modal restoration for pictures
  useEffect(() => {
    if (shouldRestoreModal && currentTab === 'pics' && mediaContainerRef.current) {
      console.log('Starting modal restoration for image...');

      // Wait a bit for the new funscript-player to render
      const timeout = setTimeout(() => {
        const container = mediaContainerRef.current;
        if (container) {
          const funscriptPlayer = container.querySelector('funscript-player');

          console.log('Looking for funscript-player element...', { funscriptPlayer });

          if (funscriptPlayer) {
            // Try to trigger the modal by simulating a click on the image
            const image = funscriptPlayer.querySelector('img') ||
              (funscriptPlayer.shadowRoot ? funscriptPlayer.shadowRoot.querySelector('img') : null);

            console.log('Looking for image element...', { image });

            if (image) {
              console.log('Found image, clicking to open modal');
              image.click();
              setShouldRestoreModal(false);
            } else {
              console.log('Image element not ready, trying again...');
              // Try one more time with a longer delay
              setTimeout(() => {
                const image2 = funscriptPlayer.querySelector('img') ||
                  (funscriptPlayer.shadowRoot ? funscriptPlayer.shadowRoot.querySelector('img') : null);
                if (image2) {
                  console.log('Found image on retry, clicking to open modal');
                  image2.click();
                }
                setShouldRestoreModal(false);
              }, 500);
            }
          } else {
            console.log('Funscript player not found, giving up on modal restore');
            setShouldRestoreModal(false);
          }
        }
      }, 300); // Slightly longer delay for modal

      return () => clearTimeout(timeout);
    }
  }, [shouldRestoreModal, currentTab, currentFile]);

  // Helper function to navigate while preserving fullscreen/modal state
  const navigateWithFullscreen = useCallback((newIndex) => {
    let isCurrentlyFullscreen = document.fullscreenElement !== null;

    // Check custom funscript-player fullscreen
    if (!isCurrentlyFullscreen && mediaContainerRef.current) {
      const funscriptPlayer = mediaContainerRef.current.querySelector('funscript-player');
      if (funscriptPlayer && funscriptPlayer.classList.contains('fullscreen')) {
        isCurrentlyFullscreen = true;
      }
    }

    // More robust modal detection for pics tab
    let isCurrentlyModal = false;
    if (currentTab === 'pics') {
      // Check for common modal indicators
      const modalElements = document.querySelectorAll('.modal, .modal-open, [data-modal="true"], .MuiDialog-root, .modal-backdrop, .overlay, .lightbox');
      isCurrentlyModal = modalElements.length > 0;

      // Alternative: check if any element has modal-related styles
      if (!isCurrentlyModal) {
        const bodyClasses = document.body.className;
        isCurrentlyModal = bodyClasses.includes('modal-open') || bodyClasses.includes('no-scroll') || bodyClasses.includes('overlay-open');
      }

      // Another approach: check for elements with high z-index that might be modals
      if (!isCurrentlyModal) {
        const highZElements = Array.from(document.querySelectorAll('*')).filter(el => {
          const zIndex = window.getComputedStyle(el).zIndex;
          return zIndex !== 'auto' && parseInt(zIndex) > 1000;
        });
        isCurrentlyModal = highZElements.length > 0;
      }
    }

    console.log('Navigation - currently in fullscreen:', isCurrentlyFullscreen, 'currently in modal:', isCurrentlyModal, 'tab:', currentTab);

    setCurrentIndex(newIndex);

    // If video was in fullscreen, set flag to restore fullscreen when new video loads
    if (isCurrentlyFullscreen && (currentTab === 'vids' || currentTab === 'funscript_vids')) {
      console.log('Navigation: Setting shouldRestoreFullscreen to true');
      setShouldRestoreFullscreen(true);
    }

    // If image was in modal, set flag to restore modal when new image loads
    if (isCurrentlyModal && currentTab === 'pics') {
      console.log('Navigation: Setting shouldRestoreModal to true');
      setShouldRestoreModal(true);
    }
  }, [currentTab]);

  // Load shortcuts on component mount and check for updates
  useEffect(() => {
    const loadShortcutsData = () => {
      loadShortcuts().then(setShortcuts);
    };

    // Load shortcuts initially
    loadShortcutsData();

    // Check for shortcut updates every 2 seconds when component is active
    const interval = setInterval(() => {
      loadShortcutsData();
    }, 2000);

    // Also reload when page becomes visible again
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        loadShortcutsData();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e) => {
      // Ignore if typing in an input field
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      let actionTaken = false;
      if (e.key === shortcuts.keep) { handleFilterAction('keep'); actionTaken = true; }
      else if (e.key === shortcuts.delete) { handleFilterAction('delete'); actionTaken = true; }
      else if (e.key === shortcuts.move_to_funscript && currentTab === 'vids') { handleFilterAction('move_to_funscript'); actionTaken = true; }
      else if (e.key === shortcuts.undo) { handleUndo(); actionTaken = true; }
      else if (e.key === shortcuts.prev && currentIndex > 0) { navigateWithFullscreen(currentIndex - 1); actionTaken = true; }
      else if (e.key === shortcuts.next && currentIndex < files.length - 1) { navigateWithFullscreen(currentIndex + 1); actionTaken = true; }

      if (actionTaken) {
        e.preventDefault();
        e.stopPropagation();

        // If a button (like the fullscreen button) happens to be focused, blurring it
        // ensures that subsequent spaces/enters don't re-trigger that button unintentionally.
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      }
    };

    // Only add listener if shortcuts are loaded
    if (Object.keys(shortcuts).length > 0) {
      // Use capture phase (true) to intercept shortcuts before native video elements consume them
      window.addEventListener('keydown', handleKeyPress, true);
      return () => window.removeEventListener('keydown', handleKeyPress, true);
    }
  }, [currentIndex, files.length, currentTab, handleFilterAction, handleUndo, shortcuts, navigateWithFullscreen]);

  // Cleanup polling interval on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  // Cleanup trash when going back
  const handleBack = async () => {
    if (isGoingBack) return; // Prevent double clicks

    // Abort any ongoing file loading
    if (abortController) {
      console.log('Aborting file loading...');
      abortController.abort();
    }

    try {
      // Start async trash cleanup
      const cleanupResponse = await fetch(`/api/performers/${performer.id}/cleanup-trash-async`, {
        method: 'POST'
      });

      if (cleanupResponse.ok) {
        const result = await cleanupResponse.json();
        const jobId = result.jobId;

        // Add task to queue
        const newTask = {
          id: jobId,
          title: 'Cleaning up trash',
          description: `${performer.name}`,
          status: 'processing',
          progress: 0,
        };

        setBackgroundTasks(prev => [...prev, newTask]);

        // Start polling for progress
        const pollInterval = setInterval(async () => {
          try {
            const statusResp = await fetch(`/api/performers/background-task/${jobId}`);
            if (statusResp.ok) {
              const statusData = await statusResp.json();
              const task = statusData.task;

              setBackgroundTasks(prev =>
                prev.map(t => t.id === jobId ? {
                  ...t,
                  status: task.status,
                  progress: task.progress || 0,
                  error: task.error,
                  result: task.result ? `Deleted ${task.result.deletedCount} files` : null,
                } : t)
              );

              if (task.status === 'completed' || task.status === 'error') {
                clearInterval(pollInterval);
              }
            }
          } catch (err) {
            console.error('Error polling task status:', err);
          }
        }, 500);

        pollingIntervalRef.current = pollInterval;
      }
    } catch (error) {
      console.error('Error starting async cleanup:', error);
    }

    // Navigate back immediately without blocking
    onBack();
  };

  // Handle next performer with cleanup (no completion)
  const handleNext = async () => {
    console.log('handleNext called - starting next performer flow');
    console.log('Current performer ID:', performer.id, 'Name:', performer.name);

    try {
      // First cleanup trash
      const response = await fetch(`/api/performers/${performer.id}/cleanup-trash`, {
        method: 'POST'
      });

      if (response.ok) {
        const result = await response.json();
        console.log(`Cleanup: ${result.deletedCount} files permanently deleted`);
      }

      // Use the onNext callback to handle next performer in sorted order
      onNext(performer.id);

    } catch (error) {
      console.error('Error in handleNext:', error);
      onBack(); // Fallback to going back to list
    }
  };

  return (
    <Container maxWidth="xl" sx={{ py: 3, position: 'relative' }}>
      {/* Background Task Queue */}
      {backgroundTasks.length > 0 && (
        <BackgroundTaskQueue
          tasks={backgroundTasks}
          onClose={() => {
            // Clear completed/error tasks
            setBackgroundTasks(prev => prev.filter(t => t.status === 'processing' || t.status === 'queued'));
          }}
        />
      )}

      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <IconButton
          onClick={handleBack}
          sx={{ mr: 2 }}
        >
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h4" sx={{ flexGrow: 1 }}>
          Filtering: {performer.name}
        </Typography>
        <Typography variant="body1" sx={{ mr: 2 }}>
          {currentTab === 'pics' ? 'Pics' : currentTab === 'vids' ? 'Videos' : 'Funscripts'} Progress: {progress}%
        </Typography>
        <Button
          variant="contained"
          onClick={handleNext}
          sx={{
            backgroundColor: '#4caf50',
            '&:hover': { backgroundColor: '#45a049' },
            mr: 1
          }}
        >
          Next
        </Button>
      </Box>

      {/* Progress Bar */}
      <LinearProgress variant="determinate" value={progress} sx={{ mb: 3, height: 8, borderRadius: 4 }} />

      {/* Tab Selection */}
      <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
        <Button
          variant={currentTab === 'pics' ? 'contained' : 'outlined'}
          startIcon={<ImageIcon />}
          onClick={() => setCurrentTab('pics')}
          disabled={loadingFiles}
          sx={{ backgroundColor: currentTab === 'pics' ? '#2e7d32' : 'transparent' }}
        >
          Pictures
        </Button>
        <Button
          variant={currentTab === 'vids' ? 'contained' : 'outlined'}
          startIcon={<MovieIcon />}
          onClick={() => setCurrentTab('vids')}
          disabled={loadingFiles}
          sx={{ backgroundColor: currentTab === 'vids' ? '#1565c0' : 'transparent' }}
        >
          Videos
        </Button>
        <Button
          variant={currentTab === 'funscript_vids' ? 'contained' : 'outlined'}
          startIcon={<GameIcon />}
          onClick={() => setCurrentTab('funscript_vids')}
          disabled={loadingFiles}
          sx={{ backgroundColor: currentTab === 'funscript_vids' ? '#c62828' : 'transparent' }}
        >
          Funscript Videos
        </Button>
      </Box>

      {/* Controls */}
      <Box sx={{ display: 'flex', gap: 2, mb: 3, alignItems: 'center' }}>
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel>Sort By</InputLabel>
          <Select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <MenuItem value="name">Name</MenuItem>
            <MenuItem value="size">Size (Biggest First)</MenuItem>
            <MenuItem value="date">Date Modified</MenuItem>
            {currentTab === 'funscript_vids' && (
              <MenuItem value="funscript_count">Funscript Count</MenuItem>
            )}
          </Select>
        </FormControl>

        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel>Order</InputLabel>
          <Select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
            <MenuItem value="asc">Ascending</MenuItem>
            <MenuItem value="desc">Descending</MenuItem>
          </Select>
        </FormControl>

        <Button
          variant="outlined"
          onClick={handleUndo}
          sx={{ ml: 1 }}
        >
          Undo Last (U)
        </Button>

        <FormControlLabel
          control={
            <Switch
              checked={hideKeptFiles}
              onChange={(e) => setHideKeptFiles(e.target.checked)}
              size="small"
              disabled={loadingFiles}
            />
          }
          label="Hide Kept Files"
          sx={{ ml: 2 }}
        />

        <FormControlLabel
          control={
            <Switch
              checked={mlEnabled}
              onChange={(e) => setMlEnabled(e.target.checked)}
              size="small"
              disabled={loadingFiles || loadingPredictions}
            />
          }
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              🤖 ML Predictions
              {loadingPredictions && <Typography variant="caption" color="text.secondary">(loading...)</Typography>}
              {mlEnabled && !activeModel && !loadingPredictions && (
                <Typography variant="caption" color="error">(no model)</Typography>
              )}
            </Box>
          }
          sx={{ ml: 2 }}
        />

        <Typography variant="body2" sx={{ ml: 'auto' }}>
          {currentIndex + 1} of {files.length}
          {totalFiles > files.length && ` (${totalFiles} total)`}
          {loadingMoreFiles && ' - Loading...'}
        </Typography>
      </Box>

      {/* Main Content: wrap in fragment to avoid adjacent JSX error */}
      <>
        {currentFile && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* Loading indicator for initial load */}
            {loadingFiles && files.length === 0 && (
              <Box sx={{ textAlign: 'center', py: 2 }}>
                <Typography variant="body1" color="text.secondary" gutterBottom>
                  Loading first files...
                </Typography>
                <LinearProgress sx={{ maxWidth: 400, mx: 'auto' }} />
              </Box>
            )}

            {/* File Info */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="h6">{currentFile.name}</Typography>
              <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                {/* ML Prediction Indicator */}
                {mlEnabled && currentFile.hash_id && predictions[currentFile.hash_id] && (
                  <Box sx={{
                    padding: '4px 12px',
                    borderRadius: '16px',
                    fontSize: '0.75rem',
                    fontWeight: 'bold',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    backgroundColor: (() => {
                      const pred = predictions[currentFile.hash_id];
                      if (pred.confidence > 0.8) {
                        return pred.prediction === 1 ? '#ffebee' : '#e8f5e9';
                      }
                      return '#fff3e0';
                    })(),
                    color: (() => {
                      const pred = predictions[currentFile.hash_id];
                      if (pred.confidence > 0.8) {
                        return pred.prediction === 1 ? '#c62828' : '#2e7d32';
                      }
                      return '#e65100';
                    })(),
                    border: '2px solid',
                    borderColor: (() => {
                      const pred = predictions[currentFile.hash_id];
                      if (pred.confidence > 0.8) {
                        return pred.prediction === 1 ? '#ef5350' : '#66bb6a';
                      }
                      return '#ffb74d';
                    })()
                  }}>
                    <span style={{ fontSize: '16px' }}>
                      {(() => {
                        const pred = predictions[currentFile.hash_id];
                        if (pred.confidence > 0.8) {
                          return pred.prediction === 1 ? '🔴' : '🟢';
                        }
                        return '🟡';
                      })()}
                    </span>
                    ML: {predictions[currentFile.hash_id].prediction === 1 ? 'DELETE' : 'KEEP'}
                    {' '}
                    ({(predictions[currentFile.hash_id].confidence * 100).toFixed(0)}%)
                  </Box>
                )}

                {/* Filter Status */}
                {currentFile.filtered && (
                  <Box sx={{
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '0.75rem',
                    fontWeight: 'bold',
                    backgroundColor: currentFile.filtered === 'keep' ? '#4caf50' :
                      currentFile.filtered === 'delete' ? '#f44336' : '#ff9800',
                    color: 'white'
                  }}>
                    {currentFile.filtered === 'keep' ? 'KEPT' :
                      currentFile.filtered === 'delete' ? 'DELETED' :
                        currentFile.filtered.toUpperCase()}
                  </Box>
                )}
                <Typography variant="body2">Size: {Math.round(currentFile.size / 1024 / 1024 * 100) / 100} MB</Typography>
              </Box>
            </Box>

            {/* Media Display - reduced height, maintain aspect ratio */}
            <Box
              ref={mediaContainerRef}
              sx={{
                height: '60vh',
                width: '100%',
                backgroundColor: 'black',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 0,
                overflow: 'hidden',
              }}
            >
              {currentTab === 'pics' && (
                <funscript-player
                  key="pic-player"
                  src={`/api/files/raw?path=${encodeURIComponent(currentFile.path)}`}
                  type="image"
                  performer-id={performer.id}
                  performer-name={performer.name}
                  handy-connected={handyConnected ? 'true' : 'false'}
                  mode="modal"
                  tagassign="true"
                  className="funscript-player-embed"
                ></funscript-player>
              )}
              {currentTab === 'vids' && (
                <funscript-player
                  key="vid-player"
                  src={`/api/files/raw?path=${encodeURIComponent(currentFile.path)}`}
                  type="video"
                  performer-id={performer.id}
                  performer-name={performer.name}
                  handy-connected={handyConnected ? 'true' : 'false'}
                  mode="standalone"
                  tagassign="true"
                  scenemanager="true"
                  autoplay="true"
                  autofullscreen={shouldRestoreFullscreen ? 'true' : undefined}
                  className="funscript-player-embed"
                ></funscript-player>
              )}
              {currentTab === 'funscript_vids' && (
                <funscript-player
                  key="fvid-player"
                  src={`/api/files/raw?path=${encodeURIComponent(currentFile.path)}`}
                  type="video"
                  performer-id={performer.id}
                  performer-name={performer.name}
                  handy-connected={handyConnected ? 'true' : 'false'}
                  funscriptmode="true"
                  filtermode="true"
                  mode="standalone"
                  scenemanager="true"
                  autoplay="true"
                  autofullscreen={shouldRestoreFullscreen ? 'true' : undefined}
                  funscripts={JSON.stringify(Array.isArray(currentFile.funscripts) ? currentFile.funscripts : [])}
                  data-debug-funscripts={JSON.stringify(Array.isArray(currentFile.funscripts) ? currentFile.funscripts : [])}
                  data-debug-performer={performer.name}
                  className="funscript-player-embed"
                ></funscript-player>
              )}
            </Box>

            {/* Funscript Files Management - only show for funscript_vids tab */}
            {currentTab === 'funscript_vids' && currentFile.funscripts && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="h6" gutterBottom>
                  Funscript Files ({currentFile.funscripts.length})
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {currentFile.funscripts.map((funscript, index) => (
                    <Box key={index} sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      p: 2,
                      border: '1px solid #ddd',
                      borderRadius: 1,
                      bgcolor: 'background.paper',
                      minHeight: 48
                    }}>
                      <Typography
                        variant="body1"
                        sx={{
                          flex: 1,
                          mr: 2,
                          fontWeight: 500,
                          color: 'text.primary',
                          wordBreak: 'break-all'
                        }}
                      >
                        {funscript}
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
                        <Button
                          size="small"
                          variant="outlined"
                          color="primary"
                          onClick={() => handleFunscriptAction('keep', funscript)}
                        >
                          Keep
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          color="error"
                          onClick={() => handleFunscriptAction('delete', funscript)}
                        >
                          Delete
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => handleFunscriptRename(funscript)}
                        >
                          Rename
                        </Button>
                        <Button
                          size="small"
                          variant="contained"
                          color="secondary"
                          startIcon={<UploadIcon />}
                          onClick={() => handleFunscriptUpload(funscript)}
                          sx={{
                            backgroundColor: '#9c27b0',
                            '&:hover': { backgroundColor: '#7b1fa2' }
                          }}
                        >
                          Upload to Handy
                        </Button>
                      </Box>
                    </Box>
                  ))}
                </Box>
              </Box>
            )}

            {/* Navigation and Action Buttons - Always below media */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {/* Navigation */}
              <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center' }}>
                <Button
                  variant="outlined"
                  startIcon={<PrevIcon />}
                  onClick={() => navigateWithFullscreen(Math.max(0, currentIndex - 1))}
                  disabled={currentIndex === 0}
                >
                  Previous
                </Button>
                <Button
                  variant="outlined"
                  endIcon={<NextIcon />}
                  onClick={() => navigateWithFullscreen(Math.min(files.length - 1, currentIndex + 1))}
                  disabled={currentIndex === files.length - 1}
                >
                  Next
                </Button>
              </Box>

              {/* Action Buttons */}
              {currentTab === 'funscript' ? (
                <>
                  <Button
                    variant="contained"
                    color="success"
                    onClick={() => handleFilterAction('keep')}
                    sx={{ px: 4, py: 2, minWidth: 120 }}
                  >
                    Keep Video ({shortcuts.keep?.toUpperCase() || 'K'})
                  </Button>
                  <Button
                    variant="contained"
                    color="error"
                    onClick={() => handleFilterAction('delete')}
                    sx={{ px: 4, py: 2, minWidth: 120 }}
                  >
                    Delete Video ({shortcuts.delete?.toUpperCase() || 'D'})
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={handleUndo}
                    sx={{ px: 4, py: 2, minWidth: 120 }}
                  >
                    Undo Last ({shortcuts.undo?.toUpperCase() || 'U'})
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="contained"
                    color="success"
                    onClick={() => handleFilterAction('keep')}
                    sx={{ px: 4, py: 2, minWidth: 120 }}
                  >
                    Keep ({shortcuts.keep?.toUpperCase() || 'K'})
                  </Button>
                  <Button
                    variant="contained"
                    color="error"
                    onClick={() => handleFilterAction('delete')}
                    sx={{ px: 4, py: 2, minWidth: 120 }}
                  >
                    Delete ({shortcuts.delete?.toUpperCase() || 'D'})
                  </Button>
                  {currentTab === 'vids' && (
                    <Button
                      variant="contained"
                      color="secondary"
                      onClick={() => handleFilterAction('move_to_funscript')}
                      sx={{ px: 4, py: 2, minWidth: 160 }}
                    >
                      Move to Funscript ({shortcuts.move_to_funscript?.toUpperCase() || 'F'})
                    </Button>
                  )}
                  <Button
                    variant="outlined"
                    onClick={handleUndo}
                    sx={{ px: 4, py: 2, minWidth: 120 }}
                  >
                    Undo Last ({shortcuts.undo?.toUpperCase() || 'U'})
                  </Button>
                </>
              )}
            </Box>
          </Box>
        )}
        {files.length === 0 && !loadingFiles && (
          <Box sx={{ textAlign: 'center', py: 8 }}>
            <Typography variant="h6" color="text.secondary">
              No files to filter in {currentTab.replace('_', ' ')}
            </Typography>
          </Box>
        )}
      </>
    </Container>
  );
}

export default PerformerFilterView;
