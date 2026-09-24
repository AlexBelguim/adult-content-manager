/**
 * Shared player building blocks (docs/redesign/SPEC.md).
 *
 * MediaStage props
 *   item            MediaItem { path, name, type, url, thumbnail, duration?, … }
 *   scenes          array from useScenes() — drawn as segments on the seek bar
 *   videoRef        ref object / callback; receives the <video> (null for pictures)
 *   apiRef          ref object; filled with { togglePlay, toggleMute, toggleFullscreen,
 *                   seekBy(sec), seekTo(sec), root } — pass it to usePlayerKeys
 *   autoPlay        start playing when a new item mounts
 *   muted           initial / externally forced mute state
 *   loop, onLoopChange(next)      controlled loop; the button is disabled without onLoopChange
 *   onEnded(event)  video ended (never fires while looping)
 *   onMediaInfo({ path, width, height, duration? })   real dimensions once known
 *   overlay         node rendered over the media (nav buttons, swipe stamps, toasts)
 *   actionBar       node under the control row, inside the fullscreen root
 *   barStart        node at the left of the control row
 *   counterText     e.g. "3 / 40"
 *   stageProps      props spread on the media area (pointer / touch handlers, className, style).
 *                   Use onClickCapture + stopPropagation to swallow the play/pause click after a drag.
 *   className       extra class on the root (give the root a height!)
 */
export { default as MediaStage } from './MediaStage';
export { default as RatingPanel } from './RatingPanel';
export { default as TagPanel } from './TagPanel';
export { default as FunscriptPanel } from './FunscriptPanel';
export { default as ScenesPanel, openSceneManager } from './ScenesPanel';
export { default as FileInfoPanel } from './FileInfoPanel';
export { default as useScenes } from './useScenes';
export { default as useFunscripts } from './useFunscripts';
export { default as usePlayerKeys } from './usePlayerKeys';
export * from './playerUtils';
