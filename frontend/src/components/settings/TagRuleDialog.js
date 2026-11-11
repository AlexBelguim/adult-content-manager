/**
 * Settings → Tags: the rule of one tag, in a dialog. A rule says what the tag (a content folder) means in
 * labelmaster's terms, so labelled videos get it by themselves (backend services/tagRules.js). A tag without a rule
 * starts from a guess made from its name. Saving runs the rule over every labelled video at once; narrowing it takes
 * the tag off the videos it no longer matches (only the tags a rule set).
 *
 *   POST   /api/tags/rules/preview { terms, min_share } -> { matches }
 *   PUT    /api/tags/rules { tag, terms, min_share }   -> { success, added, removed, total }
 *   DELETE /api/tags/rules { tag }                     -> { success, kept }
 *
 * Opened by components/settings/TagsSection.js, keyed by the tag so its state starts fresh for each one.
 */
import React, { useEffect, useState } from 'react';
import { Box, Chip, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { AppDialog, errorText, plural } from '../ui';
import { sendJson } from './kit';

export const GROUPS = [['act', 'Act'], ['detail', 'Detail'], ['position', 'Position'], ['with', 'With'], ['dress', 'Dress']];
export const SHARES = [0.05, 0.1, 0.2, 0.3, 0.5];

// names people give folders → the terms they usually mean
export const SYNONYMS = {
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

const labelSx = { fontSize: '.75rem', color: 'var(--muted)', width: 64, flex: 'none' };

export default function TagRuleDialog({ open, tag, terms, rule, onClose }) {
  const allTerms = terms || {};
  const [picked, setPicked] = useState(() => rule?.terms || (tag ? guessTerms(tag, allTerms) : []));
  const [minShare, setMinShare] = useState(rule?.min_share ?? 0.1);
  const [matches, setMatches] = useState(null);   // null: counting; false: could not count
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // the count of matching videos, 300 ms after the last change; a newer change cancels the older count
  useEffect(() => {
    if (!open || !picked.length) { setMatches(null); return undefined; }
    let cancelled = false;
    setMatches(null);
    const t = setTimeout(() => {
      sendJson('POST', '/api/tags/rules/preview', { terms: picked, min_share: minShare })
        .then(d => { if (!cancelled) setMatches(typeof d?.matches === 'number' ? d.matches : false); })
        .catch(() => { if (!cancelled) setMatches(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [open, picked, minShare]);

  const toggle = (v) => setPicked(p => (p.includes(v) ? p.filter(x => x !== v) : [...p, v]));

  const act = async (fn, fallback) => {
    setBusy(true);
    setError(null);
    try {
      const message = await fn();
      setBusy(false);
      onClose(message);
    } catch (e) {
      setError(errorText(e, fallback));
      setBusy(false);
    }
  };

  const save = () => act(async () => {
    const r = await sendJson('PUT', '/api/tags/rules', { tag, terms: picked, min_share: minShare });
    return `${tag}: ${r.added ?? 0} added, ${r.removed ?? 0} removed, ${r.total ?? 0} now tagged by the rule`;
  }, 'Could not save the rule');

  const remove = () => act(async () => {
    const r = await sendJson('DELETE', '/api/tags/rules', { tag });
    return `${tag}: rule removed. The ${plural(r.kept ?? 0, 'tag')} it set stay.`;
  }, 'Could not remove the rule');

  const countLine = picked.length === 0 ? 'Pick a term, or close to keep tagging by hand'
    : matches === null ? 'Counting…'
      : matches === false ? 'Could not count the matching videos'
        : `${plural(matches, 'labelled video')} match`;

  return (
    <AppDialog
      open={!!open}
      onClose={() => onClose()}
      size="md"
      title={`Rule for "${tag}"`}
      subtitle="Labelled videos get this tag when these cover enough of the video."
      busy={busy}
      error={error}
      primary={{ label: 'Save and tag videos', busyLabel: 'Tagging…', disabled: !picked.length, onClick: save }}
      secondary={rule ? [{ label: 'Remove rule', danger: true, onClick: remove }] : undefined}
    >
      {GROUPS.map(([g, label]) => (
        <Box key={g} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', mb: 0.75 }}>
          <Typography sx={labelSx}>{label}</Typography>
          {(allTerms[g] || []).map(([v, name]) => {
            const on = picked.includes(v);
            return (
              <Chip key={v} size="small" label={name} onClick={() => toggle(v)} disabled={busy}
                color={on ? 'primary' : 'default'} variant={on ? 'filled' : 'outlined'} aria-pressed={on} />
            );
          })}
        </Box>
      ))}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', mt: 1.5 }}>
        <Typography sx={labelSx}>At least</Typography>
        <ToggleButtonGroup size="small" exclusive value={minShare} disabled={busy}
          onChange={(e, v) => v != null && setMinShare(v)} aria-label="Share of the video">
          {SHARES.map(s => (
            <ToggleButton key={s} value={s} sx={{ py: 0.25, fontSize: '.8125rem', textTransform: 'none' }}>
              {Math.round(s * 100)}%
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Typography sx={{ fontSize: '.8125rem', color: 'var(--dim)' }}>of the video</Typography>
      </Box>
      <Typography role="status" sx={{ fontSize: '.8125rem', color: 'var(--text)', mt: 1.5 }}>{countLine}</Typography>
    </AppDialog>
  );
}
