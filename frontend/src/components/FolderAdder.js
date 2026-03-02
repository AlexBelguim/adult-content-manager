import React, { useState } from 'react';
import './FolderAdder.css';

function FolderAdder({ onAdd }) {
  const [folderPath, setFolderPath] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const handleAddFolder = () => {
    if (folderPath.trim()) {
      onAdd(folderPath.trim());
      setFolderPath('');
      setIsCreating(false);
    } else {
      // For now, use a simple prompt. In production, you'd use a proper file dialog
      const path = prompt('Enter folder path:');
      if (path) {
        onAdd(path);
      }
    }
  };

  const handleCreateFolder = () => {
    setIsCreating(true);
  };

  if (isCreating) {
    return (
      <div className="folder-adder">
        <div className="folder-adder-card">
          <h2>Add Content Folder</h2>
          <div className="folder-input-group">
            <input
              type="text"
              placeholder="Enter folder path (e.g., C:\content)"
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
              className="folder-input"
              autoFocus
            />
            <div className="folder-buttons">
              <button onClick={handleAddFolder} className="add-btn">
                Add Folder
              </button>
              <button onClick={() => setIsCreating(false)} className="cancel-btn">
                Cancel
              </button>
            </div>
          </div>
          <div className="folder-info">
            <p>The folder will be created with the required structure:</p>
            <ul>
              <li>before filter performer/</li>
              <li>content/</li>
              <li>after filter performer/</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="folder-adder">
      <div className="folder-adder-card">
        <div className="big-plus" onClick={handleCreateFolder}>
          +
        </div>
        <h2>Add Your First Folder</h2>
        <p>Click the + button to add a folder with the required structure</p>
        <div className="folder-actions">
          <button onClick={handleCreateFolder} className="create-btn">
            Create New Folder
          </button>
          <button onClick={handleAddFolder} className="select-btn">
            Select Existing Folder
          </button>
        </div>
      </div>
    </div>
  );
}

export default FolderAdder;