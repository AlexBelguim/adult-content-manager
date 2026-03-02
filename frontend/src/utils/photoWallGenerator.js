/**
 * Photo Wall Generator
 * 
 * Creates a teen crush wall aesthetic with scattered photos at various angles.
 * All configurable parameters are at the top for easy tuning.
 */

// ============================================================================
// CONFIGURATION PARAMETERS
// ============================================================================

// --- LAYOUT & DENSITY ---
export const PHOTO_WALL_CONFIG = {
  // Screen multiplier: 3 means wall is 3x wider and 3x taller than viewport (for panning)
  screenMultiplier: 3,

  // Average item dimensions used to calculate how many photos to place
  avgItemWidth: 220,
  avgItemHeight: 280,

  // Coverage multiplier: 1.5 means place 50% more items for better density
  coverageMultiplier: 1.3, // Slightly more than minimum to ensure full coverage

  // Grid distribution (rough columns/rows for initial placement before randomization)
  gridCellWidth: 200,  // Larger cells for better spread
  gridCellHeight: 250, // Larger cells for better spread
};

// --- PHOTO SIZES & SHAPES ---
export const PHOTO_SIZES_CONFIG = {
  // Photo size multiplier range (0.6-1.1 means 60%-110% of base size)
  sizeMultiplierMin: 0.45,
  sizeMultiplierMax: 1.25,

  // Base sizes for small/medium/large (in pixels)
  baseSizes: {
    square: { small: 140, medium: 200, large: 260 },
    portrait: { small: 120, medium: 180, large: 240 },
    landscape: { small: 140, medium: 200, large: 260 },
    wide: { small: 120, medium: 180, large: 240 },
    tall: { small: 120, medium: 170, large: 220 },
  },

  // Shape aspect ratio variations
  portraitHeightMultiplier: { min: 1.3, max: 1.7 },  // 1.3x to 1.7x taller
  landscapeWidthMultiplier: { min: 1.3, max: 1.7 },  // 1.3x to 1.7x wider
  wideWidthMultiplier: { min: 1.6, max: 2.2 },       // 1.6x to 2.2x wider
  tallHeightMultiplier: { min: 1.6, max: 2.4 },      // 1.6x to 2.4x taller

  // Available shapes (each has equal probability)
  shapes: ['square', 'portrait', 'landscape', 'wide', 'tall'],

  // Available size categories (each has equal probability)
  sizes: ['small', 'medium', 'large'],

  // Rotation angles in degrees (more 0s = more straight photos)
  rotations: [-8, -5, -3, 0, 0, 0, 3, 5, 8],

  // Z-index range for layering effect
  zIndexMin: 0,
  zIndexMax: 20,
  zIndexFallback: 25, // Used for items that couldn't be placed after all attempts
};

// --- SCATTER & RANDOMNESS ---
export const SCATTER_CONFIG = {
  // Random offset range from grid position (in pixels, ±110px means -110 to +110)
  randomOffsetRange: 35, // Less scatter for more even spread

  // Initial grid offset (negative values shift the whole grid)
  // Set to 0 to start at canvas edges for better coverage
  gridOffsetX: 0,
  gridOffsetY: 0,
};

// --- OVERLAP CONTROL ---
export const OVERLAP_CONFIG = {
  // Maximum allowed overlap as percentage of smaller photo's area (0.12 = 12%)
  maxOverlapRatio: 0.1, // 10% overlap allowed - light touching

  // Number of attempts to find a valid position before giving up
  maxAttempts: 75, // More attempts to find good positions

  // Initial nudge distance when photo overlaps too much (in pixels)
  initialNudgeDistance: 40, // Smaller nudges

  // How much to scale up nudges as attempts increase (1 = no scaling, 2 = double by last attempt)
  nudgeScaling: 1, // Moderate nudge scaling

  // When all attempts fail, try placing in a nearby grid cell
  fallbackGridRange: 3, // Check nearby cells for fallback
};

// --- CAMERA PANNING ANIMATION ---
export const CAMERA_CONFIG = {
  // Animation duration in seconds (scales with canvas size for consistent speed)
  panDuration: 30 * PHOTO_WALL_CONFIG.screenMultiplier,

  // Animation easing function
  easing: 'ease-in-out',

  // Keyframe movements as PERCENTAGE of the canvas range (0-100%)
  // These will be converted to actual translate values based on screenMultiplier
  // 0% = starting edge, 100% = far edge of the canvas
  // Using 15-85% range to avoid edges where scattered photos might leave gaps
  keyframes: [
    { at: 0, xPct: 20, yPct: 20, scale: 1.0 }, // Start away from top-left edge
    { at: 12, xPct: 35, yPct: 45, scale: 1.0 }, // Move toward center
    { at: 25, xPct: 55, yPct: 30, scale: 1.0 }, // Mid-canvas, upper area
    { at: 37, xPct: 70, yPct: 55, scale: 1.0 }, // Right side, middle
    { at: 50, xPct: 60, yPct: 75, scale: 1.0 }, // Bottom-right area
    { at: 62, xPct: 40, yPct: 70, scale: 1.0 }, // Bottom-center
    { at: 75, xPct: 25, yPct: 50, scale: 1.0 }, // Left side, mid-height
    { at: 87, xPct: 35, yPct: 35, scale: 1.0 }, // Upper-center area
    { at: 100, xPct: 20, yPct: 20, scale: 1.0 }, // Return to start
  ],
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get a random image from performer's 7-bag (Tetris-style randomness)
 * Ensures better distribution than pure random
 */
export const getRandomImageFromBag = (performerId, thumbnailPaths, bagsRef) => {
  if (!thumbnailPaths || thumbnailPaths.length === 0) return null;
  if (thumbnailPaths.length === 1) return thumbnailPaths[0];

  // Initialize bag for this performer if needed
  if (!bagsRef[performerId] || bagsRef[performerId].length === 0) {
    // Create a new bag with all images
    bagsRef[performerId] = [...thumbnailPaths];
    // Shuffle the bag
    for (let i = bagsRef[performerId].length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bagsRef[performerId][i], bagsRef[performerId][j]] =
        [bagsRef[performerId][j], bagsRef[performerId][i]];
    }
  }

  // Pull next image from bag
  return bagsRef[performerId].pop();
};

/**
 * Calculate overlap area between two rectangles
 */
const calculateOverlapArea = (r1, r2) => {
  const xOverlap = Math.max(0, Math.min(r1.x + r1.width, r2.x + r2.width) - Math.max(r1.x, r2.x));
  const yOverlap = Math.max(0, Math.min(r1.y + r1.height, r2.y + r2.height) - Math.max(r1.y, r2.y));
  return xOverlap * yOverlap;
};

/**
 * Calculate photo dimensions based on shape and size
 */
const calculatePhotoDimensions = (shape, size, sizeMultiplier) => {
  const config = PHOTO_SIZES_CONFIG;
  let width, height;

  const base = config.baseSizes[shape][size] * sizeMultiplier;

  switch (shape) {
    case 'square':
      width = height = base;
      break;

    case 'portrait':
      width = base;
      height = base * (config.portraitHeightMultiplier.min +
        Math.random() * (config.portraitHeightMultiplier.max - config.portraitHeightMultiplier.min));
      break;

    case 'landscape':
      width = base * (config.landscapeWidthMultiplier.min +
        Math.random() * (config.landscapeWidthMultiplier.max - config.landscapeWidthMultiplier.min));
      height = base;
      break;

    case 'wide':
      width = base * (config.wideWidthMultiplier.min +
        Math.random() * (config.wideWidthMultiplier.max - config.wideWidthMultiplier.min));
      height = base;
      break;

    case 'tall':
      width = base;
      height = base * (config.tallHeightMultiplier.min +
        Math.random() * (config.tallHeightMultiplier.max - config.tallHeightMultiplier.min));
      break;

    default:
      width = height = base;
  }

  return { width, height };
};

/**
 * Try to place a photo with overlap constraints
 */
const tryPlacePhoto = (performer, width, height, gridCol, gridRow, cols, rows, screenWidth, screenHeight, placedRects) => {
  const config = PHOTO_SIZES_CONFIG;
  const scatterCfg = SCATTER_CONFIG;
  const overlapCfg = OVERLAP_CONFIG;

  // Base position in grid
  const baseX = gridCol * (screenWidth / cols) + scatterCfg.gridOffsetX;
  const baseY = gridRow * (screenHeight / rows) + scatterCfg.gridOffsetY;

  // Random offset from grid position
  const randomOffsetX = (Math.random() - 0.5) * scatterCfg.randomOffsetRange;
  const randomOffsetY = (Math.random() - 0.5) * scatterCfg.randomOffsetRange;

  // Candidate position
  let candX = baseX + randomOffsetX;
  let candY = baseY + randomOffsetY;

  // Random rotation and z-index
  const rotation = config.rotations[Math.floor(Math.random() * config.rotations.length)];
  const zIndex = Math.floor(Math.random() * (config.zIndexMax - config.zIndexMin + 1)) + config.zIndexMin;

  // Try to find valid position with overlap constraint
  let attempts = 0;
  let placed = false;

  while (!placed && attempts < overlapCfg.maxAttempts) {
    let tooMuch = false;
    const candidateRect = { x: candX, y: candY, width, height };
    const candidateArea = width * height;

    // Check overlap with all placed photos
    for (let other of placedRects) {
      const area = calculateOverlapArea(candidateRect, other);
      if (area <= 0) continue;

      const smallerArea = Math.min(candidateArea, other.width * other.height);
      const ratio = area / (smallerArea || 1);

      if (ratio > overlapCfg.maxOverlapRatio) {
        tooMuch = true;
        break;
      }
    }

    if (!tooMuch) {
      // Accept position WITHOUT clamping - let photos spread naturally
      placed = true;
      placedRects.push({ x: candX, y: candY, width, height });
      return {
        performer,
        selectedThumbnail: performer.selectedThumbnail,
        x: candX,
        y: candY,
        width,
        height,
        rotation,
        zIndex,
        isHero: false,
      };
    }

    // Nudge with progressively larger shifts
    // Formula ensures nudges grow from 1x to (nudgeScaling)x over maxAttempts
    const nudgeScale = 1 + (attempts * (overlapCfg.nudgeScaling - 1) / overlapCfg.maxAttempts);
    candX += (Math.random() - 0.5) * overlapCfg.initialNudgeDistance * nudgeScale;
    candY += (Math.random() - 0.5) * overlapCfg.initialNudgeDistance * nudgeScale;
    attempts++;
  }

  // Fallback: try a different grid cell
  if (!placed) {
    const offsetCols = Math.floor(Math.random() * overlapCfg.fallbackGridRange) - 1;
    const offsetRows = Math.floor(Math.random() * overlapCfg.fallbackGridRange) - 1;
    const newGridCol = Math.max(0, Math.min(cols - 1, gridCol + offsetCols));
    const newGridRow = Math.max(0, Math.min(rows - 1, gridRow + offsetRows));
    const fallbackX = newGridCol * (screenWidth / cols) + scatterCfg.gridOffsetX +
      (Math.random() - 0.5) * scatterCfg.randomOffsetRange;
    const fallbackY = newGridRow * (screenHeight / rows) + scatterCfg.gridOffsetY +
      (Math.random() - 0.5) * scatterCfg.randomOffsetRange;

    // NO clamping - let photos spread naturally
    const fallbackRect = { x: fallbackX, y: fallbackY, width, height };
    placedRects.push(fallbackRect);

    return {
      performer,
      selectedThumbnail: performer.selectedThumbnail,
      x: fallbackX,
      y: fallbackY,
      width,
      height,
      rotation,
      zIndex: config.zIndexFallback,
      isHero: false,
    };
  }

  return null;
};

// ============================================================================
// MAIN GENERATOR FUNCTION
// ============================================================================

/**
 * Generate photo wall layout
 * 
 * @param {Array} performers - List of performer objects
 * @param {Object} bagsRef - Reference object for 7-bag randomness state
 * @returns {Object} { layout: Array, shrinePositions: Array }
 */
export const generatePhotoWallLayout = async (performers, bagsRef) => {
  if (!performers || performers.length === 0) return { layout: [], shrinePositions: [] };

  console.log('=== Generating Photo Wall ===');
  console.log('Total performers:', performers.length);

  const validPerformers = performers.filter(p => p.name);

  if (validPerformers.length === 0) return { layout: [], shrinePositions: [] };

  const config = PHOTO_WALL_CONFIG;
  const sizeCfg = PHOTO_SIZES_CONFIG;

  // Calculate canvas size and items needed
  const screenWidth = window.innerWidth * config.screenMultiplier;
  const screenHeight = window.innerHeight * config.screenMultiplier;

  console.log('🖼️  Canvas calculation:', {
    windowWidth: window.innerWidth,
    windowHeight: window.innerHeight,
    multiplier: config.screenMultiplier,
    calculatedCanvasWidth: screenWidth,
    calculatedCanvasHeight: screenHeight
  });

  const itemsNeeded = Math.ceil(
    (screenWidth * screenHeight) / (config.avgItemWidth * config.avgItemHeight)
  ) * config.coverageMultiplier;

  // Expand performers to fill the wall (with image fetching)
  let expandedPerformers = [];

  while (expandedPerformers.length < itemsNeeded) {
    for (let performer of validPerformers) {
      if (expandedPerformers.length >= itemsNeeded) break;

      // Fetch all pic files from performer's "after" folder
      let allPics = [];
      try {
        const response = await fetch(`/api/performers/${performer.id}/images?filter=pics`);
        if (response.ok) {
          const data = await response.json();
          if (data.pics && Array.isArray(data.pics)) {
            allPics = data.pics.map(pic => pic.path);
          }
        }
      } catch (e) {
        console.error(`Error fetching images for ${performer.name}:`, e);
      }

      if (!allPics || allPics.length === 0) continue;

      // Get random image from 7-bag
      const selectedImage = getRandomImageFromBag(performer.id, allPics, bagsRef);
      if (!selectedImage) continue;

      expandedPerformers.push({
        ...performer,
        selectedThumbnail: selectedImage
      });
    }
  }

  // Generate layout with scatter and overlap control
  const layout = [];
  const placedRects = [];

  const cols = Math.ceil(screenWidth / config.gridCellWidth);
  const rows = Math.ceil(screenHeight / config.gridCellHeight);

  console.log('📊 Grid setup:', {
    cols, rows,
    totalGridCells: cols * rows,
    itemsNeeded,
    expandedPerformersCount: expandedPerformers.length
  });

  // SHUFFLE the performers to randomize which grid cells get filled first
  const shuffled = [...expandedPerformers.slice(0, itemsNeeded)];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // Create array of all grid positions and shuffle them
  const gridPositions = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      gridPositions.push({ col, row });
    }
  }
  // Shuffle grid positions to fill canvas randomly
  for (let i = gridPositions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [gridPositions[i], gridPositions[j]] = [gridPositions[j], gridPositions[i]];
  }

  shuffled.forEach((performer, index) => {
    // Random shape and size
    const shape = sizeCfg.shapes[Math.floor(Math.random() * sizeCfg.shapes.length)];
    const size = sizeCfg.sizes[Math.floor(Math.random() * sizeCfg.sizes.length)];
    const sizeMultiplier = sizeCfg.sizeMultiplierMin +
      Math.random() * (sizeCfg.sizeMultiplierMax - sizeCfg.sizeMultiplierMin);

    // Calculate dimensions
    const { width, height } = calculatePhotoDimensions(shape, size, sizeMultiplier);

    // Use randomized grid position instead of sequential
    const gridPos = gridPositions[index % gridPositions.length];
    const gridCol = gridPos.col;
    const gridRow = gridPos.row;

    // Try to place the photo
    const item = tryPlacePhoto(
      performer, width, height,
      gridCol, gridRow, cols, rows,
      screenWidth, screenHeight,
      placedRects
    );

    if (item) {
      layout.push(item);
    }
  });

  console.log(`Generated teen wall layout with ${layout.length} items (scattered style)`);
  console.log('Canvas size:', { screenWidth, screenHeight });
  console.log('Grid dimensions:', { cols, rows });
  console.log('Items needed:', itemsNeeded);

  // Debug: Check photo distribution
  const xSegments = 10;
  const ySegments = 10;
  const segmentWidth = screenWidth / xSegments;
  const segmentHeight = screenHeight / ySegments;
  const xDistribution = new Array(xSegments).fill(0);
  const yDistribution = new Array(ySegments).fill(0);

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  layout.forEach(item => {
    // Track bounds
    minX = Math.min(minX, item.x);
    maxX = Math.max(maxX, item.x);
    minY = Math.min(minY, item.y);
    maxY = Math.max(maxY, item.y);

    // Horizontal distribution
    const xSegment = Math.floor(item.x / segmentWidth);
    if (xSegment >= 0 && xSegment < xSegments) {
      xDistribution[xSegment]++;
    }

    // Vertical distribution
    const ySegment = Math.floor(item.y / segmentHeight);
    if (ySegment >= 0 && ySegment < ySegments) {
      yDistribution[ySegment]++;
    }
  });

  console.log('Photo bounds:', {
    minX, maxX, minY, maxY,
    xCoverage: `${((maxX / screenWidth) * 100).toFixed(1)}%`,
    yCoverage: `${((maxY / screenHeight) * 100).toFixed(1)}%`
  });
  console.log('Horizontal distribution (left to right):', xDistribution);
  console.log('Vertical distribution (top to bottom):', yDistribution);

  return { layout, shrinePositions: [] };
};

// ============================================================================
// CSS ANIMATION GENERATION
// ============================================================================

/**
 * Generate CSS keyframes object for camera panning
 * Converts percentage-based positions to actual translate values based on screenMultiplier
 */
export const generateCameraKeyframes = () => {
  const keyframes = {};
  const multiplier = PHOTO_WALL_CONFIG.screenMultiplier;

  // CORRECTED: translate(X%) moves by X% of the ELEMENT'S size, not viewport
  // Canvas is (multiplier * 100)% wide, viewport sees 100% at a time
  // To pan across the full canvas, we need to translate by -(multiplier - 1) * 100 / multiplier
  // For 3x: need to move -200% distance, but on 300% element = -200/3 = -66.67%
  const maxTranslatePercent = ((multiplier - 1) / multiplier) * 100;

  console.log('🎥 Camera keyframe generation:');
  console.log('  Screen multiplier:', multiplier);
  console.log('  Canvas size:', (multiplier * 100) + '% (of viewport)');
  console.log('  Max translate:', maxTranslatePercent.toFixed(2) + '% (of canvas)');

  CAMERA_CONFIG.keyframes.forEach(kf => {
    // Convert 0-100% position to actual translate percentage of canvas
    const xTranslate = -(kf.xPct / 100) * maxTranslatePercent;
    const yTranslate = -(kf.yPct / 100) * maxTranslatePercent;

    console.log(`  Keyframe ${kf.at}%: xPct=${kf.xPct}% → ${xTranslate.toFixed(2)}%, yPct=${kf.yPct}% → ${yTranslate.toFixed(2)}%`);

    keyframes[`${kf.at}%`] = {
      transform: `translate(${xTranslate}%, ${yTranslate}%) scale(${kf.scale})`
    };
  });

  return keyframes;
};

/**
 * Get camera animation CSS string
 */
export const getCameraAnimationCSS = () => {
  return `cameraMove ${CAMERA_CONFIG.panDuration}s ${CAMERA_CONFIG.easing} infinite`;
};
