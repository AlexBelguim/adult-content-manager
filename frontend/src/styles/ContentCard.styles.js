// Main label styles for origin counts
import { Padding } from "@mui/icons-material";
// Main label styles for origin counts
export const chipLabelOriginPicsSx = { color: '#90caf9', fontWeight: 500 };
export const chipLabelOriginVidsSx = { color: '#ef9a9a', fontWeight: 500 };
export const chipLabelOriginFunscriptsSx = { color: '#a5d6a7', fontWeight: 500 };
export const chipLabelOriginTotalSx = { color: '#fff', fontWeight: 500 };

// Chip icon styles
export const chipIconPicsSx = { color: '#90caf9', fontSize: 18 };
export const chipIconVidsSx = { color: '#ef9a9a', fontSize: 18 };
export const chipIconFunscriptsSx = { color: '#a5d6a7', fontSize: 18 };
export const chipIconTotalSx = { color: '#fff', fontSize: 18 };

// Chip label span styles
export const chipLabelRootSx = {
    display: 'flex',
    width: '5em',
    flex: 1,              
    justifyContent: 'space-between',
};

export const chipLabelVirtualSx = {
  color: '#888',
  fontSize: 12,
  display: 'inline-block',
  textAlign: 'right'
};
// ContentCard.styles.js
// All style objects for ContentCard component

export const cardSx = {
  height: '100%',
  transition: 'all 0.3s ease',
  '&:hover': {
    transform: 'translateY(-4px)',
    boxShadow: 6
  }
};

export const cardActionAreaSx = {
  height: '100%'
};

export const cardContentSx = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  height: '100%',
  justifyContent: 'space-between',
  p: 2
};

export const avatarSx = {
  width: 56,
  height: 56,
  bgcolor: 'primary.main',
  mb: 1.5
};

export const genreNameSx = {
  fontWeight: 500,
  textAlign: 'center',
  mb: 1,
  wordBreak: 'break-word',
  fontSize: 17
};

export const statsBoxSx = {
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  mt: 1,
  mb: 1,
  alignItems: 'stretch',
  width: '100%'
};

export const chipPicsSx = {
  bgcolor: '#23272f',
  color: '#90caf9',
  fontWeight: 400,
  px: 1,
  height: 24,
  fontSize: 13,
  borderRadius: 2,
  width: '100%',
  justifyContent: 'flex-start',
  minWidth: 0
};

export const chipVidsSx = {
  bgcolor: '#23272f',
  color: '#90caf9',
  fontWeight: 400,
  px: 1,
  height: 24,
  fontSize: 13,
  borderRadius: 2,
  width: '100%',
  justifyContent: 'flex-start',
  minWidth: 0
};

export const chipFunscriptsSx = {
  bgcolor: '#23272f',
  color: '#90caf9',
  fontWeight: 400,
  px: 1,
  height: 24,
  fontSize: 13,
  borderRadius: 2,
  width: '100%',
  justifyContent: 'flex-start',
  minWidth: 0
};

export const chipTotalSx = {
  bgcolor: '#23272f',
  color: '#90caf9',
  fontWeight: 400,
  px: 1,
  height: 24,
  fontSize: 13,
  borderRadius: 2,
  width: '100%',
  justifyContent: 'flex-start',
  minWidth: 0
};

export const sizeBoxSx = {
  display: 'flex',
  alignItems: 'center',
  gap: 1,
  mt: 0.5
};
