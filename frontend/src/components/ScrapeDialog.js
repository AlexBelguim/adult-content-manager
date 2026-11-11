import React, { useState, useEffect, useId, useRef } from 'react';
import {
  Button,
  Box,
  Typography,
  Checkbox,
  Drawer,
  IconButton,
  CircularProgress,
  TextField,
  Tooltip,
  useMediaQuery
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  ArrowUpward as ArrowUpwardIcon,
  ArrowDownward as ArrowDownwardIcon,
  CheckCircle as CheckCircleIcon,
  Close as CloseIcon
} from '@mui/icons-material';
import { iconBtnSx } from './layout';
import { errorText } from './ui';
import { cancelBtnSx, outlinedBtnSx, dialogContainer } from './ui/AppDialog';
import { Badge, ExternalLink, SmallButton } from './discover/shared';

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

const headSx = { fontSize: '0.75rem', fontWeight: 600, color: 'var(--muted)', mb: 0.75 };

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

const hasCloseWatcher = () => typeof window !== 'undefined' && 'CloseWatcher' in window;

const shortLink = (url) => {
  const bare = url.replace(/^https?:\/\//, '');
  try { return decodeURIComponent(bare); } catch (e) { return bare; }
};

/**
 * Scrape one performer from every enabled site in turn, Leakhaven first by default. A site that
 * finds nothing hands over to the next; one that finds data waits for Confirm and save or Look
 * further. Site order and on/off are an app setting (scraper_sites), edited under "Sites…".
 *
 * A right-hand side panel (640px; full screen under 600px with a back arrow). Esc, the backdrop,
 * the X / back arrow and Android Back (CloseWatcher, where the browser has it) close it; while
 * saving nothing does. Like AppDialog it pushes no history entry, so the page's ?performer= entry
 * stays as it is. Closing stops the run.
 */
function ScrapeDialog({ performer, open, onClose, onSaved }) {
  const [sites, setSites] = useState([]);
  const [status, setStatus] = useState({});
  const [notes, setNotes] = useState([]);
  const [phase, setPhase] = useState('idle'); // searching | found | done | stopped
  const [found, setFound] = useState(null); // { site, result }
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [current, setCurrent] = useState(performer);
  const [editingSites, setEditingSites] = useState(false);
  const [link, setLink] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const runRef = useRef(0);
  const titleId = useId();
  const narrow = useMediaQuery('(max-width:599.95px)');
  const watcher = hasCloseWatcher();

  // The caller clears `performer` as it closes the panel: keep the last one so it slides out with its content.
  const lastRef = useRef(performer);
  if (performer) lastRef.current = performer;
  const who = performer || lastRef.current;

  const enabledSites = sites.filter(s => s.enabled);

  const run = async (siteList, startStatus) => {
    const runId = ++runRef.current;
    setFound(null);
    setSaved(false);
    setSaveError(null);
    setPhase('searching');
    for (const site of siteList.filter(s => s.enabled && !startStatus[s.id])) {
      setStatus(prev => ({ ...prev, [site.id]: 'searching' }));
      let data;
      try {
        data = await postJson(`/api/performers/${who.id}/scrape`, { source: site.id });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a run counter, not a node: the cleanup bumps its latest value
    return () => { runRef.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, performer?.id]);

  // Android Back (and Esc) through CloseWatcher, as AppDialog does. A used watcher is gone, so `round` makes a
  // new one when the panel stays open (saving). A request meant for another modal above this one is left alone.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const savingRef = useRef(saving);
  savingRef.current = saving;
  const rootRef = useRef(null);
  const [round, setRound] = useState(0);
  const isOpen = !!open && !!performer;
  useEffect(() => {
    if (!isOpen || !watcher) return undefined;
    let w;
    try {
      w = new window.CloseWatcher();
    } catch {
      return undefined;
    }
    let done = false;
    w.onclose = () => {
      if (done) return;
      done = true;
      const root = rootRef.current;
      const shown = Array.from(document.querySelectorAll('.MuiModal-root:not(.MuiModal-hidden)'));
      const top = shown[shown.length - 1];
      const covered = !!(root && top && top !== root && !root.contains(top));
      if (!savingRef.current && !covered) onCloseRef.current?.();
      setRound(r => r + 1);
    };
    return () => {
      done = true;
      try { w.destroy(); } catch { /* already closed */ }
    };
  }, [isOpen, watcher, round]);

  const handleClose = (event, reason) => {
    if (saving) return;
    if (reason === 'escapeKeyDown' && watcher) return; // the watcher handles Esc
    onClose?.();
  };
  const closeNow = () => { if (!saving) onClose?.(); };

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
    setSaveError(null);
    try {
      const data = await postJson(`/api/performers/${who.id}/scrape/accept`, {
        source: found.site.id,
        result: found.result
      });
      if (!data.success) throw new Error(data.error || 'Unknown error');
      setCurrent(data.performer);
      setSaved(true);
      setStatus(prev => ({ ...prev, [found.site.id]: 'saved' }));
      if (onSaved) onSaved();
    } catch (err) {
      const text = errorText(err, 'Could not save');
      setSaveError(text.startsWith('Could not save') ? text : `Could not save: ${text}`);
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
      const data = await postJson(`/api/performers/${who.id}/scrape`, { source: 'leakhaven', link: link.trim() });
      if (data.found) {
        setStatus(prev => ({ ...prev, leakhaven: 'found' }));
        setFound({ site: sites.find(s => s.id === 'leakhaven'), result: data.result });
        setSaved(false);
        setSaveError(null);
        setPhase('found');
      } else {
        setNotes(prev => [...prev, `Leakhaven: ${data.error || `no model page for "${link.trim()}"`}`]);
      }
    } catch (err) {
      setNotes(prev => [...prev, `Leakhaven: error, ${err.message}`]);
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

  if (!who) return null;

  const currentAliases = asList(current?.aliases);
  const known = new Set([current?.name, ...currentAliases].filter(Boolean).map(a => a.toLowerCase()));
  const result = found?.result;
  const newAliases = result ? (result.aliases || []).filter(a => !known.has(a.toLowerCase())) : [];
  const currentTags = asList(current?.scraped_tags);
  const newTags = result ? (result.tags || []).filter(t => !currentTags.includes(t)) : [];
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
            <Typography sx={{ fontSize: '0.82rem', color: 'var(--text)', flex: 1, minWidth: 0 }} noWrap title={site.name}>{site.name}</Typography>
            {s === 'searching'
              ? <CircularProgress size={12} aria-label="Searching" />
              : <Typography sx={{ fontSize: '0.75rem', color: STATUS_COLOR[s] || 'var(--muted)', whiteSpace: 'nowrap' }}>{STATUS_LABEL[s] ?? 'waiting'}</Typography>}
          </Box>
        );
      })}
      <Box sx={{ mt: 0.75 }}>
        <SmallButton onClick={() => setEditingSites(true)} disabled={phase === 'searching'}
          tip={phase === 'searching' ? 'Stop the search to change the sites' : undefined}>
          Sites…{offCount > 0 ? ` (${offCount} off)` : ''}
        </SmallButton>
      </Box>
    </Box>
  );

  const renderSiteEditor = () => (
    <Box>
      <Typography sx={{ fontSize: '0.75rem', color: 'var(--dim)', mb: 1 }}>
        Order and on/off apply to every performer.
      </Typography>
      <Box className="dp-scroll" sx={{ maxHeight: { xs: 'none', sm: 'calc(100vh - 260px)' }, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {sites.map((site, i) => (
          <Box key={site.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.25, minWidth: 0 }}>
            <IconButton size="small" sx={iconBtnSx()} disabled={i === 0} onClick={() => moveSite(i, -1)} aria-label={`Move ${site.name} up`}><ArrowUpwardIcon /></IconButton>
            <IconButton size="small" sx={iconBtnSx()} disabled={i === sites.length - 1} onClick={() => moveSite(i, 1)} aria-label={`Move ${site.name} down`}><ArrowDownwardIcon /></IconButton>
            <Checkbox size="small" checked={site.enabled} sx={{ p: 0.5 }} inputProps={{ 'aria-label': `Use ${site.name}` }}
              onChange={(e) => saveSites(sites.map(s => (s.id === site.id ? { ...s, enabled: e.target.checked } : s)))} />
            <Typography noWrap title={site.name} sx={{ fontSize: '0.8rem', minWidth: 0, color: site.enabled ? 'var(--text)' : 'var(--muted)' }}>{site.name}</Typography>
          </Box>
        ))}
      </Box>
      <SmallButton onClick={() => setEditingSites(false)} sx={{ mt: 1 }}>Done</SmallButton>
    </Box>
  );

  const renderComparison = () => {
    const rows = FIELDS.filter(([field]) => result.profile?.[field] !== undefined);
    const cell = { py: 0.6, px: 1, borderTop: '1px solid var(--line)', fontSize: '0.8rem', verticalAlign: 'top', overflowWrap: 'anywhere' };
    const changedRow = { bgcolor: 'var(--accent-quiet)' };
    const linkChanged = found.site.id === 'leakhaven' && result.url && result.url !== current?.leakshaven_url;
    return (
      <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: '28%' }} />
          <col style={{ width: '36%' }} />
          <col style={{ width: '36%' }} />
        </colgroup>
        <thead>
          <tr>
            {['Field', 'Now', 'Found'].map(h => (
              <Box component="th" key={h} sx={{ textAlign: 'left', px: 1, pb: 0.5, fontSize: '0.75rem', fontWeight: 600, color: 'var(--muted)' }}>{h}</Box>
            ))}
          </tr>
        </thead>
        <tbody>
          {found.site.id === 'leakhaven' && result.url && (
            <Box component="tr" sx={linkChanged ? changedRow : undefined}>
              <Box component="td" sx={{ ...cell, color: 'var(--dim)' }}>Leakhaven link</Box>
              <Box component="td" sx={{ ...cell, color: 'var(--dim)' }}>{current?.leakshaven_url ? shortLink(current.leakshaven_url) : 'none'}</Box>
              <Box component="td" sx={{ ...cell, color: linkChanged ? 'var(--text)' : 'var(--muted)', fontWeight: linkChanged ? 600 : 400 }}>
                {linkChanged ? shortLink(result.url) : 'same'}
              </Box>
            </Box>
          )}
          {rows.map(([field, label]) => {
            const now = current?.[field];
            const value = result.profile[field];
            const changed = String(now ?? '') !== String(value);
            return (
              <Box component="tr" key={field} sx={changed ? changedRow : undefined}>
                <Box component="td" sx={{ ...cell, color: 'var(--dim)' }}>{label}</Box>
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
                ? (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {newAliases.map(a => <Badge key={a} tone="accent">+ {a}</Badge>)}
                  </Box>
                )
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

  const secondary = [];
  if (phase === 'searching') secondary.push({ label: 'Stop', onClick: handleStop });
  if (phase === 'found' || phase === 'stopped') {
    secondary.push({ label: phase === 'stopped' ? 'Continue' : 'Look further', onClick: handleLookFurther, disabled: saving });
  }
  const primary = phase === 'found' && !saved
    ? { label: 'Confirm and save', onClick: handleSave, busyLabel: 'Saving…' }
    : null;
  const showCancel = phase !== 'searching';

  const titleEl = (
    <Box sx={{ minWidth: 0, flex: 1 }}>
      <Typography id={titleId} component="h2" sx={{
        m: 0, fontSize: '1.125rem', fontWeight: 620, letterSpacing: '-0.01em', lineHeight: 1.35, color: 'var(--text)', overflowWrap: 'anywhere'
      }}>
        Scrape {who.name}
      </Typography>
      <Typography component="div" sx={{ fontSize: '.8125rem', color: 'var(--dim)', mt: '2px', overflowWrap: 'anywhere' }}>
        Searching as {[...new Set([who.name, ...asList(who.aliases)])].join(', ')}
      </Typography>
    </Box>
  );

  const header = narrow ? (
    <Box sx={{
      flex: 'none', display: 'flex', alignItems: 'center', gap: 1, px: 1, pb: 1,
      pt: 'calc(8px + env(safe-area-inset-top, 0px))', borderBottom: '1px solid var(--line)'
    }}>
      <IconButton aria-label="Back" onClick={closeNow} disabled={saving} sx={iconBtnSx()}>
        <ArrowBackIcon />
      </IconButton>
      {titleEl}
    </Box>
  ) : (
    <Box sx={{ flex: 'none', display: 'flex', alignItems: 'flex-start', gap: 1, px: 2, pt: 1.5, pb: 1.25, borderBottom: '1px solid var(--line)' }}>
      {titleEl}
      <Tooltip title="Close (Esc)">
        <span>
          <IconButton aria-label="Close" onClick={closeNow} disabled={saving} sx={{ ...iconBtnSx(), mt: '-1px', mr: -0.5 }}>
            <CloseIcon />
          </IconButton>
        </span>
      </Tooltip>
    </Box>
  );

  const main = (
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
          <Box role="status" sx={{
            display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1.5, px: 1.25, py: 1, fontSize: '.85rem', color: 'var(--text)',
            bgcolor: 'var(--ok-quiet)', border: '1px solid var(--ok)', borderRadius: 'var(--radius, 6px)', overflowWrap: 'anywhere'
          }}>
            <CheckCircleIcon aria-hidden sx={{ fontSize: 18, color: 'var(--ok)', flexShrink: 0, mt: '1px' }} />
            <Box sx={{ minWidth: 0 }}>
              {saved ? 'Saved from ' : 'Found on '}{found.site.name} as{' '}
              {result.url
                ? <ExternalLink href={result.url} sx={{ fontWeight: 600, display: 'inline-flex' }}>{result.name || result.searchedFor}</ExternalLink>
                : <b>{result.name || result.searchedFor}</b>}
            </Box>
          </Box>
          {renderComparison()}
          <Typography sx={{ fontSize: '0.75rem', color: 'var(--muted)', mt: 1 }}>
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
            <Typography key={i} sx={{ fontSize: '0.78rem', color: 'var(--dim)', overflowWrap: 'anywhere' }}>{note}</Typography>
          ))}
        </Box>
      )}

      {leakhavenMissed && phase !== 'found' && (
        <Box sx={{ display: 'flex', gap: 1, mt: 1.5, alignItems: 'center' }}>
          <TextField size="small" fullWidth value={link} onChange={(e) => setLink(e.target.value)}
            placeholder="Know the Leakhaven page? Paste the link or model name"
            inputProps={{ 'aria-label': 'Leakhaven link or model name' }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleUseLink(); }}
            sx={{ '& .MuiInputBase-input': { fontSize: '0.8rem' } }} />
          <SmallButton onClick={handleUseLink} disabled={!link.trim() || linkBusy}
            startIcon={linkBusy ? <CircularProgress size={14} /> : null}>
            Use
          </SmallButton>
        </Box>
      )}
    </Box>
  );

  return (
    <Drawer
      ref={rootRef}
      anchor="right"
      open={isOpen}
      onClose={handleClose}
      ModalProps={{
        container: dialogContainer,
        disableEscapeKeyDown: saving || watcher,
        // Keys pressed in the panel stay in it: the page's shortcuts listen on document. Only propagation stops,
        // so Esc still reaches the Modal and the CloseWatcher.
        onKeyDown: (e) => e.stopPropagation()
      }}
      slotProps={{
        paper: {
          role: 'dialog',
          'aria-labelledby': titleId,
          sx: {
            width: { xs: '100vw', sm: 'min(640px, 100vw)' },
            maxWidth: '100vw',
            height: '100%',
            bgcolor: 'var(--surface)',
            backgroundImage: 'none',
            borderLeft: { xs: 0, sm: '1px solid var(--line-strong)' },
            borderRadius: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }
        }
      }}
    >
      {header}

      <Box sx={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', px: 2, py: 1.5, fontSize: '.875rem', color: 'var(--text)' }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: '168px minmax(0, 1fr)' }, gap: 2 }}>
          {/* On a phone the result comes first and the site list under it */}
          <Box sx={{ order: { xs: 2, sm: 1 }, minWidth: 0 }}>
            <Typography sx={headSx}>Sites, in order</Typography>
            {editingSites ? renderSiteEditor() : renderSiteList()}
          </Box>
          <Box sx={{ order: { xs: 1, sm: 2 }, minWidth: 0 }}>{main}</Box>
        </Box>
      </Box>

      {saveError ? (
        <Box role="alert" sx={{ flex: 'none', color: 'var(--bad)', fontSize: '.8125rem', px: 2, pt: 1, overflowWrap: 'anywhere' }}>
          {saveError}
        </Box>
      ) : null}

      {(showCancel || secondary.length > 0 || primary) && (
        <Box sx={{
          flex: 'none', display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 1, px: 2, pt: 1,
          pb: 'calc(10px + env(safe-area-inset-bottom, 0px))', borderTop: '1px solid var(--line)', bgcolor: 'var(--surface)'
        }}>
          {showCancel && (
            <Button variant="text" onClick={closeNow} disabled={saving} sx={cancelBtnSx}>Close</Button>
          )}
          {secondary.map(b => (
            <Button key={b.label} variant="outlined" onClick={b.onClick} disabled={saving || !!b.disabled} sx={outlinedBtnSx}>
              {b.label}
            </Button>
          ))}
          {primary && (
            <Button variant="contained" color="primary" onClick={primary.onClick} disabled={saving}
              sx={{ textTransform: 'none', fontSize: '.875rem', boxShadow: 'none', whiteSpace: 'nowrap', '&:hover': { boxShadow: 'none' } }}>
              {saving ? primary.busyLabel : primary.label}
            </Button>
          )}
        </Box>
      )}
    </Drawer>
  );
}

export default ScrapeDialog;
