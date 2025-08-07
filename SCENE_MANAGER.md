# Scene Manager Implementation

The Scene Manager is a comprehensive feature for managing video scenes in the adult content manager application. It allows users to create, edit, delete, and export video scenes with precise timing and tagging capabilities.

## Features Implemented

### 1. Scene Manager Modal Component (`SceneManagerModal.js`)
- **Video Preview**: Full video playback with custom controls
- **Precision Timeline**: Draggable timeline with scene overlays
- **Playback Speed Control**: Adjustable from 0.1x to 2x for precise editing
- **Scene Creation**: Name scenes and set start/end points
- **Scene Editing**: Modify existing scenes in-place
- **Tagging System**: Add tags to scenes for genre visibility
- **Scene Navigation**: Click on scenes to jump to their start time
- **Export Functionality**: Export scenes as physical video files

### 2. FunscriptPlayer Integration
- **Scene Manager Button**: Purple 🎬 button (only on videos when `scenemanager="true"`)
- **Scene Overlays**: Colored bars on video timeline showing scene segments
- **Hover Tooltips**: Scene names and durations on hover
- **Click Navigation**: Click scene overlays to jump to scene start
- **Auto-refresh**: Scenes update automatically when modified

### 3. Backend API (`/api/scenes/*`)
- `GET /api/scenes/video?path=<path>` - Get all scenes for a video
- `POST /api/scenes/save` - Save a new scene
- `PUT /api/scenes/update` - Update an existing scene
- `DELETE /api/scenes/delete/:id` - Delete a scene
- `POST /api/scenes/export` - Export scene as physical video file

### 4. Database Schema
New `video_scenes` table with fields:
- `id` - Primary key
- `video_path` - Path to the source video
- `name` - Scene name
- `start_time` - Start time in seconds
- `end_time` - End time in seconds
- `tags` - JSON string of tags
- `export_path` - Path to exported scene file
- `created_at`, `updated_at`, `exported_at` - Timestamps

## Usage

### Enabling Scene Manager
Add the `scenemanager="true"` attribute to any `funscript-player` element:

```html
<funscript-player 
  src="/path/to/video.mp4" 
  type="video" 
  scenemanager="true"
></funscript-player>
```

### Creating Scenes
1. Click the purple 🎬 Scene Manager button on any video
2. Play the video and navigate to desired start point
3. Click "Use Current" for start time
4. Navigate to end point and click "Use Current" for end time
5. Enter a scene name
6. Add tags (optional)
7. Click "Save Scene"

### Editing Scenes
1. In the scenes list, click the edit (✏️) icon
2. Modify the scene properties
3. Click "Update Scene"

### Exporting Scenes
1. Configure export options (Include Funscript, Create Funscript Folder)
2. Click the export (⬇️) icon on any scene
3. Scene will be saved to `.thumbnails/scenes/` folder
4. If funscript option enabled, also saves to `.thumbnails/scenes/funscript/`

### Scene Navigation
- **Timeline**: Scene segments appear as colored bars on video timeline
- **Hover**: Shows scene name and duration
- **Click**: Jumps to scene start time
- **Colors**: Each scene gets a unique color (cycles through 6 colors)

## File Structure

### Frontend
```
frontend/src/utils/
  SceneManagerModal.js       # Main scene manager React component
  SceneManagerWrapper.js     # Event handling wrapper
  FunscriptPlayer.js         # Updated with scene manager integration

frontend/src/App.js          # Updated to include SceneManagerWrapper
```

### Backend
```
backend/routes/scenes.js     # Scene management API routes
backend/db.js               # Updated database schema
backend/index.js            # Updated to include scenes routes
```

## Export Structure

When scenes are exported, they are organized as follows:

```
/content/genre_name/
  .thumbnails/
    scenes/
      video_name_scene_1_scene_name.mp4
      video_name_scene_2_scene_name.mp4
      funscript/
        video_name_scene_1_scene_name/
          video_name_scene_1_scene_name.mp4
          video_name_scene_1_scene_name.funscript
        video_name_scene_2_scene_name/
          video_name_scene_2_scene_name.mp4
          video_name_scene_2_scene_name.funscript
```

## Technical Details

### FFmpeg Integration
- Uses `ffmpeg-static` for video processing
- Creates precise cuts using `-ss` (start time) and `-t` (duration)
- Uses stream copy (`-c copy`) for fast, lossless extraction
- Handles timing adjustments for funscript synchronization

### Event System
- Custom events for communication between React and Web Components
- `sceneManagerToggle` - Opens/closes scene manager modal
- `scenesUpdated` - Notifies FunscriptPlayer of scene changes
- `sceneManagerClosed` - Handles modal cleanup

### State Management
- Scene manager state managed in React component
- FunscriptPlayer maintains scene overlay state
- Database persistence for scene data
- Local state for UI interactions

## Integration Points

The Scene Manager is integrated into:
- **UnifiedGallery** - All video items have scene manager enabled
- **GenreGalleryPage** - Video previews include scene management
- **PerformerFilterView** - Funscript videos include scene management

## Future Enhancements

Possible improvements:
1. **Batch Export** - Export multiple scenes at once
2. **Scene Templates** - Save common scene patterns
3. **Keyframe Detection** - Auto-suggest scene boundaries
4. **Scene Merging** - Combine adjacent scenes
5. **Advanced Filtering** - Filter scenes by tags or duration
6. **Scene Thumbnails** - Generate preview images for scenes
7. **Funscript Editing** - Visual funscript editor within scenes
8. **Scene Analytics** - Track most popular scenes/tags

## Troubleshooting

### Common Issues
1. **Scene Manager Button Not Visible**: Ensure `scenemanager="true"` and `type="video"`
2. **Export Fails**: Check FFmpeg installation and file permissions
3. **Scenes Not Loading**: Verify database connection and API endpoints
4. **Timeline Not Updating**: Check for `scenesUpdated` event dispatch

### Debug Information
- Check browser console for React component errors
- Check backend logs for API and FFmpeg errors  
- Verify database schema migration completed
- Test API endpoints directly with curl/Postman
