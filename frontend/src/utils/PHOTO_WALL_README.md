# Photo Wall Generator Configuration Guide

This document explains how to customize the photo wall slideshow feature.

## Quick Start

All configuration is in `photoWallGenerator.js` at the top of the file. Each config object is clearly documented.

## Configuration Sections

### 1. Layout & Density (`PHOTO_WALL_CONFIG`)

Controls the overall canvas size and photo density:

```javascript
screenMultiplier: 3        // Wall is 3x screen size (allows panning)
avgItemWidth: 220          // Average photo width for density calculation
avgItemHeight: 280         // Average photo height for density calculation
coverageMultiplier: 1.5    // Place 50% more photos for better coverage
gridCellWidth: 200         // Wider = fewer columns = more scattered
gridCellHeight: 250        // Taller = fewer rows = more vertical space
```

**Tips:**
- Increase `coverageMultiplier` (e.g., 2.0) for denser walls
- Decrease `gridCellWidth/Height` for tighter initial grid
- Increase `screenMultiplier` for larger panning area

### 2. Photo Sizes & Shapes (`PHOTO_SIZES_CONFIG`)

Controls photo dimensions and aspect ratios:

```javascript
sizeMultiplierMin: 0.6     // Smallest photos are 60% of base
sizeMultiplierMax: 1.1     // Largest photos are 110% of base

baseSizes: {
  square: { small: 140, medium: 200, large: 260 },
  portrait: { small: 120, medium: 180, large: 240 },
  // ... etc
}

shapes: ['square', 'portrait', 'landscape', 'wide', 'tall']
sizes: ['small', 'medium', 'large']
rotations: [-8, -5, -3, 0, 0, 0, 3, 5, 8]  // More 0s = more straight photos
```

**Tips:**
- Adjust `baseSizes` to make all photos larger/smaller
- Remove shapes from array to exclude them (e.g., `['square', 'portrait']` only)
- Change rotation array for different tilt distributions
- Modify aspect multipliers (e.g., `portraitHeightMultiplier`) for taller/wider photos

### 3. Scatter & Randomness (`SCATTER_CONFIG`)

Controls how photos are scattered from grid positions:

```javascript
randomOffsetRange: 220     // Total random offset (±110px from grid)
gridOffsetX: -200          // Shift entire grid left/right
gridOffsetY: -200          // Shift entire grid up/down
```

**Tips:**
- Increase `randomOffsetRange` (e.g., 400) for more chaotic scatter
- Decrease (e.g., 100) for tidier, more grid-like appearance
- Adjust `gridOffset` to reposition the entire wall

### 4. Overlap Control (`OVERLAP_CONFIG`)

Controls how much photos can overlap:

```javascript
maxOverlapRatio: 0.12      // Max 12% of smaller photo can overlap
maxAttempts: 25            // Try 25 times to find valid position
initialNudgeDistance: 140  // Start with ±70px nudges
nudgeScaling: 4            // Nudges grow 4x over attempts
fallbackGridRange: 3       // Try nearby cells if can't place
```

**Tips:**
- **For less overlap:** Decrease `maxOverlapRatio` (e.g., 0.05 = 5%)
- **For more overlap:** Increase `maxOverlapRatio` (e.g., 0.20 = 20%)
- **Performance:** Lower `maxAttempts` for faster generation (may place more fallback items)
- **Better placement:** Increase `maxAttempts` (e.g., 40) and `initialNudgeDistance`

### 5. Camera Panning (`CAMERA_CONFIG`)

Controls the automatic camera movement:

```javascript
panDuration: 180           // 180 seconds (3 minutes) per cycle
easing: 'ease-in-out'      // CSS easing function

keyframes: [
  { at: 0,   x: 0,    y: 0,    scale: 1.0   },  // Start
  { at: 12,  x: -8,   y: -12,  scale: 1.05  },  // 12% through cycle
  // ... etc
]
```

**Tips:**
- **Faster panning:** Decrease `panDuration` (e.g., 90 for 1.5 minutes)
- **Slower panning:** Increase `panDuration` (e.g., 300 for 5 minutes)
- **More zoom:** Increase `scale` values (e.g., 1.15 for 15% zoom)
- **Less zoom:** Keep `scale` closer to 1.0
- **Different path:** Modify x/y values (negative = pan right/down)
- **More keyframes:** Add more objects to create complex paths
- **Different easing:** Try 'linear', 'ease', 'ease-in', 'ease-out'

## Common Adjustments

### Make Wall Denser (Less Space Between Photos)

```javascript
PHOTO_WALL_CONFIG.coverageMultiplier = 2.0  // More photos
OVERLAP_CONFIG.maxOverlapRatio = 0.15       // Allow more overlap
PHOTO_SIZES_CONFIG.sizeMultiplierMax = 0.9  // Slightly smaller photos
```

### Make Wall More Scattered/Chaotic

```javascript
SCATTER_CONFIG.randomOffsetRange = 400      // More random scatter
PHOTO_SIZES_CONFIG.rotations = [-15, -10, -5, 0, 5, 10, 15]  // More tilt
```

### Faster, Smoother Panning

```javascript
CAMERA_CONFIG.panDuration = 120             // 2 minutes per cycle
CAMERA_CONFIG.easing = 'linear'             // Constant speed
```

### Minimize Overlap (Teen Wall Aesthetic)

```javascript
OVERLAP_CONFIG.maxOverlapRatio = 0.08       // Only 8% overlap
OVERLAP_CONFIG.maxAttempts = 40             // More attempts to find space
OVERLAP_CONFIG.initialNudgeDistance = 180   // Larger nudges
```

### Larger Photos, Fewer Items

```javascript
PHOTO_SIZES_CONFIG.baseSizes = {
  square: { small: 200, medium: 300, large: 400 },  // Bigger bases
  // ... update all shapes
}
PHOTO_WALL_CONFIG.coverageMultiplier = 1.0  // Don't add extra photos
```

## Troubleshooting

### Photos overlapping too much
- Decrease `OVERLAP_CONFIG.maxOverlapRatio`
- Increase `OVERLAP_CONFIG.maxAttempts`
- Increase `OVERLAP_CONFIG.initialNudgeDistance`

### Layout generation is slow
- Decrease `OVERLAP_CONFIG.maxAttempts` (20 or less)
- Increase `OVERLAP_CONFIG.maxOverlapRatio` (easier to place)
- Decrease `PHOTO_WALL_CONFIG.coverageMultiplier`

### Photos too uniform/boring
- Increase `PHOTO_SIZES_CONFIG.sizeMultiplierMax - sizeMultiplierMin` gap
- Add more variety to `rotations` array
- Increase `SCATTER_CONFIG.randomOffsetRange`

### Panning is jerky or too fast
- Increase `CAMERA_CONFIG.panDuration`
- Use `ease-in-out` easing
- Reduce the distance traveled in keyframes (smaller x/y changes)

## Advanced: Custom Camera Path

To create a custom camera movement:

1. **Plan the path** - Decide where the camera should go and when
2. **Add keyframes** - Each object needs `at` (0-100%), `x`, `y`, `scale`
3. **Test values** - Negative x/y moves camera right/down (revealing photos on the left/top)

Example - Circular pan with zoom:

```javascript
keyframes: [
  { at: 0,   x: 0,     y: 0,     scale: 1.0  },
  { at: 25,  x: -20,   y: -10,   scale: 1.08 },  // Right-down, zoom in
  { at: 50,  x: -20,   y: -30,   scale: 1.08 },  // Down
  { at: 75,  x: 0,     y: -30,   scale: 1.08 },  // Left
  { at: 100, x: 0,     y: 0,     scale: 1.0  },  // Return
]
```

## File Location

**Configuration:** `frontend/src/utils/photoWallGenerator.js`  
**Used by:** `frontend/src/components/GalleryView.js`

## Support

For questions or issues, check the main project README or review the inline comments in `photoWallGenerator.js`.
