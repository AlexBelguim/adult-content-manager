import React, { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Chip,
  Tooltip,
  Pagination,
  IconButton,
  Checkbox,
  Modal,
  Backdrop,
  Fade,
  CircularProgress,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningIcon from '@mui/icons-material/Warning';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import ImageIcon from '@mui/icons-material/Image';
import MovieIcon from '@mui/icons-material/Movie';
import BrokenImageIcon from '@mui/icons-material/BrokenImage';
import CloseIcon from '@mui/icons-material/Close';

// Track deleted file states globally
const deletedFileCache = new Set();

// Component for media with error handling
const MediaThumbnail = ({ src, type, alt, size = 100, onDeleted, onClick }) => {
  const [hasError, setHasError] = useState(deletedFileCache.has(src));

  const handleError = () => {
    deletedFileCache.add(src);
    setHasError(true);
    if (onDeleted) onDeleted();
  };

  const handleClick = (e) => {
    e.stopPropagation();
    if (onClick && !hasError) onClick();
  };

  if (hasError) {
    return (
      <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', bgcolor: 'rgba(244, 67, 54, 0.1)' }}>
        <BrokenImageIcon sx={{ color: '#f44336', fontSize: size > 80 ? 28 : 20 }} />
        <Typography variant="caption" sx={{ color: '#f44336', fontSize: '0.5rem', mt: 0.5 }}>Deleted</Typography>
      </Box>
    );
  }

  // Add cache-busting parameter
  const cacheBustedSrc = `${src}&_t=${Date.now()}`;

  if (type === 'video') {
    return (
      <video
        muted
        preload="metadata"
        style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: onClick ? 'pointer' : 'default' }}
        src={cacheBustedSrc}
        onError={handleError}
        onClick={handleClick}
      />
    );
  }

  return (
    <img
      src={cacheBustedSrc}
      alt={alt}
      style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: onClick ? 'pointer' : 'default' }}
      onError={handleError}
      onClick={handleClick}
    />
  );
};

// Compact row for deleted items
const CompactDeletedRow = ({ item, isSelected, onToggle, getSimilarityPercent, isVideoPath }) => {
  const isSourceVideo = isVideoPath(item.source_path);
  const filename = item.source_path.split(/[\\/]/).pop();

  return (
    <Box
      onClick={() => onToggle(item.id)}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        py: 0.75,
        px: 1.5,
        bgcolor: isSelected ? 'rgba(244, 67, 54, 0.1)' : 'rgba(255,255,255,0.02)',
        borderRadius: 1,
        border: isSelected ? '1px solid #f44336' : '1px solid #333',
        cursor: 'pointer',
        transition: 'all 0.15s',
        '&:hover': { bgcolor: 'rgba(244, 67, 54, 0.08)' }
      }}
    >
      <Checkbox
        checked={isSelected}
        size="small"
        sx={{ color: '#555', '&.Mui-checked': { color: '#f44336' }, p: 0 }}
      />
      <BrokenImageIcon sx={{ color: '#f44336', fontSize: 16 }} />
      <Chip
        label={item.exact_match ? 'EXACT' : `${getSimilarityPercent(item.hamming_distance)}%`}
        size="small"
        sx={{
          height: 18,
          fontSize: '0.6rem',
          fontWeight: 'bold',
          bgcolor: item.exact_match ? '#f44336' : '#ed6c02',
          color: '#fff'
        }}
      />
      {isSourceVideo ? <MovieIcon sx={{ fontSize: 14, color: '#ce93d8' }} /> : <ImageIcon sx={{ fontSize: 14, color: '#90caf9' }} />}
      <Tooltip title={item.source_path}>
        <Typography
          variant="body2"
          sx={{
            color: '#888',
            fontSize: '0.75rem',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            textDecoration: 'line-through'
          }}
        >
          {filename}
        </Typography>
      </Tooltip>
      <Typography variant="caption" sx={{ color: '#f44336', fontSize: '0.6rem' }}>DELETED</Typography>
    </Box>
  );
};

// Lightbox Modal for full-size preview
const LightboxModal = ({ open, onClose, src, type }) => {
  return (
    <Modal
      open={open}
      onClose={onClose}
      closeAfterTransition
      BackdropComponent={Backdrop}
      BackdropProps={{ timeout: 300, sx: { bgcolor: 'rgba(0,0,0,0.9)' } }}
    >
      <Fade in={open}>
        <Box sx={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          maxWidth: '90vw',
          maxHeight: '90vh',
          outline: 'none',
        }}>
          <IconButton
            onClick={onClose}
            sx={{
              position: 'absolute',
              top: -40,
              right: 0,
              color: '#fff',
              bgcolor: 'rgba(255,255,255,0.1)',
              '&:hover': { bgcolor: 'rgba(255,255,255,0.2)' }
            }}
          >
            <CloseIcon />
          </IconButton>

          {type === 'video' ? (
            <video
              controls
              autoPlay
              style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 8 }}
              src={src}
            />
          ) : (
            <img
              src={src}
              alt="Preview"
              style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 8, objectFit: 'contain' }}
            />
          )}
        </Box>
      </Fade>
    </Modal>
  );
};

const HashResultsGrid = ({
  paginatedGroups,
  startIndex,
  isVideoPath,
  selectedItems,
  handleToggleItem,
  onSwitch,
  getSimilarityPercent,
  totalPages,
  displayPage,
  handlePageChange,
  onFileDeleted,
  committing,
}) => {
  const [detectedDeleted, setDetectedDeleted] = useState(new Set());
  const [lightbox, setLightbox] = useState({ open: false, src: '', type: 'image' });

  const handleItemDeleted = (itemId, filePath) => {
    setDetectedDeleted(prev => new Set([...prev, itemId]));
    if (onFileDeleted) {
      onFileDeleted(filePath);
    }
  };

  const isItemDeleted = (item) => {
    return item.source_deleted === 1 || detectedDeleted.has(item.id) || deletedFileCache.has(item.source_path);
  };

  const openLightbox = (path, isVideo) => {
    const src = isVideo
      ? `/api/files/raw?path=${encodeURIComponent(path)}`
      : `/api/files/raw?path=${encodeURIComponent(path)}`;
    setLightbox({ open: true, src, type: isVideo ? 'video' : 'image' });
  };

  const closeLightbox = () => {
    setLightbox({ open: false, src: '', type: 'image' });
  };

  // Separate pairs (single matches) from groups (multiple matches)
  const pairs = paginatedGroups.filter(g => g.length === 1);
  const groups = paginatedGroups.filter(g => g.length > 1);

  return (
    <>
      {/* Lightbox Modal */}
      <LightboxModal
        open={lightbox.open}
        onClose={closeLightbox}
        src={lightbox.src}
        type={lightbox.type}
      />

      {/* Pagination Controls - Top */}
      {totalPages > 1 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
          <Pagination
            count={totalPages}
            page={displayPage}
            onChange={handlePageChange}
            color="primary"
            size="large"
            showFirstButton
            showLastButton
            sx={{
              '& .MuiPaginationItem-root': { color: '#aaa' },
              '& .Mui-selected': { bgcolor: 'rgba(255, 142, 83, 0.2) !important', color: '#FF8E53' }
            }}
          />
        </Box>
      )}

      {/* Pairs Section - 3 Column Grid */}
      {pairs.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" sx={{ color: '#888', mb: 2 }}>
            Pairs ({pairs.length})
          </Typography>
          <Box sx={{
            width: '100%',
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, 1fr)', xl: 'repeat(2, 1fr)' },
            gap: 2
          }}>
            {pairs.map((group, groupIndex) => {
              const item = group[0];
              const isTargetVideo = isVideoPath(item.target_path);
              const isSourceVideo = isVideoPath(item.source_path);
              const isSelected = selectedItems.has(item.id);
              const actualIndex = startIndex + paginatedGroups.indexOf(group);
              const targetDeleted = item.target_deleted === 1 || detectedDeleted.has(`target-${item.candidate_id}`);
              const sourceDeleted = isItemDeleted(item);

              return (
                <Paper
                  key={`pair-${actualIndex}`}
                  elevation={0}
                  sx={{
                    p: 1.5,
                    bgcolor: '#252525',
                    border: '1px solid #444',
                    borderRadius: 2,
                    transition: 'border-color 0.2s',
                    '&:hover': { borderColor: '#666' }
                  }}
                >
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'stretch' }}>
                    {/* KEEP Side */}
                    <Box sx={{ width: 'calc(50% - 16px)', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                        <CheckCircleIcon sx={{ color: '#4caf50', fontSize: 12 }} />
                        <Typography variant="caption" sx={{ color: '#4caf50', fontSize: '0.6rem', fontWeight: 'bold' }}>KEEP</Typography>
                      </Box>
                      <Box
                        sx={{
                          p: 1,
                          bgcolor: '#1a1a1a',
                          borderRadius: 1,
                          border: '2px solid #4caf50',
                          display: 'flex',
                          flexDirection: 'column',
                          flex: 1
                        }}
                      >
                        <Box sx={{ width: '100%', paddingTop: '100%', position: 'relative', borderRadius: 1, overflow: 'hidden', bgcolor: '#000', mb: 1 }}>
                          <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
                            {targetDeleted ? (
                              <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', bgcolor: 'rgba(244, 67, 54, 0.1)' }}>
                                <BrokenImageIcon sx={{ color: '#f44336', fontSize: 24 }} />
                                <Typography variant="caption" sx={{ color: '#f44336', fontSize: '0.5rem' }}>Deleted</Typography>
                              </Box>
                            ) : (
                              <MediaThumbnail
                                src={isTargetVideo ? `/api/files/raw?path=${encodeURIComponent(item.target_path)}` : `/api/files/preview?path=${encodeURIComponent(item.target_path)}`}
                                type={isTargetVideo ? 'video' : 'image'}
                                alt="Target"
                                size={100}
                                onDeleted={() => handleItemDeleted(`target-${item.candidate_id}`, item.target_path)}
                                onClick={() => openLightbox(item.target_path, isTargetVideo)}
                              />
                            )}
                          </Box>
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                          {isTargetVideo ? <MovieIcon sx={{ fontSize: 12, color: '#ce93d8', flexShrink: 0 }} /> : <ImageIcon sx={{ fontSize: 12, color: '#90caf9', flexShrink: 0 }} />}
                          <Tooltip title={item.target_path}>
                            <Typography variant="caption" sx={{ color: '#aaa', fontSize: '0.6rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {item.target_path.split(/[\\/]/).pop()}
                            </Typography>
                          </Tooltip>
                        </Box>
                      </Box>
                    </Box>

                    {/* Switch Button */}
                    <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', flexShrink: 0 }}>
                      <Tooltip title="Switch keeper">
                        <IconButton
                          size="small"
                          onClick={() => typeof onSwitch === 'function' && onSwitch(group)}
                          sx={{
                            bgcolor: 'rgba(255, 142, 83, 0.1)',
                            color: '#FF8E53',
                            '&:hover': { bgcolor: 'rgba(255, 142, 83, 0.2)' }
                          }}
                        >
                          <SwapHorizIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                    {/* REMOVE Side */}
                    <Box sx={{ width: 'calc(50% - 16px)', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                        <DeleteIcon sx={{ color: '#f44336', fontSize: 12 }} />
                        <Typography variant="caption" sx={{ color: '#f44336', fontSize: '0.6rem', fontWeight: 'bold' }}>REMOVE</Typography>
                      </Box>
                      <Box
                        onClick={() => handleToggleItem(item.id)}
                        sx={{
                          p: 1,
                          bgcolor: '#1a1a1a',
                          borderRadius: 1,
                          border: isSelected ? '2px solid #FF8E53' : '1px solid #333',
                          display: 'flex',
                          flexDirection: 'column',
                          cursor: 'pointer',
                          transition: 'border-color 0.15s',
                          flex: 1,
                          '&:hover': { borderColor: isSelected ? '#FE6B8B' : '#555' }
                        }}
                      >
                        <Box sx={{ position: 'relative', width: '100%', paddingTop: '100%', borderRadius: 1, overflow: 'hidden', bgcolor: '#000', mb: 1 }}>
                          <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
                            {sourceDeleted ? (
                              <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', bgcolor: 'rgba(244, 67, 54, 0.1)' }}>
                                <BrokenImageIcon sx={{ color: '#f44336', fontSize: 24 }} />
                                <Typography variant="caption" sx={{ color: '#f44336', fontSize: '0.5rem' }}>Deleted</Typography>
                              </Box>
                            ) : (committing && isSelected) ? (
                              <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', bgcolor: '#000' }}>
                                <CircularProgress size={24} sx={{ color: '#FF8E53', mb: 1 }} />
                                <Typography variant="caption" sx={{ color: '#FF8E53', fontSize: '0.6rem' }}>Processing...</Typography>
                              </Box>
                            ) : (
                              <MediaThumbnail
                                src={isSourceVideo ? `/api/files/raw?path=${encodeURIComponent(item.source_path)}` : `/api/files/preview?path=${encodeURIComponent(item.source_path)}`}
                                type={isSourceVideo ? 'video' : 'image'}
                                alt="Source"
                                size={100}
                                onDeleted={() => handleItemDeleted(item.id, item.source_path)}
                                onClick={() => openLightbox(item.source_path, isSourceVideo)}
                              />
                            )}
                            <Checkbox
                              checked={isSelected}
                              size="small"
                              sx={{
                                position: 'absolute',
                                top: 2,
                                left: 2,
                                p: 0.25,
                                bgcolor: 'rgba(0,0,0,0.6)',
                                borderRadius: 0.5,
                                color: '#888',
                                '&.Mui-checked': { color: '#FF8E53' }
                              }}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <Chip
                              label={item.exact_match ? 'EXACT' : `${getSimilarityPercent(item.hamming_distance)}%`}
                              size="small"
                              sx={{
                                position: 'absolute',
                                top: 2,
                                right: 2,
                                height: 16,
                                fontSize: '0.55rem',
                                fontWeight: 'bold',
                                bgcolor: item.exact_match ? '#f44336' : '#ed6c02',
                                color: '#fff'
                              }}
                            />
                          </Box>
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                          {isSourceVideo ? <MovieIcon sx={{ fontSize: 12, color: '#ce93d8', flexShrink: 0 }} /> : <ImageIcon sx={{ fontSize: 12, color: '#90caf9', flexShrink: 0 }} />}
                          <Tooltip title={item.source_path}>
                            <Typography variant="caption" sx={{ color: '#aaa', fontSize: '0.6rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {item.source_path.split(/[\\/]/).pop()}
                            </Typography>
                          </Tooltip>
                        </Box>
                      </Box>
                    </Box>
                  </Box>
                </Paper>
              );
            })}
          </Box>
        </Box>
      )}

      {/* Groups Section - Full Width List */}
      {groups.length > 0 && (
        <Box>
          {pairs.length > 0 && (
            <Typography variant="subtitle2" sx={{ color: '#888', mb: 2, mt: 2 }}>
              Groups ({groups.length})
            </Typography>
          )}
          <Box sx={{
            width: '100%',
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, 1fr)', xl: 'repeat(2, 1fr)' },
            gap: 2
          }}>
            {groups.map((group, groupIndex) => {
              const firstItem = group[0];
              const isTargetVideo = isVideoPath(firstItem.target_path);
              const actualIndex = startIndex + paginatedGroups.indexOf(group);
              const isTargetDeleted = firstItem.target_deleted === 1 || detectedDeleted.has(`target-${firstItem.candidate_id}`);

              return (
                <Paper
                  key={`group-${actualIndex}`}
                  elevation={0}
                  sx={{
                    p: 2,
                    bgcolor: '#252525',
                    border: '1px solid #444',
                    borderRadius: 2,
                    transition: 'border-color 0.2s',
                    '&:hover': { borderColor: '#666' }
                  }}
                >
                  {/* Group Header */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, pb: 1.5, borderBottom: '1px solid #333' }}>
                    <Chip
                      label={`${group.length + 1} dupes`}
                      size="small"
                      sx={{ bgcolor: 'rgba(25, 118, 210, 0.2)', color: '#90caf9', fontWeight: 'bold', fontSize: '0.7rem' }}
                    />
                    <Typography variant="caption" sx={{ color: '#666' }}>
                      Keep 1, Remove {group.length}
                    </Typography>
                  </Box>

                  {/* Content: KEEP + REMOVE stacked vertically */}
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {/* KEEP Side */}
                    <Box sx={{ width: '100%', boxSizing: 'border-box' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                        <CheckCircleIcon sx={{ color: '#4caf50', fontSize: 12 }} />
                        <Typography variant="caption" sx={{ color: '#4caf50', fontSize: '0.6rem', fontWeight: 'bold' }}>KEEP</Typography>
                      </Box>
                      <Box sx={{ p: 1.5, bgcolor: '#1a1a1a', borderRadius: 1.5, border: '2px solid #4caf50' }}>
                        <Box sx={{ width: '100%', paddingTop: '100%', position: 'relative', borderRadius: 1, overflow: 'hidden', bgcolor: '#000', mb: 1 }}>
                          {isTargetDeleted ? (
                            <Box sx={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', bgcolor: 'rgba(244, 67, 54, 0.1)' }}>
                              <BrokenImageIcon sx={{ color: '#f44336', fontSize: 24 }} />
                              <Typography variant="caption" sx={{ color: '#f44336', fontSize: '0.5rem' }}>Deleted</Typography>
                            </Box>
                          ) : (
                            <Box sx={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
                              <MediaThumbnail
                                src={isTargetVideo ? `/api/files/raw?path=${encodeURIComponent(firstItem.target_path)}` : `/api/files/preview?path=${encodeURIComponent(firstItem.target_path)}`}
                                type={isTargetVideo ? 'video' : 'image'}
                                alt="Target"
                                size="100%"
                                onDeleted={() => handleItemDeleted(`target-${firstItem.candidate_id}`, firstItem.target_path)}
                                onClick={() => openLightbox(firstItem.target_path, isTargetVideo)}
                              />
                            </Box>
                          )}
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          {isTargetVideo ? <MovieIcon sx={{ fontSize: 12, color: '#ce93d8' }} /> : <ImageIcon sx={{ fontSize: 12, color: '#90caf9' }} />}
                          <Tooltip title={firstItem.target_path}>
                            <Typography variant="caption" sx={{ color: '#aaa', fontSize: '0.6rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {firstItem.target_path.split(/[\\/]/).pop()}
                            </Typography>
                          </Tooltip>
                        </Box>
                      </Box>
                    </Box>

                    {/* Switch Button (Centered) */}
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
                      <Tooltip title={!group.some(i => !selectedItems.has(i.id)) ? 'Unselect an item to enable switch' : 'Switch keeper'}>
                        <span>
                          <IconButton
                            size="small"
                            onClick={() => typeof onSwitch === 'function' && onSwitch(group)}
                            disabled={!group.some(i => !selectedItems.has(i.id))}
                            sx={{
                              bgcolor: 'rgba(255, 142, 83, 0.1)',
                              color: '#FF8E53',
                              transform: 'rotate(90deg)',
                              '&:hover': { bgcolor: 'rgba(255, 142, 83, 0.2)' },
                              '&.Mui-disabled': { color: '#444', bgcolor: 'transparent' }
                            }}
                          >
                            <SwapHorizIcon />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Box>

                    {/* REMOVE Side */}
                    <Box sx={{ width: '100%' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                        <DeleteIcon sx={{ color: '#f44336', fontSize: 12 }} />
                        <Typography variant="caption" sx={{ color: '#f44336', fontSize: '0.6rem', fontWeight: 'bold' }}>REMOVE ({group.length})</Typography>
                      </Box>

                      <Box sx={{
                        display: 'grid',
                        gridTemplateColumns: group.length > 1 ? 'repeat(2, 1fr)' : '1fr',
                        gap: 1,
                        p: 1.5,
                        bgcolor: '#1a1a1a',
                        borderRadius: 1.5,
                        border: '1px solid #333'
                      }}>
                        {group.map((item) => {
                          const isSourceVideo = isVideoPath(item.source_path);
                          const isSelected = selectedItems.has(item.id);
                          const itemDeleted = isItemDeleted(item);

                          if (itemDeleted) {
                            return (
                              <CompactDeletedRow
                                key={item.id}
                                item={item}
                                isSelected={isSelected}
                                onToggle={handleToggleItem}
                                getSimilarityPercent={getSimilarityPercent}
                                isVideoPath={isVideoPath}
                              />
                            );
                          }

                          return (
                            <Box
                              key={item.id}
                              onClick={() => handleToggleItem(item.id)}
                              sx={{
                                p: 1,
                                bgcolor: '#252525',
                                borderRadius: 1,
                                border: isSelected ? '2px solid #FF8E53' : '1px solid #444',
                                cursor: 'pointer',
                                transition: 'border-color 0.15s',
                                '&:hover': { borderColor: isSelected ? '#FE6B8B' : '#666' }
                              }}
                            >
                              <Box sx={{ position: 'relative', width: '100%', paddingTop: '100%', borderRadius: 1, overflow: 'hidden', bgcolor: '#000', mb: 0.5 }}>
                                <Box sx={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
                                  {(committing && isSelected) ? (
                                    <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', bgcolor: '#000' }}>
                                      <CircularProgress size={24} sx={{ color: '#FF8E53', mb: 1 }} />
                                      <Typography variant="caption" sx={{ color: '#FF8E53', fontSize: '0.6rem' }}>Processing...</Typography>
                                    </Box>
                                  ) : (
                                    <MediaThumbnail
                                      src={isSourceVideo ? `/api/files/raw?path=${encodeURIComponent(item.source_path)}` : `/api/files/preview?path=${encodeURIComponent(item.source_path)}`}
                                      type={isSourceVideo ? 'video' : 'image'}
                                      alt="Source"
                                      size="100%"
                                      onDeleted={() => handleItemDeleted(item.id, item.source_path)}
                                    />
                                  )}
                                </Box>
                                <Checkbox
                                  checked={isSelected}
                                  size="small"
                                  sx={{
                                    position: 'absolute',
                                    top: 2,
                                    left: 2,
                                    p: 0.25,
                                    bgcolor: 'rgba(0,0,0,0.6)',
                                    borderRadius: 0.5,
                                    color: '#888',
                                    '&.Mui-checked': { color: '#FF8E53' }
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                />
                                <Chip
                                  label={`${getSimilarityPercent(item.hamming_distance)}%`}
                                  size="small"
                                  sx={{
                                    position: 'absolute',
                                    top: 2,
                                    right: 2,
                                    height: 16,
                                    fontSize: '0.55rem',
                                    fontWeight: 'bold',
                                    bgcolor: item.exact_match ? '#f44336' : '#ed6c02',
                                    color: '#fff'
                                  }}
                                />
                              </Box>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                                {isSourceVideo ? <MovieIcon sx={{ fontSize: 10, color: '#ce93d8', flexShrink: 0 }} /> : <ImageIcon sx={{ fontSize: 10, color: '#90caf9', flexShrink: 0 }} />}
                                <Tooltip title={item.source_path}>
                                  <Typography variant="caption" sx={{ color: '#aaa', fontSize: '0.55rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {item.source_path.split(/[\\/]/).pop()}
                                  </Typography>
                                </Tooltip>
                              </Box>
                            </Box>
                          );
                        })}
                      </Box>
                    </Box>
                  </Box>
                </Paper>
              );
            })}
          </Box>
        </Box>
      )}

      {/* Pagination Controls - Bottom */}
      {totalPages > 1 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
          <Pagination
            count={totalPages}
            page={displayPage}
            onChange={handlePageChange}
            color="primary"
            size="large"
            showFirstButton
            showLastButton
            sx={{
              '& .MuiPaginationItem-root': { color: '#aaa' },
              '& .Mui-selected': { bgcolor: 'rgba(255, 142, 83, 0.2) !important', color: '#FF8E53' }
            }}
          />
        </Box>
      )}
    </>
  );
};

export default HashResultsGrid;
