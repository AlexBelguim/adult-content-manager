import React, { useState, useEffect } from 'react';
import { Box, Typography, Button, TextField, IconButton, List, ListItem, ListItemText, ListItemSecondaryAction, Divider, Paper, Card, CardContent } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import TagRuleEditor from './TagRuleEditor';

function TagManager({ basePath, onTagCreated, onTagDeleted }) {
  const [tags, setTags] = useState([]);
  const [newTag, setNewTag] = useState('');
  const [error, setError] = useState('');
  const [rules, setRules] = useState({ rules: [], terms: {} });
  const [editing, setEditing] = useState(null);   // the tag whose rule is open
  const [note, setNote] = useState('');

  useEffect(() => {
    if (basePath) fetchTags();
    // eslint-disable-next-line
  }, [basePath]);

  // every tag, the content folders made outside this box included, so each can get a rule
  const fetchTags = async () => {
    const res = await fetch('/api/tags/all');
    const data = await res.json();
    setTags((data.tags || []).sort((a, b) => a.localeCompare(b)).map(tag => ({ tag })));
  };

  const fetchRules = () => fetch('/api/tags/rules').then(r => (r.ok ? r.json() : null)).then(d => d && setRules(d)).catch(() => {});
  useEffect(() => { fetchRules(); }, []);
  const ruleOf = (tag) => rules.rules.find(r => r.tag === tag);
  const termName = (v) => Object.values(rules.terms).flat().find(([x]) => x === v)?.[1] || v;

  const closeEditor = (message) => {
    setEditing(null);
    setNote(message);
    fetchRules();
  };

  const handleCreateTag = async () => {
    if (!newTag.trim()) return;
    const res = await fetch('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ basePath, tag: newTag.trim() })
    });
    if (res.ok) {
      setEditing(newTag.trim());   // a new folder: ask what it means in labelmaster's terms
      setNote('');
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
      <Typography variant="h6" sx={{ color: 'primary.main', fontWeight: 'bold', mb: 2 }}>
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
      {note && <Typography color="text.secondary" variant="body2" sx={{ mb: 1, textAlign: 'center' }}>{note}</Typography>}
      {editing && (
        <Box sx={{ mb: 2 }}>
          <TagRuleEditor key={editing} tag={editing} terms={rules.terms} rule={ruleOf(editing)} onDone={closeEditor} />
        </Box>
      )}
      <Paper variant="outlined" sx={{ maxHeight: 220, overflowY: 'auto', p: 0, bgcolor: 'var(--raised)', borderRadius: 2, borderColor: 'divider' }}>
        <List dense>
          {tags.length === 0 && (
            <ListItem>
              <ListItemText primary={<Typography color="text.secondary">No tags yet</Typography>} />
            </ListItem>
          )}
          {tags.map(tag => (
            <React.Fragment key={tag.tag}>
              <ListItem secondaryAction={
                <>
                  <Button size="small" onClick={() => { setNote(''); setEditing(tag.tag); }} sx={{ mr: 1 }}>
                    {ruleOf(tag.tag) ? 'Edit rule' : 'Add rule'}
                  </Button>
                  <IconButton edge="end" aria-label="delete" onClick={() => handleDeleteTag(tag.tag)} disabled={!!tag.hasFiles}>
                    <DeleteIcon color={tag.hasFiles ? 'disabled' : 'error'} />
                  </IconButton>
                </>
              }>
                <ListItemText
                  primary={tag.tag}
                  secondary={ruleOf(tag.tag)
                    ? `✦ ${ruleOf(tag.tag).terms.map(termName).join(', ')} · at least ${Math.round(ruleOf(tag.tag).min_share * 100)}%`
                    : null}
                />
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
