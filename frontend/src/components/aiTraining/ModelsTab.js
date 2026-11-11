/**
 * The AI & Training page's Models tab: one card per live model (K, CLIP Siamese, CLIP Taste, P, P2) with what it does,
 * where the app uses it, the file in use and its one figure; the files of each model under its card; and the history
 * of the removed models, collapsed at the bottom.
 *
 * Only K has a choice of file: the filter view's AI toggle loads the saved preferred_clip_keepdelete_model. "Loaded in
 * acm-gpu now" is a status. With acm-gpu off the cards still name K's file from the app's settings, and P's and P2's
 * figures, which the app keeps in its own files.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Radio, Typography } from '@mui/material';
import { Panel, Section, ContentLine, SPACE } from '../layout';
import { useAsk, useNotify, errorText, plural } from '../ui';
import { Badge, SmallButton } from '../discover/shared';
import {
  PREFERRED_K_KEY, TRAINABLE_TYPES, LIVE_TYPES, MODEL_TYPES, LIVE_INFO, HISTORY, HAND_TEST, HAND_TEST_INTRO,
  modelName, metricOf, samplesText, fileDate, fmtDay, fmtWhen,
} from './modelInfo';

const metaSx = { fontSize: '.75rem', color: 'var(--muted)' };
const doesSx = { fontSize: '.85rem', color: 'var(--dim)', lineHeight: 1.45 };
const valueSx = { fontSize: '.8rem', color: 'var(--text)', minWidth: 0, overflowWrap: 'anywhere' };
const radioSx = { p: 0.25, color: 'var(--muted)', '&.Mui-checked': { color: 'var(--accent)' } };
const linkSx = { color: 'var(--accent)', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } };
const factsSx = { display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', columnGap: 1.5, rowGap: 0.5, alignItems: 'baseline' };

const P_TYPES = ['performer_keep', 'performer_rank'];
const P_FILE = { performer_keep: 'performer_keep.pt', performer_rank: 'performer_rank.pt' };
const P_DOES = {
  performer_keep: 'Gives a performer a keep chance, from the mean of her pictures. Runs by itself in acm-gpu; saved again every 25 verdicts.',
  performer_rank: 'Gives each performer a score learned from who wins your duels. Runs by itself in acm-gpu; saved again every 25 duels.',
};
const FILES_CAPTION = {
  clip_keepdelete: 'The filter view\'s AI toggle uses the chosen file.',
  clip_siamese: 'Nothing in the app loads CLIP Siamese, so there is no file to choose.',
  clip_taste: 'Nothing in the app loads CLIP Taste, so there is no file to choose.',
  performer_keep: 'One file, saved again every 25 verdicts.',
  performer_rank: 'One file, saved again every 25 duels.',
};
const HISTORY_TYPES = new Set(HISTORY.flatMap(h => h.types));

const baseName = (f) => String(f || '').split('/').pop();
const isNum = (v) => v != null && v !== '' && typeof v !== 'boolean' && Number.isFinite(Number(v));
// P's and P2's made dates are strings from their own files: shown as a day when they parse, else as they are.
const dayOf = (x) => (x == null || x === '' ? '' : fmtDay(new Date(x)) || String(x));
const time = (m) => fileDate(m)?.getTime() ?? 0;
const typeOf = (m) => m?.type || 'unknown';

async function send(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { res, data: data && typeof data === 'object' ? data : {} };
}

function Facts({ rows }) {
  const list = rows.filter(Boolean);
  if (!list.length) return null;
  return (
    <Box sx={factsSx}>
      {list.map(([label, value]) => (
        <React.Fragment key={label}>
          <Typography component="span" sx={{ ...metaSx, whiteSpace: 'nowrap' }}>{label}</Typography>
          <Box sx={valueSx}>{value}</Box>
        </React.Fragment>
      ))}
    </Box>
  );
}

function UsedIn({ links }) {
  if (!links?.length) return <Box component="span" sx={{ color: 'var(--muted)' }}>Not used in the app yet</Box>;
  return links.map((l, i) => (
    <React.Fragment key={l.label}>
      {i > 0 && <Box component="span" sx={{ color: 'var(--muted)' }}>{' · '}</Box>}
      {l.to
        ? <Box component={RouterLink} to={l.to} sx={linkSx}>{l.label}</Box>
        : <Box component="a" href={l.href} sx={linkSx}>{l.label}</Box>}
    </React.Fragment>
  ));
}

/** The big figure, its meter from chance to perfect, and what was measured. */
function Figure({ fig, empty }) {
  const m = fig?.metric;
  const has = !!m && isNum(fig.value);
  const share = has ? Math.min(1, Math.max(0, (Number(fig.value) - m.chance) / (1 - m.chance))) : 0;
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
        <Typography component="span" sx={{ fontSize: '1.35rem', fontWeight: 660, color: 'var(--text)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
          {has ? m.format(fig.value) : '–'}
        </Typography>
        {m && <Typography component="span" sx={{ fontSize: '.75rem', color: 'var(--dim)' }}>{m.label}</Typography>}
      </Box>
      {has && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
          <Typography component="span" sx={{ ...metaSx, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{m.format(m.chance)} chance</Typography>
          <Box role="presentation" sx={{ flex: 1, height: 4, borderRadius: 2, bgcolor: 'var(--raised)', overflow: 'hidden' }}>
            <Box sx={{ width: `${share * 100}%`, height: '100%', bgcolor: 'var(--accent)' }} />
          </Box>
          <Typography component="span" sx={{ ...metaSx, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{m.format(1)}</Typography>
        </Box>
      )}
      {(has ? fig.text : empty) && (
        <Typography sx={{ ...metaSx, color: 'var(--dim)', mt: 0.5, lineHeight: 1.45 }}>
          {has ? fig.text : empty}
          {has && fig.prev && (
            <> Previous file {m.format(fig.prev.val_acc)} ({m.diff(fig.value, fig.prev.val_acc)}).</>
          )}
        </Typography>
      )}
    </Box>
  );
}

/** One checkpoint: for K a radio (the filter view's file), its date, size and figure, the loaded status and Delete. */
function FileRow({ f, radio, checked, radioDisabled, onChoose, loaded, block, onDelete }) {
  const name = baseName(f.filename);
  const meta = [fmtDay(fileDate(f)), isNum(f.size_mb) ? `${f.size_mb} MB` : null].filter(Boolean).join(' · ');
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, py: 0.75, borderTop: '1px solid var(--line)' }}>
      {radio && (
        <Radio size="small" checked={checked} disabled={radioDisabled} onChange={() => onChoose(f.filename)}
          inputProps={{ 'aria-label': `Use ${name} in the filter view` }} sx={radioSx} />
      )}
      <Box sx={{ flex: '1 1 180px', minWidth: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 1 }}>
        <Typography component="span" title={f.filename} sx={{ fontSize: '.8rem', color: 'var(--text)', overflowWrap: 'anywhere', minWidth: 0 }}>{name}</Typography>
        {meta && <Typography component="span" sx={{ ...metaSx, whiteSpace: 'nowrap' }}>{meta}</Typography>}
      </Box>
      <Typography component="span" sx={{ fontSize: '.8rem', color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
        {metricOf(typeOf(f)).format(f.val_acc)}
      </Typography>
      {loaded && <Badge tone="ok">Loaded now</Badge>}
      <SmallButton danger disabled={!!block} tip={block || undefined} onClick={() => onDelete(f)}>Delete</SmallButton>
    </Box>
  );
}

export default function ModelsTab({ ai, models, queue, onReload, onOpenTrain }) {
  const ask = useAsk();
  const notify = useNotify();
  const [preferred, setPreferred] = useState({ status: 'loading', value: null });
  const [profile, setProfile] = useState(null);
  const [choosing, setChoosing] = useState(null);
  const [open, setOpen] = useState({});            // `${type}:files` | `${type}:how` -> true
  const [historyOpen, setHistoryOpen] = useState(false);

  const status = models?.status || 'loading';
  const online = status === 'online';
  const list = Array.isArray(models?.list) ? models.list : [];
  const jobs = Array.isArray(queue?.jobs) ? queue.jobs : [];
  const loadedFile = ai?.state === 'online' ? ai?.health?.current_model || null : null;

  // K's file and P's figures are the app's own: read again whenever acm-gpu's list was (re)loaded
  const at = models?.at ?? null;
  useEffect(() => {
    let gone = false;
    fetch(`/api/settings/${PREFERRED_K_KEY}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`The server answered ${r.status}`))))
      .then(d => { if (!gone) setPreferred({ status: 'ok', value: d?.value || null }); })
      .catch(() => { if (!gone) setPreferred(p => ({ ...p, status: 'error' })); });
    fetch('/api/profile/model')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!gone) setProfile(d && typeof d === 'object' ? d : null); })
      .catch(() => {});
    return () => { gone = true; };
  }, [at]);

  const filesOf = (type) => list.filter(m => typeOf(m) === type).sort((a, b) => time(b) - time(a));
  const kFiles = filesOf('clip_keepdelete');
  const pref = preferred.value;
  // A saved file acm-gpu no longer lists counts as no choice: the filter view then loads the newest K file
  const prefGone = online && !!pref && !kFiles.some(f => f.filename === pref);
  const kShown = pref && !prefGone ? kFiles.find(f => f.filename === pref) || null : kFiles[0] || null;
  const kInUse = kShown?.filename || (prefGone ? null : pref) || null;

  // The undo in a toast runs after later renders: it reads the props of now, not of when the toast was made.
  const latest = useRef({});
  latest.current = { ai, jobs, kFiles, onReload, pref };
  const busy = useRef(false);

  const choose = async (filename, { undo = false } = {}) => {
    if (busy.current) return;
    busy.current = true;
    const prev = latest.current.pref;
    setChoosing(filename || 'newest');
    try {
      const url = `/api/settings/${PREFERRED_K_KEY}`;
      const { res, data } = filename == null ? await send('DELETE', url) : await send('POST', url, { value: filename });
      if (!res.ok) {
        notify({ message: data.error || 'Could not save the choice', severity: 'error' });
        return;
      }
      setPreferred({ status: 'ok', value: filename || null });
      const now = latest.current;
      const target = filename || now.kFiles[0]?.filename || null;
      const running = now.jobs.some(j => j.status === 'running');
      const action = undo ? undefined : { label: 'Undo', onClick: () => choose(prev, { undo: true }) };
      const undoText = filename == null ? 'Back to the newest K file' : `Back to ${baseName(filename)}`;
      if (now.ai?.state === 'online' && !running && target) {
        const load = await send('POST', '/api/training/ai-load-model', { model_id: target });
        if (!load.res.ok || load.data.success === false) {
          const why = load.data.message || load.data.error || `the server answered ${load.res.status}`;
          notify({ message: `Saved. acm-gpu could not load it now: ${why}. It is used the next time acm-gpu loads K.`, severity: 'warning' });
          return;
        }
        notify({ message: undo ? undoText : `The filter view now uses ${baseName(filename)}`, action });
        now.onReload?.();
        return;
      }
      notify({ message: undo ? undoText : `Saved: the filter view uses ${baseName(filename)} from the next time acm-gpu loads K`, action });
    } catch (err) {
      notify({ message: errorText(err, 'Could not save the choice'), severity: 'error' });
    } finally {
      busy.current = false;
      setChoosing(null);
    }
  };

  const deleteBlock = (f) => {
    if (ai?.state !== 'online' || !online) return 'acm-gpu is not answering';
    if (typeOf(f) === 'clip_keepdelete' && f.filename === kInUse) return 'The filter view uses this file: choose another first';
    if (loadedFile && f.filename === loadedFile) return 'Loaded in acm-gpu now';
    if (P_TYPES.includes(typeOf(f))) return 'Saved again all the time: it cannot be deleted';
    return null;
  };

  // A failed delete shows in the question, which stays open
  const remove = async (f) => {
    const type = typeOf(f);
    const m = metricOf(type);
    const name = baseName(f.filename);
    const done = await ask({
      title: `Delete ${name}?`,
      rows: [
        ['Model', modelName(type)],
        ['Size', isNum(f.size_mb) ? `${f.size_mb} MB` : '–'],
        ['Saved', fmtWhen(fileDate(f)) || '–'],
        ['Figure', isNum(f.val_acc) ? `${m.format(f.val_acc)} ${m.label}` : '–'],
      ],
      text: 'The file is removed from the AI PC. Cannot be undone. The file in use stays.',
      okLabel: 'Delete file',
      danger: true,
      busyLabel: 'Deleting…',
      run: async () => {
        const { res, data } = await send('POST', '/api/training/ai-delete-model', { model_id: f.filename });
        if (!res.ok || data.success === false) throw new Error(data.message || data.error || `The server answered ${res.status}`);
      },
    });
    if (done) {
      notify(`Deleted ${name}`);
      onReload?.();
    }
  };

  const row = (f, withRadio) => (
    <FileRow key={f.filename} f={f} radio={withRadio} checked={withRadio && f.filename === kInUse}
      radioDisabled={!!choosing || !!models?.fromSnapshot || preferred.status === 'loading'} onChoose={choose}
      loaded={!!loadedFile && f.filename === loadedFile} block={deleteBlock(f)} onDelete={remove} />
  );

  const toggle = (key) => setOpen(o => ({ ...o, [key]: !o[key] }));

  const card = (type) => {
    const files = type === 'clip_keepdelete' ? kFiles : filesOf(type);
    const isK = type === 'clip_keepdelete';
    const isP = P_TYPES.includes(type);
    const trainable = TRAINABLE_TYPES.includes(type);
    const info = LIVE_INFO[type] || {};
    const metric = metricOf(type);
    const shown = isK ? kShown : files[0] || null;
    const pModel = profile?.model || null;
    const p2 = profile?.p2 || null;

    // (a) the state
    let badge = null;
    if (isK) {
      if (files.length || (pref && !online)) badge = <Badge tone="ok">In use</Badge>;
      else if (online) badge = <Badge tone="warn">Not trained</Badge>;
    } else if (trainable) {
      if (files.length) badge = <Badge tone="dim">Trained, not used</Badge>;
      else if (online) badge = <Badge tone="warn">Not trained</Badge>;
    } else if (type === 'performer_keep' ? pModel : p2) {
      badge = <Badge tone="ok">In use</Badge>;
    }

    // (d) the file
    let fileText;
    if (shown) {
      fileText = [baseName(shown.filename), fmtDay(fileDate(shown)), samplesText(type, shown.samples)].filter(Boolean).join(' · ');
      if (isK && prefGone) fileText += ` (the saved ${baseName(pref)} is no longer on the AI PC, so the newest is used)`;
    } else if (isK && pref && !prefGone) {
      fileText = `${baseName(pref)} (from the app's settings)`;
    } else if (isP && (type === 'performer_keep' ? profile?.made : p2?.made)) {
      const made = type === 'performer_keep' ? profile.made : p2.made;
      const judged = type === 'performer_keep' && isNum(profile?.judged) ? `${Number(profile.judged).toLocaleString()} verdicts` : null;
      fileText = [P_FILE[type], dayOf(made), judged].filter(Boolean).join(' · ');
    } else if (status === 'loading') {
      fileText = 'Checking acm-gpu…';
    } else if (online) {
      fileText = 'No file yet';
    } else {
      fileText = 'Not known while acm-gpu is not answering';
    }

    // (e) the figure
    let fig = null;
    let empty = '';
    if (trainable) {
      if (shown && isNum(shown.val_acc)) {
        const day = fmtDay(fileDate(shown));
        const idx = files.indexOf(shown);
        fig = {
          value: shown.val_acc, metric,
          text: `${metric.text}${day ? `, trained ${day}` : ''}.`,
          prev: files.slice(idx + 1).find(f => isNum(f.val_acc)) || null,
        };
      } else if (shown && shown.filename === HAND_TEST.file) {
        fig = { value: HAND_TEST.value, metric: { ...metricOf('clip_keepdelete'), label: HAND_TEST.label }, text: `${HAND_TEST.text}.` };
      } else if (shown) {
        empty = 'This file saved no figure.';
      } else if (online) {
        empty = 'No figure yet: it comes after the first run.';
      } else if (status === 'offline') {
        empty = 'The figure shows when acm-gpu answers.';
      }
    } else if (type === 'performer_keep') {
      if (isNum(pModel?.auc)) {
        const day = dayOf(profile?.made);
        const app = isNum(pModel.app_auc) ? ` On this app's performers ${metric.format(pModel.app_auc)}.` : '';
        fig = { value: pModel.auc, metric, text: `${metric.text}${day ? `, trained ${day}` : ''}.${app}` };
      } else {
        empty = 'No figure yet: acm-gpu reports one after it retrains.';
      }
    } else if (isNum(p2?.held_out)) {
      const day = dayOf(p2.made);
      fig = {
        value: p2.held_out, metric,
        text: `${metric.text}${day ? `, trained ${day}` : ''}. ${Number(p2.duels || 0).toLocaleString()} duels, ${Number(p2.list_pairs || 0).toLocaleString()} list pairs.`,
      };
    } else {
      empty = 'No figure yet: acm-gpu reports one after it retrains.';
    }
    if (!fig) fig = { value: null, metric };

    const filesKey = `${type}:files`;
    const howKey = `${type}:how`;
    const does = isP ? P_DOES[type] : MODEL_TYPES.find(t => t.id === type)?.does;

    return (
      <Panel key={type} component="article" aria-label={modelName(type)}
        sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography component="h3" sx={{ fontSize: '.95rem', fontWeight: 620, color: 'var(--text)' }}>{modelName(type)}</Typography>
          <Typography component="span" sx={metaSx}>{type}</Typography>
          {badge && <Box sx={{ ml: 'auto' }}>{badge}</Box>}
        </Box>
        {does && <Typography sx={doesSx}>{does}</Typography>}
        <Facts rows={[
          ['Used in', <UsedIn links={info.usedIn} />],
          [isK || isP ? 'File in use' : 'Newest file', fileText],
        ]} />
        <Figure fig={fig} empty={empty} />

        <Box sx={{ mt: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
          {open[filesKey] && (
            <Box>
              {files.length
                ? files.map(f => row(f, isK))
                : status === 'offline' && <Typography sx={metaSx}>Files show when acm-gpu answers</Typography>}
              <Typography sx={{ ...metaSx, mt: 0.5 }}>{FILES_CAPTION[type]}</Typography>
            </Box>
          )}
          {open[howKey] && (
            <Facts rows={[
              info.trainsOn && ['Trains on', info.trainsOn],
              info.how && ['How', info.how],
              info.better && ['Could be better', info.better],
            ]} />
          )}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.sm }}>
            <SmallButton aria-expanded={!!open[filesKey]} onClick={() => toggle(filesKey)}>{`Files (${files.length})`}</SmallButton>
            <SmallButton aria-expanded={!!open[howKey]} onClick={() => toggle(howKey)}>How it works</SmallButton>
            {trainable && <SmallButton onClick={() => onOpenTrain?.(type)}>Train</SmallButton>}
          </Box>
        </Box>
      </Panel>
    );
  };

  const otherFiles = list.filter(m => !LIVE_TYPES.includes(typeOf(m)) && !HISTORY_TYPES.has(typeOf(m))).sort((a, b) => time(b) - time(a));

  const filesMeta = status === 'loading' ? 'loading the files…'
    : `${plural(list.length, 'file')}${status === 'offline' ? (models?.fromSnapshot ? ' as last reported' : ' known') : ''}`;

  return (
    <Box>
      <ContentLine title="Models" meta={`${plural(LIVE_TYPES.length, 'model')} · ${filesMeta}`} />
      {status === 'offline' && (
        <Panel role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: SPACE.md, py: 1.25 }}>
          <Typography sx={{ flex: '1 1 240px', fontSize: '.85rem', color: 'var(--text)', minWidth: 0 }}>
            {models?.fromSnapshot
              ? `acm-gpu is not answering. Files and figures are the last it reported, ${fmtWhen(models.at)}. K's file in use comes from the app's settings.`
              : 'acm-gpu is not answering. Its model files show once it answers.'}
          </Typography>
          <SmallButton onClick={() => onReload?.()}>Retry</SmallButton>
        </Panel>
      )}

      <Section>
        <Box sx={{
          display: 'grid', gap: SPACE.sm, alignItems: 'stretch',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(auto-fill, minmax(320px, 1fr))' },
        }}>
          {LIVE_TYPES.map(card)}
        </Box>
      </Section>

      <Section title="History and removed models" description={`${HISTORY.length - 2} removed types · 2 labellers of another app`}
        actions={(
          <SmallButton aria-expanded={historyOpen} aria-controls="ai-model-history" onClick={() => setHistoryOpen(o => !o)}>
            {historyOpen ? 'Hide' : 'Show'}
          </SmallButton>
        )}>
        {historyOpen && (
          <Panel id="ai-model-history">
            <Typography sx={{ ...metaSx, lineHeight: 1.45, mb: 1 }}>{HAND_TEST_INTRO}</Typography>
            {HISTORY.map(h => {
              const files = list.filter(m => h.types.includes(typeOf(m))).sort((a, b) => time(b) - time(a));
              const other = h.state.startsWith('Another app');
              return (
                <Box key={h.name} sx={{ py: 1, borderTop: '1px solid var(--line)' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <Typography component="h3" sx={{ fontSize: '.85rem', fontWeight: 620, color: 'var(--text)' }}>{h.name}</Typography>
                    <Badge tone={other ? 'dim' : 'bad'}>{h.state}</Badge>
                  </Box>
                  <Typography sx={{ ...doesSx, fontSize: '.8rem', mt: 0.25 }}>{h.result}</Typography>
                  {files.length
                    ? <Box sx={{ mt: 0.5 }}>{files.map(f => row(f, false))}</Box>
                    : <Typography sx={{ ...metaSx, mt: 0.25 }}>{other ? 'Not on this AI server' : 'No files left'}</Typography>}
                </Box>
              );
            })}
            {otherFiles.length > 0 && (
              <Box sx={{ py: 1, borderTop: '1px solid var(--line)' }}>
                <Typography component="h3" sx={{ fontSize: '.85rem', fontWeight: 620, color: 'var(--text)' }}>Other files</Typography>
                <Box sx={{ mt: 0.5 }}>{otherFiles.map(f => row(f, false))}</Box>
              </Box>
            )}
          </Panel>
        )}
      </Section>
    </Box>
  );
}
