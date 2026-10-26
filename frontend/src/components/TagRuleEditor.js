import React, { useEffect, useState } from 'react';
import { Box, Typography, Button, Chip, ToggleButton, ToggleButtonGroup } from '@mui/material';

/**
 * What a tag (content folder) means in labelmaster's terms, so labelled videos get it by themselves
 * (backend services/tagRules.js). Terms come from GET /api/tags/rules; a new tag starts from a guess
 * made from its name. Saving runs the rule over every labelled video at once.
 */

const GROUPS = [['act', 'Act'], ['detail', 'Detail'], ['position', 'Position'], ['with', 'With'], ['dress', 'Dress']];
const SHARES = [0.05, 0.1, 0.2, 0.3, 0.5];

// names people give folders → the terms they usually mean
const SYNONYMS = {
  riding: ['cowgirl', 'reverse_cowgirl', 'riding_toy'], ridding: ['cowgirl', 'reverse_cowgirl', 'riding_toy'],
  bj: ['blowjob'], hj: ['handjob'], doggystyle: ['doggy'], lesbian: ['FF'], couple: ['MF'], bg: ['MF'],
  toys: ['toy'], dildo: ['riding_toy', 'toy_insertion'], lingerie: ['underwear'], solo: ['solo'], fingering: ['fingering']
};

export function guessTerms(name, terms) {
  const key = String(name).toLowerCase().replace(/[^a-z]/g, '');
  if (SYNONYMS[key]) return SYNONYMS[key];
  const all = Object.values(terms).flat();
  const hit = all.find(([v, label]) => [v, label].some(x => x.toLowerCase().replace(/[^a-z]/g, '') === key));
  return hit ? [hit[0]] : [];
}

export default function TagRuleEditor({ tag, terms, rule, onDone }) {
  const [picked, setPicked] = useState(() => rule?.terms || guessTerms(tag, terms));
  const [minShare, setMinShare] = useState(rule?.min_share ?? 0.1);
  const [matches, setMatches] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setMatches(null);
    fetch('/api/tags/rules/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ terms: picked, min_share: minShare })
    })
      .then(r => (r.ok ? r.json() : { matches: null }))
      .then(d => { if (!cancelled) setMatches(d.matches); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [picked, minShare]);

  const toggle = (v) => setPicked(p => (p.includes(v) ? p.filter(x => x !== v) : [...p, v]));

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/tags/rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag, terms: picked, min_share: minShare })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save the rule');
      onDone(`${tag}: rule saved, ${data.tagged} video${data.tagged === 1 ? '' : 's'} tagged`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    await fetch('/api/tags/rules', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag }) });
    onDone(`${tag}: rule removed (the tags it set stay)`);
  };

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 2, mt: 1, bgcolor: 'var(--raised)' }}>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Set “{tag}” from the scenes</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Videos labelled by labelmaster get this tag when these cover enough of the video. Pick nothing to only tag by hand.
      </Typography>
      {GROUPS.map(([g, label]) => (
        <Box key={g} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', mb: 0.75 }}>
          <Typography variant="caption" color="text.secondary" sx={{ width: 58 }}>{label}</Typography>
          {(terms[g] || []).map(([v, name]) => (
            <Chip key={v} size="small" label={name} onClick={() => toggle(v)} color={picked.includes(v) ? 'primary' : 'default'}
              variant={picked.includes(v) ? 'filled' : 'outlined'} />
          ))}
        </Box>
      ))}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: 1.5 }}>
        <Typography variant="caption" color="text.secondary">At least</Typography>
        <ToggleButtonGroup size="small" exclusive value={minShare} onChange={(e, v) => v != null && setMinShare(v)}>
          {SHARES.map(s => <ToggleButton key={s} value={s} sx={{ py: 0.25 }}>{Math.round(s * 100)}%</ToggleButton>)}
        </ToggleButtonGroup>
        <Typography variant="caption" color="text.secondary">of the video</Typography>
        <Box sx={{ flex: 1 }} />
        <Typography variant="body2">
          {picked.length === 0 ? 'Tag by hand only' : matches == null ? '…' : `${matches} labelled video${matches === 1 ? '' : 's'} match`}
        </Typography>
      </Box>
      {error && <Typography color="error" variant="body2" sx={{ mt: 1 }}>{error}</Typography>}
      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', mt: 1.5 }}>
        {rule && <Button size="small" color="error" onClick={remove} disabled={busy}>Remove rule</Button>}
        <Button size="small" onClick={() => onDone('')} disabled={busy}>{rule ? 'Cancel' : 'Skip'}</Button>
        <Button size="small" variant="contained" onClick={save} disabled={busy || picked.length === 0}>
          {busy ? 'Tagging…' : 'Save and tag videos'}
        </Button>
      </Box>
    </Box>
  );
}
