export const formatRating = (rating) => {
  if (rating === null || rating === undefined) return '–';
  const formatted = Number(rating).toFixed(1);
  return formatted.endsWith('.0') ? formatted.slice(0, -2) : formatted;
};

export const formatDuration = (seconds) => {
  const total = Math.floor(Number(seconds));
  if (!Number.isFinite(total) || total <= 0) return null;
  const s = String(total % 60).padStart(2, '0');
  if (total >= 3600) {
    return `${Math.floor(total / 3600)}:${String(Math.floor((total % 3600) / 60)).padStart(2, '0')}:${s}`;
  }
  return `${Math.floor(total / 60)}:${s}`;
};
