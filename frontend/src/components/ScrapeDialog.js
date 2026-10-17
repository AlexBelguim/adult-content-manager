import React, { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Checkbox,
  IconButton,
  CircularProgress,
  TextField,
  Chip,
  Alert
} from '@mui/material';
import {
  Close as CloseIcon,
  OpenInNew as OpenInNewIcon,
  ArrowUpward as ArrowUpwardIcon,
  ArrowDownward as ArrowDownwardIcon,
  CheckCircle as CheckCircleIcon
} from '@mui/icons-material';
import { iconBtnSx } from './layout';

// Profile columns in the order the comparison shows them. Band size and natural/fake are saved
// with the cup but shown as part of it.
const FIELDS = [
  ['born', 'Born'], ['age', 'Age'], ['birthplace', 'Birthplace'], ['country_flag', 'Country'],
  ['ethnicity', 'Ethnicity'], ['height', 'Height'], ['weight', 'Weight'], ['measurements', 'Measurements'],
  ['measurements_cup', 'Cup'], ['hair_color', 'Hair'], ['eye_color', 'Eyes'], ['body_type', 'Body'],
  ['orientation', 'Orientation'], ['pubic_hair', 'Pubic hair'], ['tattoos', 'Tattoos'], ['piercings', 'Piercings']
];

const STATUS_LABEL = {
  searching: '', none: 'no match', error: 'error', found: 'found', saved: 'saved', stopped: 'stopped'
};
const STATUS_COLOR = {
  none: 'var(--muted)', error: 'var(--warn)', found: 'var(--ok)', saved: 'var(--ok)', stopped: 'var(--muted)'
};

/** Aliases and scraped_tags arrive parsed from performer-management/all and as JSON from the performers routes. */
const asList = (value) => {
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value || '[]'); } catch (e) { return []; }
};

const postJson = (url, body) => fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
}).then(res => res.json());

/**
 * Scrape one performer from every enabled site in turn, Leakhaven first by default. A site that
 * finds nothing hands over to the next; one that finds data waits for Confirm and save or Look
 * further. Site order and on/off are an app setting (scraper_sites), edited under "Sites…".
 */
function ScrapeDialog({ performer, open, onClose, onSaved }) {
  const [sites, setSites] = useState([]);
  const [status, setStatus] = useState({});
  const [notes, setNotes] = useState([]);
  const [phase, setPhase] = useState('idle'); // searching | found | done | stopped
  const [found, setFound] = useState(null); // { site, result }
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [current, setCurrent] = useState(performer);
  const [editingSites, setEditingSites] = useState(false);
  const [link, setLink] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const runRef = useRef(0);

  const enabledSites = sites.filter(s => s.enabled);

  const run = async (siteList, startStatus) => {
    const runId = ++runRef.current;
    setFound(null);
    setSaved(false);
    setPhase('searching');
    for (const site of siteList.filter(s => s.enabled && !startStatus[s.id])) {
      setStatus(prev => ({ ...prev, [site.id]: 'searching' }));
      let data;
      try {
        data = await postJson(`/api/performers/${performer.id}/scrape`, { source: site.id });
      } catch (err) {
        data = { found: false, error: err.message, tried: [] };
      }
      if (runRef.current !== runId) return;
      if (data.found) {
        setStatus(prev => ({ ...prev, [site.id]: 'found' }));
        setFound({ site, result: data.result });
        setPhase('found');
        return;
      }
      setStatus(prev => ({ ...prev, [site.id]: data.error ? 'error' : 'none' }));
      setNotes(prev => [...prev, data.error
        ? `${site.name}: error, ${data.error}`
        : `${site.name}: nothing for ${(data.tried || []).join(', ')}`]);
    }
    setPhase('done');
  };

  useEffect(() => {
    if (!open || !performer) return undefined;
    setCurrent(performer);
    setStatus({});
    setNotes([]);
    setLink('');
    setEditingSites(false);
    fetch('/api/performers/scrapers/list')
      .then(res => res.json())
      .then(data => {
        setSites(data.scrapers || []);
        run(data.scrapers || [], {});
      })
      .catch(err => setNotes([`Could not load the site list: ${err.message}`]));
    return () => { runRef.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, performer?.id]);

  const stopRun = () => {
    runRef.current++;
    setStatus(prev => Object.fromEntries(Object.entries(prev).map(([id, s]) => [id, s === 'searching' ? 'stopped' : s])));
  };

  const handleStop = () => {
    stopRun();
    setPhase('stopped');
  };

  // Sites already tried keep their status, so this picks up with the next untried one
  const handleLookFurther = () => {
    const next = Object.fromEntries(Object.entries(status).filter(([, s]) => s !== 'stopped'));
    setStatus(next);
    run(sites, next);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const data = await postJson(`/api/performers/${performer.id}/scrape/accept`, {
        source: found.site.id,
        result: found.result
      });
      if (!data.success) throw new Error(data.error || 'Unknown error');
      setCurrent(data.performer);
      setSaved(true);
      setStatus(prev => ({ ...prev, [found.site.id]: 'saved' }));
      if (onSaved) onSaved();
    } catch (err) {
      alert('Could not save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleUseLink = async () => {
    if (!link.trim()) return;
    stopRun();
    if (phase === 'searching') setPhase('stopped');
    setLinkBusy(true);
    try {
      const data = await postJson(`/api/performers/${performer.id}/scrape`, { source: 'leakhaven', link: link.trim() });
      if (data.found) {
        setStatus(prev => ({ ...prev, leakhaven: 'found' }));
        setFound({ site: sites.find(s => s.id === 'leakhaven'), result: data.result });
        setSaved(false);
        setPhase('found');
      } else {
        setNotes(prev => [...prev, `Leakhaven: ${data.error || `no model page for "${link.trim()}"`}`]);
      }
    } finally {
      setLinkBusy(false);
    }
  };

  const saveSites = (next) => {
    setSites(next);
    postJson('/api/settings/scraper_sites', {
      value: JSON.stringify(next.map(({ id, enabled }) => ({ id, enabled })))
    }).catch(err => console.error('Error saving scraper sites:', err));
  };

  const moveSite = (index, delta) => {
    const next = [...sites];
    const [site] = next.splice(index, 1);
    next.splice(index + delta, 0, site);
    saveSites(next);
  };

  if (!performer) return null;

  const currentAliases = asList(current?.aliases);
  const known = new Set([current?.name, ...currentAliases].filter(Boolean).map(a => a.toLowerCase()));
  const result = found?.result;
  const newAliases = result ? result.aliases.filter(a => !known.has(a.toLowerCase())) : [];
  const currentTags = asList(current?.scraped_tags);
  const newTags = result ? result.tags.filter(t => !currentTags.includes(t)) : [];
  const leakhavenMissed = ['none', 'error', 'stopped'].includes(status.leakhaven);
  const offCount = sites.length - enabledSites.length;

  const renderSiteList = () => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      {enabledSites.map(site => {
        const s = status[site.id];
        const active = s === 'searching' || (found?.site.id === site.id && phase === 'found');
        return (
          <Box key={site.id} sx={{
            display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.5, borderRadius: 'var(--radius-sm, 4px)',
            bgcolor: active ? 'var(--accent-quiet)' : 'transparent'
          }}>
            <Typography sx={{ fontSize: '0.82rem', color: 'var(--text)', flex: 1, minWidth: 0 }} noWrap>{site.name}</Typography>
            {s === 'searching'
              ? <CircularProgress size={12} />
              : <Typography sx={{ fontSize: '0.7rem', color: STATUS_COLOR[s] || 'var(--muted)' }}>{STATUS_LABEL[s] ?? 'waiting'}</Typography>}
          </Box>
        );
      })}
      <Button size="small" onClick={() => setEditingSites(true)} disabled={phase === 'searching'}
        sx={{ alignSelf: 'flex-start', mt: 0.5, textTransform: 'none', fontSize: '0.75rem' }}>
        Sites…{offCount > 0 ? ` (${offCount} off)` : ''}
      </Button>
    </Box>
  );

  const renderSiteEditor = () => (
    <Box>
      <Typography sx={{ fontSize: '0.75rem', color: 'var(--dim)', mb: 1 }}>
        Order and on/off apply to every performer.
      </Typography>
      <Box className="dp-scroll" sx={{ maxHeight: 340, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {sites.map((site, i) => (
          <Box key={site.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
            <IconButton size="small" sx={iconBtnSx()} disabled={i === 0} onClick={() => moveSite(i, -1)}><ArrowUpwardIcon /></IconButton>
            <IconButton size="small" sx={iconBtnSx()} disabled={i === sites.length - 1} onClick={() => moveSite(i, 1)}><ArrowDownwardIcon /></IconButton>
            <Checkbox size="small" checked={site.enabled} sx={{ p: 0.5 }}
              onChange={(e) => saveSites(sites.map(s => (s.id === site.id ? { ...s, enabled: e.target.checked } : s)))} />
            <Typography noWrap sx={{ fontSize: '0.8rem', color: site.enabled ? 'var(--text)' : 'var(--muted)' }}>{site.name}</Typography>
          </Box>
        ))}
      </Box>
      <Button size="small" variant="outlined" onClick={() => setEditingSites(false)} sx={{ mt: 1 }}>Done</Button>
    </Box>
  );

  const renderComparison = () => {
    const rows = FIELDS.filter(([field]) => result.profile[field] !== undefined);
    const cell = { py: 0.6, px: 1, borderTop: '1px solid var(--line)', fontSize: '0.8rem', verticalAlign: 'top' };
    const changedRow = { bgcolor: 'var(--accent-quiet)' };
    const linkChanged = found.site.id === 'leakhaven' && result.url && result.url !== current?.leakshaven_url;
    return (
      <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {['Field', 'Now', 'Found'].map(h => (
              <Box component="th" key={h} sx={{ textAlign: 'left', px: 1, pb: 0.5, fontSize: '0.7rem', fontWeight: 600, color: 'var(--muted)' }}>{h}</Box>
            ))}
          </tr>
        </thead>
        <tbody>
          {found.site.id === 'leakhaven' && result.url && (
            <Box component="tr" sx={linkChanged ? changedRow : undefined}>
              <Box component="td" sx={{ ...cell, color: 'var(--dim)' }}>Leakhaven link</Box>
              <Box component="td" sx={{ ...cell, color: 'var(--dim)' }}>{current?.leakshaven_url ? decodeURIComponent(current.leakshaven_url.replace(/^https?:\/\//, '')) : 'none'}</Box>
              <Box component="td" sx={{ ...cell, color: linkChanged ? 'var(--text)' : 'var(--muted)', fontWeight: linkChanged ? 600 : 400 }}>
                {linkChanged ? decodeURIComponent(result.url.replace(/^https?:\/\//, '')) : 'same'}
              </Box>
            </Box>
          )}
          {rows.map(([field, label]) => {
            const now = current?.[field];
            const value = result.profile[field];
            const changed = String(now ?? '') !== String(value);
            return (
              <Box component="tr" key={field} sx={changed ? changedRow : undefined}>
                <Box component="td" sx={{ ...cell, color: 'var(--dim)', whiteSpace: 'nowrap' }}>{label}</Box>
                <Box component="td" sx={{ ...cell, color: changed ? 'var(--dim)' : 'var(--muted)' }}>{now ?? '—'}</Box>
                <Box component="td" sx={{ ...cell, color: changed ? 'var(--text)' : 'var(--muted)', fontWeight: changed ? 600 : 400 }}>
                  {changed ? String(value) : 'same'}
                </Box>
              </Box>
            );
          })}
          <Box component="tr" sx={newAliases.length ? changedRow : undefined}>
            <Box component="td" sx={{ ...cell, color: 'var(--dim)' }}>Aliases</Box>
            <Box component="td" sx={{ ...cell, color: 'var(--dim)' }}>{currentAliases.join(', ') || '—'}</Box>
            <Box component="td" sx={cell}>
              {newAliases.length
                ? newAliases.map(a => <Chip key={a} size="small" label={`+ ${a}`} variant="outlined" sx={{ mr: 0.5, mb: 0.5, color: 'var(--accent)', borderColor: 'var(--accent)' }} />)
                : <Typography component="span" sx={{ fontSize: '0.8rem', color: 'var(--muted)' }}>no new aliases</Typography>}
            </Box>
          </Box>
          <Box component="tr" sx={newTags.length ? changedRow : undefined}>
            <Box component="td" sx={{ ...cell, color: 'var(--dim)' }}>Tags</Box>
            <Box component="td" sx={{ ...cell, color: 'var(--dim)' }}>{currentTags.length} tags</Box>
            <Box component="td" sx={{ ...cell, color: newTags.length ? 'var(--text)' : 'var(--muted)', fontWeight: newTags.length ? 600 : 400 }}>
              {newTags.length ? newTags.map(t => `+ ${t}`).join(', ') : 'no new tags'}
            </Box>
          </Box>
        </tbody>
      </Box>
    );
  };

  const searchingSite = enabledSites.find(s => status[s.id] === 'searching');

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth
      PaperProps={{ sx: { bgcolor: 'var(--surface)', border: '1px solid var(--line)' } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, color: 'var(--text)' }}>
        <Box sx={{ minWidth: 0 }}>
          Scrape · {performer.name}
          <Typography sx={{ fontSize: '0.75rem', color: 'var(--dim)' }}>
            Searching as {[...new Set([performer.name, ...asList(performer.aliases)])].join(', ')}
          </Typography>
        </Box>
        <IconButton size="small" sx={iconBtnSx()} onClick={onClose}><CloseIcon /></IconButton>
      </DialogTitle>

      <DialogContent sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '200px 1fr' }, gap: 2 }}>
        <Box>
          <Typography sx={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--muted)', mb: 0.75, letterSpacing: '.03em' }}>
            SITES, IN ORDER
          </Typography>
          {editingSites ? renderSiteEditor() : renderSiteList()}
        </Box>

        <Box sx={{ minWidth: 0 }}>
          {phase === 'searching' && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 1.5 }}>
              <CircularProgress size={16} />
              <Typography sx={{ fontWeight: 600, color: 'var(--text)' }}>
                Searching {searchingSite?.name || ''}…
              </Typography>
            </Box>
          )}

          {phase === 'found' && result && (
            <>
              <Alert severity="success" icon={<CheckCircleIcon fontSize="inherit" />} sx={{ mb: 1.5 }}>
                {saved ? 'Saved from ' : 'Found on '}{found.site.name} as{' '}
                {result.url
                  ? (
                    <a href={result.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                      {result.name || result.searchedFor} <OpenInNewIcon sx={{ fontSize: 13, verticalAlign: '-2px' }} />
                    </a>
                  )
                  : <b>{result.name || result.searchedFor}</b>}
              </Alert>
              {renderComparison()}
              <Typography sx={{ fontSize: '0.72rem', color: 'var(--muted)', mt: 1 }}>
                Only the fields {found.site.name} has are saved. Aliases and tags are added, never removed.
              </Typography>
            </>
          )}

          {(phase === 'done' || phase === 'stopped') && (
            <Typography sx={{ fontWeight: 600, color: 'var(--text)', mb: 1.5 }}>
              {phase === 'stopped' ? 'Stopped.' : 'No more sites to try.'}
            </Typography>
          )}

          {notes.length > 0 && (
            <Box sx={{ mt: phase === 'found' ? 1.5 : 0 }}>
              {notes.map((note, i) => (
                <Typography key={i} sx={{ fontSize: '0.78rem', color: 'var(--dim)' }}>{note}</Typography>
              ))}
            </Box>
          )}

          {leakhavenMissed && phase !== 'found' && (
            <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
              <TextField size="small" fullWidth value={link} onChange={(e) => setLink(e.target.value)}
                placeholder="Know the Leakhaven page? Paste the link or model name"
                onKeyDown={(e) => { if (e.key === 'Enter') handleUseLink(); }}
                sx={{ '& .MuiInputBase-input': { fontSize: '0.8rem' } }} />
              <Button variant="outlined" size="small" onClick={handleUseLink} disabled={!link.trim() || linkBusy}
                startIcon={linkBusy ? <CircularProgress size={14} /> : null}>
                Use
              </Button>
            </Box>
          )}
        </Box>
      </DialogContent>

      <DialogActions>
        {phase === 'searching' && <Button onClick={handleStop} variant="outlined">Stop</Button>}
        {(phase === 'found' || phase === 'stopped') && (
          <Button onClick={handleLookFurther} variant="outlined">{phase === 'stopped' ? 'Continue' : 'Look further'}</Button>
        )}
        {phase !== 'searching' && <Button onClick={onClose} sx={{ color: 'var(--dim)' }}>Close</Button>}
        {phase === 'found' && !saved && (
          <Button onClick={handleSave} variant="contained" disabled={saving}
            startIcon={saving ? <CircularProgress size={14} color="inherit" /> : null}>
            Confirm and save
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

export default ScrapeDialog;
