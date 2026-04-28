import React, { useState } from 'react';
import { Box, Card, Typography, TextField, Button, List, ListItem, ListItemText, ListItemIcon } from '@mui/material';
import { CreateNewFolder, FolderOpen, AddCircle } from '@mui/icons-material';

function FolderAdder({ onAdd }) {
  const [folderPath, setFolderPath] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const handleAddFolder = () => {
    if (folderPath.trim()) {
      onAdd(folderPath.trim());
      setFolderPath('');
      setIsCreating(false);
    } else {
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
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 'calc(100vh - 64px)' }}>
        <Card sx={{ p: 5, textAlign: 'center', maxWidth: 500, width: '90%' }}>
          <Typography variant="h4" gutterBottom fontWeight="bold">
            Add Content Folder
          </Typography>
          <Box sx={{ my: 4 }}>
            <TextField
              fullWidth
              variant="outlined"
              label="Folder Path"
              placeholder="e.g., C:\content"
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
              autoFocus
              sx={{ mb: 3 }}
            />
            <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
              <Button variant="contained" color="success" onClick={handleAddFolder} size="large">
                Add Folder
              </Button>
              <Button variant="outlined" color="error" onClick={() => setIsCreating(false)} size="large">
                Cancel
              </Button>
            </Box>
          </Box>
          <Box sx={{ mt: 4, p: 3, bgcolor: 'background.default', borderRadius: 2, textAlign: 'left' }}>
            <Typography variant="subtitle1" gutterBottom color="text.secondary">
              The folder will be created with the required structure:
            </Typography>
            <List dense>
              <ListItem><ListItemText primary="before filter performer/" /></ListItem>
              <ListItem><ListItemText primary="content/" /></ListItem>
              <ListItem><ListItemText primary="after filter performer/" /></ListItem>
            </List>
          </Box>
        </Card>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 'calc(100vh - 64px)' }}>
      <Card sx={{ p: 5, textAlign: 'center', maxWidth: 500, width: '90%' }}>
        <Box 
          onClick={handleCreateFolder} 
          sx={{ 
            color: 'primary.main', 
            cursor: 'pointer', 
            mb: 2, 
            transition: 'transform 0.2s', 
            '&:hover': { transform: 'scale(1.1)' } 
          }}
        >
          <AddCircle sx={{ fontSize: 100 }} />
        </Box>
        <Typography variant="h4" gutterBottom fontWeight="bold">
          Add Your First Folder
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
          Click the + button to add a folder with the required structure
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Button 
            variant="contained" 
            color="primary" 
            onClick={handleCreateFolder} 
            startIcon={<CreateNewFolder />}
            size="large"
          >
            Create New Folder
          </Button>
          <Button 
            variant="contained" 
            color="secondary" 
            onClick={handleAddFolder} 
            startIcon={<FolderOpen />}
            size="large"
          >
            Select Existing
          </Button>
        </Box>
      </Card>
    </Box>
  );
}

export default FolderAdder;