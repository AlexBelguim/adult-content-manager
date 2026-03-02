import React, { useState, useEffect } from 'react';
import { Box, Typography, Button, TextField, IconButton, List, ListItem, ListItemText, ListItemSecondaryAction, Divider, Paper, Card, CardContent } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';

function TagManager({ basePath, onTagCreated, onTagDeleted }) {
  const [tags, setTags] = useState([]);
  const [newTag, setNewTag] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (basePath) fetchTags();
    // eslint-disable-next-line
  }, [basePath]);

  const fetchTags = async () => {
    const res = await fetch(`/api/tags?basePath=${encodeURIComponent(basePath)}`);
    const data = await res.json();
    setTags(data);
  };

  const handleCreateTag = async () => {
    if (!newTag.trim()) return;
    const res = await fetch('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ basePath, tag: newTag.trim() })
    });
    if (res.ok) {
      setNewTag('');
      fetchTags();
      if (onTagCreated) onTagCreated();
    } else {
      const err = await res.json();
      setError(err.error || 'Failed to create tag');
    }
  };

  const handleDeleteTag = async (tag) => {
    const res = await fetch('/api/tags', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ basePath, tag })
    });
    if (res.ok) {
      fetchTags();
      if (onTagDeleted) onTagDeleted();
    } else {
      const err = await res.json();
      setError(err.error || 'Failed to delete tag');
    }
  };

  return (
    <Box sx={{ mb: 4 }}>
      <Typography variant="h6" sx={{ color: '#1976d2', fontWeight: 'bold', mb: 2 }}>
        Tags
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, mb: 2, justifyContent: 'center' }}>
        <TextField
          size="small"
          label="New Tag"
          value={newTag}
          onChange={e => setNewTag(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleCreateTag(); }}
          sx={{ flex: 1, maxWidth: 220 }}
        />
        <Button variant="contained" onClick={handleCreateTag} sx={{ minWidth: 90 }}>Create</Button>
      </Box>
      {error && <Typography color="error" variant="body2" sx={{ mb: 1, textAlign: 'center' }}>{error}</Typography>}
      <Paper variant="outlined" sx={{ maxHeight: 220, overflowY: 'auto', p: 0, bgcolor: '#f8f9fa', borderRadius: 2, border: '1px solid #e0e0e0' }}>
        <List dense>
          {tags.length === 0 && (
            <ListItem>
              <ListItemText primary={<Typography color="text.secondary">No tags yet</Typography>} />
            </ListItem>
          )}
          {tags.map(tag => (
            <React.Fragment key={tag.tag}>
              <ListItem secondaryAction={
                <IconButton edge="end" aria-label="delete" onClick={() => handleDeleteTag(tag.tag)} disabled={!!tag.hasFiles}>
                  <DeleteIcon color={tag.hasFiles ? 'disabled' : 'error'} />
                </IconButton>
              }>
                <ListItemText primary={tag.tag} />
              </ListItem>
              <Divider />
            </React.Fragment>
          ))}
        </List>
      </Paper>
    </Box>
  );
}

export default TagManager;
