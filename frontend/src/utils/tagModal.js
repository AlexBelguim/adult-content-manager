// tagModal.js - shared tag modal rendering for FunscriptPlayer and FunscriptImage
// Usage: import { openTagModal } from './tagModal';

/**
 * Extracts the genre from a file path like /content/GENRE/...
 * Returns the genre string or null if not found.
 */
export function extractGenreFromPath(filePath) {
  if (!filePath) return null;
  // Match /content/GENRE/ or \\content\\GENRE\\
  const match = filePath.match(/[\\\/]content[\\\/](.*?)[\\\/]/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Opens a tag modal for assigning/removing tags.
 * @param {Object} opts
 * @param {HTMLElement} context - 'this' from the custom element
 * @param {string[]} fileTags - tags currently assigned to the file
 * @param {string[]} allTags - all available tags
 * @param {string} filePath - the file's real path
 * @param {string} tagError - error message
 * @param {Function} assignTagToFile - (tag) => void
 * @param {Function} removeTagFromFile - (tag) => void
 * @param {Function} closeTagModal - () => void
 */
export function openTagModal({
  context,
  fileTags,
  allTags,
  filePath,
  tagError,
  assignTagToFile,
  removeTagFromFile,
  closeTagModal
}) {
  // Remove any existing tag modal
  const existingModal = document.getElementById('funscript-tag-modal');
  if (existingModal) existingModal.remove();

  // Determine genre from file path
  const genre = extractGenreFromPath(filePath);

  // Modal element
  const modal = document.createElement('div');
  modal.id = 'funscript-tag-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(20,20,20,0.95);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 999999;`;

  // Modal content
  const content = document.createElement('div');
  content.style.cssText = `
    background: #fff;
    border-radius: 14px;
    padding: 32px 28px;
    min-width: 340px;
    max-width: 90vw;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 8px 32px rgba(0,0,0,0.8);
    display: flex;
    flex-direction: column;
    align-items: center;
    position: relative;`;

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  closeBtn.className = 'tag-modal-close';
  closeBtn.style.cssText = `
    position: absolute;
    top: 12px;
    right: 12px;
    background: rgba(0,0,0,0.8);
    color: white;
    border: none;
    border-radius: 50%;
    width: 40px;
    height: 40px;
    font-size: 1.5rem;
    cursor: pointer;
    z-index: 10;`;
  closeBtn.onclick = () => {
    closeTagModal();
    // Dispatch event so gallery can refresh
    window.dispatchEvent(new Event('tag-modal-closed'));
  };
  content.appendChild(closeBtn);

  // Title
  const title = document.createElement('div');
  title.textContent = 'Assign Tags';
  title.style.cssText = 'font-size: 1.25rem; font-weight: bold; margin-bottom: 18px; color: #7e57c2; letter-spacing: 0.5px;';
  content.appendChild(title);

  // Add tag (all tags as buttons, filterable by input)
  const addBox = document.createElement('div');
  addBox.style.cssText = 'width: 100%; margin-bottom: 14px;';
  addBox.innerHTML = `<div style="margin-bottom: 8px; font-weight: 500; color: #333;">Add Tag:</div>`;
  const addRow = document.createElement('div');
  addRow.style.cssText = 'display: flex; align-items: center; gap: 8px; width: 100%;';
  const input = document.createElement('input');
  input.className = 'tag-input';
  input.type = 'text';
  input.placeholder = 'Filter tags...';
  input.autocomplete = 'off';
  input.style.cssText = 'width: 100%; padding: 7px 12px; border-radius: 7px; border: 1px solid #bbb; font-size: 1rem;';
  addRow.appendChild(input);
  addBox.appendChild(addRow);

  // Tag button list
  const tagBtnWrap = document.createElement('div');
  tagBtnWrap.className = 'tag-btn-wrap';
  tagBtnWrap.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; width: 100%;';

  let filterVal = '';
  // Helper to reload tags from the element's state and re-render
  const reloadAndRender = () => {
    // Use latest state from the element
    const latestFileTags = context.state?.fileTags || fileTags;
    const latestAllTags = context.state?.allTags || allTags;
    renderTagButtons(latestFileTags, latestAllTags);
  };

  const renderTagButtons = (assigned = fileTags, allTagsArr = allTags) => {
    tagBtnWrap.innerHTML = '';
    const tagsSorted = [
      ...assigned.filter(tag => allTagsArr.includes(tag)),
      ...allTagsArr.filter(tag => !assigned.includes(tag))
    ];
    tagsSorted.forEach(tag => {
      const isGenreTag = genre && tag.toLowerCase() === genre;
      if (filterVal && !tag.toLowerCase().includes(filterVal)) return;
      const isAssigned = assigned.includes(tag);
      const btn = document.createElement('button');
      btn.textContent = tag;
      btn.disabled = isGenreTag;
      btn.style.cssText = `
        background: ${isAssigned ? '#7e57c2' : '#fff'};
        color: ${isAssigned ? '#fff' : (isGenreTag ? '#888' : '#7e57c2')};
        border: 2px solid var(--primary-main, #7e57c2);
        border-radius: 16px;
        padding: 6px 18px;
        font-size: 1rem;
        font-weight: 500;
        cursor: ${isGenreTag ? 'not-allowed' : 'pointer'};
        margin-bottom: 4px;
        transition: background 0.2s, color 0.2s;
        opacity: ${isGenreTag ? 0.6 : 1};
      `;
      btn.onclick = async (e) => {
        e.preventDefault();
        if (isGenreTag) return;
        if (isAssigned) {
          await removeTagFromFile.call(context, tag);
        } else {
          await assignTagToFile.call(context, tag);
        }
        // After action, reload and re-render
        reloadAndRender();
      };
      tagBtnWrap.appendChild(btn);
    });
  };

  input.addEventListener('input', () => {
    filterVal = input.value.trim().toLowerCase();
    reloadAndRender();
  });
  reloadAndRender();

  addBox.appendChild(tagBtnWrap);
  content.appendChild(addBox);

  // Error
  if (tagError) {
    const err = document.createElement('div');
    err.style.cssText = 'color:#d32f2f; margin-bottom:8px;';
    err.textContent = tagError;
    content.appendChild(err);
  }

  modal.appendChild(content);
  document.body.appendChild(modal);
  document.body.style.overflow = 'hidden';

  // Also patch closeTagModal to dispatch event if called elsewhere
  const originalClose = closeTagModal;
  function wrappedCloseTagModal() {
    originalClose();
    window.dispatchEvent(new Event('tag-modal-closed'));
  }
  // If context provides a way to override, do so
  if (context && typeof context.setTagModalCloseHandler === 'function') {
    context.setTagModalCloseHandler(wrappedCloseTagModal);
  }
}
