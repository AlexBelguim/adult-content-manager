# Funscript Player Specifications

## Overview
Develop a global, self-contained player component that replaces standard HTML video tags with Funscript integration. This player will handle video playback, preview generation, and Funscript management. It will be implemented as a custom HTML tag `<funscript-player>` and stored in its own file (e.g., in a `utils/` directory). The script should be importable on any page where the tag is used, making it easy to integrate without additional setup.

For consistency, consider also creating a custom image tag (e.g., `<funscript-image>`) that can be used similarly in pages like `unified-gallery.html`.

## Core Features

### Custom Tag: `<funscript-player>`
- This tag handles both video playback and preview modes.
- It replaces the need for standard `<video>` or `<img>` tags in contexts like `unified-gallery.html` and `filterview.html`.
- The player is self-contained: importing the script on a page enables usage of the tag anywhere.
- Attributes to control behavior:
  - `mode`: Defines the interaction style.
    - `"standalone"`: Displays a full-sized video or image that plays directly without a modal. It is contained within the given space (fully shown, no resizing of images).
    - `"modal"`: Displays a thumbnail preview that stretches to fill the available space. Clicking it opens a modal for full playback or viewing (modal has a non-transparent background and appears to replace the page).
  - `view`: Defines the display style.
    - `"contained"`: For standalone mode; ensures content is fully shown within the allocated space without distortion.
    - `"stretched"`: For modal mode; stretches the thumbnail to fill the available space.
  - `filtermode`: Boolean attribute to toggle filter-specific features.
    - `"true"`: Enables keep/delete buttons for Funscripts (used in filter views).
    - `"false"`: Disables keep/delete buttons (default for normal views).
- Example usages:
  - Standalone: `<funscript-player mode="standalone" view="contained" filtermode="false">`
  - Modal: `<funscript-player mode="modal" view="stretched" filtermode="false">`
  - Filter mode: `<funscript-player mode="standalone" view="contained" filtermode="true">`

### Video Preview Generation
- Previews should always occupy the full available space (do not use resized images; maintain original aspect ratios where possible).
- In `unified-gallery.html`, use this tag instead of an `<img>` that triggers a modal. The tag handles preview display and modal opening (if in modal mode).

### Funscript Integration and Management Button
- A button appears in the top-right corner of any video preview and inside the fullscreen/full-view mode.
- Button appearance:
  - Default icon: A robot icon.
  - State indicators (change icon accordingly):
    - Uploading: Show a loading/spinner icon.
    - Success: Show a checkmark or success icon.
    - Failure: Show an error icon (e.g., exclamation mark).
- Functionality:
  - Allows users to select and upload a Funscript file.
  - If only one Funscript is available, upload it automatically.
  - If multiple Funscripts are available, prompt the user to select one.
- In filter views (`filtermode="true"`):
  - Remove any existing Funscript handling logic.
  - The button always presents a choice dialog (even if only one script is available).
  - For each Funscript, include "Keep" and "Delete" buttons in the selection interface.

## Implementation Notes
- The component must integrate seamlessly with Funscript for synchronized playback.
- Ensure the player handles both videos and images uniformly where applicable.
- Store the implementation in a dedicated file (e.g., `funscript-player.js` in `utils/`).
