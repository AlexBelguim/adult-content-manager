import React, { useState, useEffect } from 'react';
import { Box, Typography, Chip } from '@mui/material';
import { Panel } from '../layout';
import { MODEL_NOTES, NOTE_TONE } from './modelInfo';

// One card per model: best result on unseen data, what it learned from, how it works, what could improve it
export default function ModelNotes() {
  // P and P2 report their own cross-validation to the profile API each time acm-gpu retrains them
  const [profile, setProfile] = useState(null);
  useEffect(() => { fetch('/api/profile/model').then(r => r.json()).then(setProfile).catch(() => {}); }, []);
  const pct = x => `${(x * 100).toFixed(1)}%`;
  const live = profile?.model && [
    `P: page AUC ${profile.model.auc}${profile.model.app_auc != null ? ` · this app's performers AUC ${profile.model.app_auc}` : ''} · ${profile.judged.toLocaleString()} verdicts (${profile.made})`,
    profile.p2 && `P2: ${profile.p2.held_out != null ? `${pct(profile.p2.held_out)} of held-out duels right · ` : ''}${profile.p2.duels} duels, ${profile.p2.list_pairs} list pairs (${profile.p2.made})`,
  ].filter(Boolean).join(' — ');
  const block = (label, text) => (
    <Box sx={{ mb: 1.25 }}>
      <Typography variant="caption" sx={{ color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 620, letterSpacing: 0.5 }}>{label}</Typography>
      <Typography variant="body2" sx={{ color: 'var(--dim)', fontSize: '0.8rem', lineHeight: 1.45 }}>{text}</Typography>
    </Box>
  );
  return (
    <Box>
      <Typography variant="caption" sx={{ color: 'var(--muted)', display: 'block', mb: 1.5, lineHeight: 1.5 }}>
        Tested 2026-10-16 on pictures none of the models trained on: keep vs delete for the 2,623 pictures of 38 performers added
        after the May training set, and Rank images pairs made after each model was trained. AUC: 0.5 is chance, 1.0 is perfect.
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 1.5 }}>
        {MODEL_NOTES.map(n => {
          const tone = NOTE_TONE[n.tone];
          return (
            <Panel key={n.name}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1, flexWrap: 'wrap' }}>
                <Typography variant="subtitle2" sx={{ color: 'var(--text)', fontWeight: 620, flex: 1, minWidth: 160 }}>{n.name}</Typography>
                <Chip label={n.status} size="small" sx={{ height: 20, fontSize: '0.65rem', fontWeight: 800, bgcolor: tone.bg, color: tone.color }} />
                <Chip label={n.where} size="small" sx={{ height: 20, fontSize: '0.65rem', bgcolor: 'var(--raised)', color: 'var(--dim)' }} />
              </Box>
              {block('Best result', (n.live === 'profile' && live) || n.result)}
              {block('Training data', n.data)}
              {block('How it works', n.how)}
              <Typography variant="caption" sx={{ color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 620, letterSpacing: 0.5 }}>What can be better</Typography>
              <Box component="ul" sx={{ m: 0, pl: 2.25, color: 'var(--dim)', fontSize: '0.8rem', lineHeight: 1.45 }}>
                {n.better.map(b => <li key={b}>{b}</li>)}
              </Box>
            </Panel>
          );
        })}
      </Box>
    </Box>
  );
}
