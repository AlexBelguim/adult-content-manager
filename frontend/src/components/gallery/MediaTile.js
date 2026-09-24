import React, { useEffect, useRef, useState } from 'react';
import { formatDuration, formatRating } from './format';

/**
 * One masonry tile: lazy thumbnail at the item's native ratio, corner badges,
 * hover overlay, caption, and (videos) the thumbnail-refresh button.
 *
 * `tab` is 0 pictures / 1 videos / 2 funscript videos.
 */
const MediaTile = ({ item, index, tab, ratio, showElo, onOpen, onNaturalSize }) => {
  const isVideo = tab !== 0;
  const [thumbSrc, setThumbSrc] = useState(item.thumbnail);
  const [thumbFailed, setThumbFailed] = useState(false);
  const [refreshState, setRefreshState] = useState('idle'); // idle | busy | ok | fail
  const feedbackTimer = useRef(null);

  useEffect(() => {
    setThumbSrc(item.thumbnail);
    setThumbFailed(false);
  }, [item.thumbnail]);

  useEffect(() => () => clearTimeout(feedbackTimer.current), []);

  const open = () => onOpen(index);

  const handleKeyDown = (e) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  };

  // Same call the old in-tile player made: new frame from a random position,
  // then a cache-busted thumbnail URL.
  const regenerateThumbnail = async (e) => {
    e.stopPropagation();
    if (refreshState === 'busy') return;
    setRefreshState('busy');
    let next = 'ok';
    try {
      const response = await fetch('/api/files/regenerate-thumbnail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: item.path }),
      });
      if (!response.ok) throw new Error('Failed to regenerate thumbnail');
      await response.json();
      setThumbFailed(false);
      setThumbSrc(`/api/files/video-thumbnail?path=${encodeURIComponent(item.path)}&t=${Date.now()}`);
    } catch (err) {
      console.error('Error regenerating thumbnail:', err);
      next = 'fail';
    }
    setRefreshState(next);
    clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setRefreshState('idle'), 1500);
  };

  const duration = isVideo ? formatDuration(item.duration) : null;
  const hasFunscriptCount = isVideo && item.funscriptCount !== undefined && item.funscriptCount !== null;
  const funscriptsBad = item.missingFunscripts || !item.funscriptCount;
  const starClass = `ug-star${item.videoRating == null ? ' ug-nil' : ''}`;

  return (
    <div
      className="ug-mt"
      role="button"
      tabIndex={0}
      aria-label={`Open ${item.name}`}
      onClick={open}
      onKeyDown={handleKeyDown}
    >
      <div className="ug-tile" style={{ aspectRatio: String(ratio) }}>
        {thumbSrc && !thumbFailed && (
          <img
            src={thumbSrc}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            onLoad={(e) => onNaturalSize(item, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
            onError={() => setThumbFailed(true)}
          />
        )}
        {isVideo && <svg className="ug-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>}

        {isVideo && <span className={`ug-bdg tl ${starClass}`}>★ {formatRating(item.videoRating)}</span>}
        {duration && <span className="ug-bdg br">{duration}</span>}
        {hasFunscriptCount && tab === 2 && (
          <span className={`ug-bdg bl ug-fsc${funscriptsBad ? ' zero' : ''}`}>{item.funscriptCount} fs</span>
        )}

        {isVideo && (
          <button
            type="button"
            className={`ug-refresh ${refreshState}`}
            title="Generate new thumbnail from random position"
            aria-label="Generate new thumbnail"
            disabled={refreshState === 'busy'}
            onClick={regenerateThumbnail}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <span>🔄</span>
          </button>
        )}

        <div className="ug-hov">
          <b>{item.name}</b>
          <div className="ug-row">
            {item.sizeFormatted && <span>{item.sizeFormatted}</span>}
            {!isVideo && showElo && item._pairwiseScore != null && <span>ELO {Math.round(item._pairwiseScore * 10) / 10}</span>}
            {isVideo && <span className={starClass}>★ {formatRating(item.videoRating)}</span>}
            {tab === 2 && (
              <span className={`ug-note${item.funscriptRating == null ? ' ug-nil' : ''}`}>♪ {formatRating(item.funscriptRating)}</span>
            )}
            {hasFunscriptCount && (
              <span className={`ug-fsc${funscriptsBad ? ' zero' : ''}`}>{item.funscriptCount} funscripts</span>
            )}
          </div>
        </div>
      </div>

      <div className="ug-cap">
        <b title={item.name}>{item.name}</b>
        {isVideo
          ? <span className={starClass}>★ {formatRating(item.videoRating)}</span>
          : <span className="sz">{item.sizeFormatted}</span>}
      </div>
    </div>
  );
};

export default React.memo(MediaTile);
