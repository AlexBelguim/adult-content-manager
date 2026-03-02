
import React from 'react';
import {
  Card,
  CardContent,
  CardActionArea,
  Typography,
  Box,
  Chip,
  Avatar
} from '@mui/material';
import {
  Folder,
  PhotoLibrary,
  VideoLibrary,
  Storage,
  PlayCircle
} from '@mui/icons-material';
import {
  cardSx,
  cardActionAreaSx,
  cardContentSx,
  avatarSx,
  genreNameSx,
  statsBoxSx,
  chipPicsSx,
  chipVidsSx,
  chipFunscriptsSx,
  chipTotalSx,
  sizeBoxSx,
  chipIconPicsSx,
  chipIconVidsSx,
  chipIconFunscriptsSx,
  chipIconTotalSx,
  chipLabelRootSx,
  chipLabelVirtualSx,
  chipLabelOriginPicsSx,
  chipLabelOriginVidsSx,
  chipLabelOriginFunscriptsSx,
  chipLabelOriginTotalSx
} from '../styles/ContentCard.styles';

function ContentCard({ genre, onClick, basePath }) {
  const handleClick = () => {
    // Open unified gallery in new tab for content genre
    const genreUrl = `/unified-gallery?genre=${encodeURIComponent(genre.name)}&basePath=${encodeURIComponent(basePath)}`;
    window.open(genreUrl, '_blank');
    
    // Also call the onClick handler if provided
    if (onClick) {
      onClick(genre);
    }
  };

  // Support for virtualCounts-aware stats (backend now returns correct totals)
  // Accepts: genre.pics, genre.vids, genre.funscripts, genre.originCounts, genre.virtualCounts
  const pics = genre.pics || 0;
  const vids = genre.vids || 0;
  const funscripts = genre.funscripts || 0;
  const total = pics + vids + funscripts;
  const origin = genre.originCounts || {};
  const virtual = genre.virtualCounts || {};
  const showBreakdown = origin.pics !== undefined && virtual.pics !== undefined;

  return (
    <Card sx={cardSx}>
      <CardActionArea onClick={handleClick} sx={cardActionAreaSx}>
        <CardContent sx={cardContentSx}>
          {/* Genre Icon */}
          <Avatar sx={avatarSx}>
            <Folder sx={{ fontSize: 28 }} />
          </Avatar>

          {/* Genre Name */}
          <Typography variant="subtitle1" sx={genreNameSx}>
            {genre.name}
          </Typography>

          {/* Stacked Stats Chips */}
          <Box sx={statsBoxSx}>
            {/* Pictures */}
            <Chip
              icon={<PhotoLibrary sx={chipIconPicsSx} />}
              label={showBreakdown
                ? (
                  <span style={chipLabelRootSx}>
                    <span style={chipLabelOriginPicsSx}>{origin.pics}</span>
                    <span style={chipLabelVirtualSx}>+{virtual.pics}</span>
                  </span>
                )
                : <span style={chipLabelOriginPicsSx}>{pics}</span>
              }
              size="small"
              sx={chipPicsSx}
              title="Pictures (origin + tagged)"
            />
            {/* Videos */}
            <Chip
              icon={<VideoLibrary sx={chipIconVidsSx} />}
              label={showBreakdown
                ? (
                  <span style={chipLabelRootSx}>
                    <span style={chipLabelOriginVidsSx}>{origin.vids}</span>
                    <span style={chipLabelVirtualSx}>+{virtual.vids}</span>
                  </span>
                )
                : <span style={chipLabelOriginVidsSx}>{vids}</span>
              }
              size="small"
              sx={chipVidsSx}
              title="Videos (origin + tagged)"
            />
            {/* Funscripts */}
            <Chip
              icon={<PlayCircle sx={chipIconFunscriptsSx} />}
              label={showBreakdown
                ? (
                  <span style={chipLabelRootSx}>
                    <span style={chipLabelOriginFunscriptsSx}>{origin.funscripts}</span>
                    <span style={chipLabelVirtualSx}>+{virtual.funscripts}</span>
                  </span>
                )
                : <span style={chipLabelOriginFunscriptsSx}>{funscripts}</span>
              }
              size="small"
              sx={chipFunscriptsSx}
              title="Funscripts (origin + tagged)"
            />
            {/* Total */}
            <Chip
              icon={<Storage sx={chipIconTotalSx} />}
              label={showBreakdown
                ? (
                  <span style={chipLabelRootSx}>
                    <span style={chipLabelOriginTotalSx}>{origin.pics + origin.vids + origin.funscripts}</span>
                    <span style={chipLabelVirtualSx}>+{virtual.pics + virtual.vids + virtual.funscripts}</span>
                  </span>
                )
                : <span style={chipLabelOriginTotalSx}>{total}</span>
              }
              size="small"
              sx={chipTotalSx}
              title="Total (origin + tagged)"
            />
          </Box>

          {/* Size */}
          <Box sx={sizeBoxSx}>
            <Storage sx={{ color: 'text.secondary', fontSize: 18 }} />
            <Typography variant="caption" color="text.secondary">
              {genre.size} GB
            </Typography>
          </Box>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

export default ContentCard;
