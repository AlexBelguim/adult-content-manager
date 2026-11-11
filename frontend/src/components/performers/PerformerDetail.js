/**
 * One performer's detail (the old page's detail, restyled), in one of two layouts (performers.css, pm-detail*, pm-panel*):
 *   layout="panel"   the right-hand side panel: a header (picture, name, location, counts and her main actions: open in
 *                    Filter or gallery, rename, rescan, labels and funscripts), then the cards in two columns on PC
 *                    (one under 900px), Tags and Scraped data across both. The page puts it in its drawer and closes it.
 *   left out         inline under an expanded row: a grid of plain cards, 3-4 columns on PC and one on a phone.
 *
 *   <PerformerDetail performer={row} ctx={ctx} actions={actions} layout="panel" intent={{ section, edit }} onOpen={(id) => …} />
 *
 *   performer  her row from usePerformers (always the live one)
 *   ctx        model.js's buildCtx (byId, job, pendingOf, hashBusy, unlabelled, checkingId)
 *   actions    useRowActions: run(key, p), saveLink, removeLink, saveAliases, copyPath
 *   intent     optional { section, edit }: scrolls that card into view when it changes; { section: 'leakhaven',
 *              edit: true } (the row's Set link) also opens the link field. Left out: actions.intentFor(id)
 *   onOpen     optional (id) => …: open her other record (Danger zone's "Open it"; in the panel her header's
 *              "also in After" badge). Left out: actions.expand(id); with neither, the button is not shown
 *   layout     'panel' for the side panel; anything else is the inline grid
 *
 * Cards: Leakhaven, Profile, Aliases, Basic information, Content library, Filtering progress, Hash database, Tags,
 * Scraped performer data, Danger zone. Every button takes its label, disabled reason and busy state from model.js's
 * actionOf, as the row does, and runs through actions.run. In the panel each button is there once: the header holds
 * the open (Filter, gallery or Unblacklist) and her other record's link, so Content library, Filtering progress and
 * Danger zone leave those out. Filtering progress comes from GET /api/filter/stats/:id
 * (original = on disk + what the decisions took out, so it never goes above 100%).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { ButtonBase, TextField } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { plural } from '../ui';
import { Badge, ExternalLink, SmallButton } from '../discover/shared';
import {
  actionOf, ageOf, decodeLink, formatDay, formatDayTime, formatNumber, formatSize, leakhavenState, locationTone, locationWord,
  moveActionKey, otherRecordOf, sideOf, thumbUrl, timeAgo, twinOf
} from './model';
import './performers.css';

// The profile columns a scrape can fill: [column, label, the word for an empty one]
const PROFILE_FIELDS = [
  ['born', 'Born', 'born'], ['birthplace', 'Birthplace', 'birthplace'], ['height', 'Height', 'height'], ['weight', 'Weight', 'weight'],
  ['measurements', 'Measurements', 'measurements'], ['measurements_cup', 'Cup', 'cup'], ['hair_color', 'Hair', 'hair'],
  ['eye_color', 'Eyes', 'eyes'], ['ethnicity', 'Ethnicity', 'ethnicity'], ['body_type', 'Body', 'body'],
  ['orientation', 'Orientation', 'orientation'], ['pubic_hair', 'Pubic hair', 'pubic hair'], ['tattoos', 'Tattoos', 'tattoos'],
  ['piercings', 'Piercings', 'piercings']
];
const SOURCE_NAME = { leakhaven: 'Leakhaven', leakshaven: 'Leakhaven' };
const sourceName = (s) => SOURCE_NAME[s] || s;

const asList = (value) => {
  if (Array.isArray(value)) return value;
  try { const v = JSON.parse(value || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
};
const filled = (v) => v != null && String(v).trim() !== '';
const isBlacklisted = (p) => p.blacklisted === 1 || p.location === 'blacklisted';
const stop = (e) => e.stopPropagation();

// ── small parts ─────────────────────────────────────────────

/** One action as a small button: a link when it has `to` or `href`, else actions.run(key, p). */
function Act({ a, p, actions, label, primary }) {
  if (!a) return null;
  const text = a.busy ? (a.busyLabel || label || a.label) : (label || a.label);
  const off = !!a.disabled || a.busy;
  const how = off ? {} : a.to ? { component: RouterLink, to: a.to }
    : a.href ? { href: a.href, target: '_blank', rel: 'noreferrer' }
      : { onClick: () => actions.run(a.key, p) };
  return (
    <SmallButton tip={a.disabled || undefined} danger={a.danger} primary={primary} disabled={off} {...how}>
      {text}
    </SmallButton>
  );
}

function Card({ p, id, title, count, wide, className, children }) {
  return (
    <section id={`pm-sec-${p.id}-${id}`} className={`pm-detail-card pm-detail-card-${id}${wide ? ' pm-detail-wide' : ''}${className ? ` ${className}` : ''}`}
      aria-label={title}>
      <h3 className="pm-detail-title">{title}{count != null && <span className="pm-detail-count">{count}</span>}</h3>
      {children}
    </section>
  );
}

/** label: value pairs, two columns */
function Facts({ rows, className = '' }) {
  const shown = rows.filter(Boolean);
  if (!shown.length) return null;
  return (
    <dl className={`pm-detail-facts ${className}`}>
      {shown.map(([label, value, tone], i) => (
        <div className="pm-detail-fact" key={i}>
          <dt>{label}</dt>
          <dd className={tone || undefined}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

const Line = ({ tone, children }) => <p className={`pm-detail-line${tone ? ` ${tone}` : ''}`}>{children}</p>;
const Buttons = ({ children }) => <div className="pm-detail-actions">{children}</div>;

/** A filtered-% bar: label, "12 of 94", the bar, the %. Never above 100. */
function Bar({ label, done, total }) {
  const none = !total;
  const v = none ? 0 : Math.max(0, Math.min(100, Math.floor((Math.min(done, total) / total) * 100)));
  return (
    <div className={`pm-detail-bar${!none && v === 100 ? ' full' : ''}${none ? ' none' : ''}`}>
      <span className="pm-detail-bar-label">{label}</span>
      <span className="pm-detail-bar-of">{none ? 'none' : `${formatNumber(Math.min(done, total))} of ${formatNumber(total)}`}</span>
      <span className="pm-detail-bar-track" role="progressbar" aria-label={`${label} filtered`}
        aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${v}%` }} />
      </span>
      <span className="pm-detail-bar-pct">{none ? '' : `${v}%`}</span>
    </div>
  );
}

/** "742" or "742 · 1,030 imported" */
const withOriginal = (n, orig) => (orig > n ? `${formatNumber(n)} · ${formatNumber(orig)} imported` : formatNumber(n));

// ── cards ───────────────────────────────────────────────────

function LeakhavenCard({ p, ctx, actions, editRequest }) {
  const upd = p.leakshavenUpdate || {};
  const state = leakhavenState(p);
  const [editing, setEditing] = useState(false);
  const [typed, setTyped] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);
  const seenRequest = useRef(0);

  useEffect(() => {
    if (!editRequest || editRequest === seenRequest.current) return;
    seenRequest.current = editRequest;
    setEditing(true);
    setError(null);
    const t = setTimeout(() => inputRef.current?.focus(), 250);
    return () => clearTimeout(t);
  }, [editRequest]);

  const save = async () => {
    const link = typed.trim();
    if (!link || saving) return;
    setSaving(true);
    setError(null);
    const err = await actions.saveLink(p, link);
    setSaving(false);
    if (err) { setError(err); return; }
    setEditing(false);
    setTyped('');
  };
  const cancel = () => { setEditing(false); setTyped(''); setError(null); };

  if (!upd.url || editing) {
    return (
      <Card p={p} id="leakhaven" title="Leakhaven">
        <Line>{upd.url ? 'Paste the new link or model name.' : 'No Leakhaven page linked. Paste her link or model name, or use Scrape.'}</Line>
        <TextField size="small" fullWidth value={typed} inputRef={inputRef} disabled={saving}
          placeholder="leakshaven.com/model/… or her model name"
          inputProps={{ 'aria-label': 'Leakhaven link or model name' }}
          error={!!error}
          onChange={(e) => { setTyped(e.target.value); setError(null); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); save(); }
            if (e.key === 'Escape' && upd.url) { e.stopPropagation(); cancel(); }
          }}
          sx={{ mt: 1 }} />
        {error && <p role="alert" className="pm-detail-line bad">{error}</p>}
        <Buttons>
          <SmallButton primary disabled={saving || !typed.trim()} onClick={save}>{saving ? 'Saving…' : 'Save link'}</SmallButton>
          {upd.url && <SmallButton disabled={saving} onClick={cancel}>Cancel</SmallButton>}
        </Buttons>
      </Card>
    );
  }

  const isNew = state === 'new';
  const newest = upd.newestUpload
    ? `${formatDay(upd.newestUpload)} · ${timeAgo(upd.newestUpload)}${isNew ? ' · new' : ''}`
    : upd.lastCheckDate ? 'none listed' : 'not checked yet';
  return (
    <Card p={p} id="leakhaven" title="Leakhaven">
      <ExternalLink href={upd.url} className="pm-detail-link">{decodeLink(upd.url)}</ExternalLink>
      <Facts rows={[
        ['Newest upload', newest, isNew ? 'bad strong' : null],
        ['Last checked', upd.lastCheckDate ? formatDayTime(upd.lastCheckDate) : 'never'],
        upd.error && ['Last check', upd.error, 'warn']
      ]} />
      <Buttons>
        {isNew && <Act a={actionOf(p, ctx, 'mark-seen')} p={p} actions={actions} primary />}
        <Act a={actionOf(p, ctx, 'check-now')} p={p} actions={actions} />
        <SmallButton onClick={() => { setEditing(true); setTyped(''); setError(null); }}>Change link</SmallButton>
        <SmallButton danger onClick={() => actions.removeLink(p)}>Remove link</SmallButton>
      </Buttons>
    </Card>
  );
}

function ProfileCard({ p, ctx, actions }) {
  const empty = PROFILE_FIELDS.filter(([k]) => !filled(p[k])).map(([, , word]) => word);
  const at = p.scraped_at || p.scrapedAt;
  const source = p.scraped_source ? ` from ${sourceName(p.scraped_source)}` : '';
  const scraped = at ? `${formatDay(at)}${source}` : p.hasScrapedData ? `yes${source}, date unknown` : 'not yet';
  return (
    <Card p={p} id="profile" title="Profile">
      <Facts rows={[
        ['Scraped', scraped, p.hasScrapedData || at ? null : 'muted'],
        ['Fields filled', `${PROFILE_FIELDS.length - empty.length} of ${PROFILE_FIELDS.length}`],
        empty.length > 0 && empty.length < PROFILE_FIELDS.length && ['Empty', empty.join(', '), 'muted'],
        p.performer_rating != null && p.performer_rating !== '' && ['Rating', String(Math.round(Number(p.performer_rating) * 10) / 10)]
      ]} />
      <Buttons><Act a={actionOf(p, ctx, 'scrape')} p={p} actions={actions} primary /></Buttons>
    </Card>
  );
}

function AliasesCard({ p, ctx, actions }) {
  const [typed, setTyped] = useState('');
  const [saving, setSaving] = useState(false);

  // the store's row, not the one this render got: two quick saves in a row each see the last one
  const current = () => {
    const row = ctx.byId?.get(p.id) || p;
    return Array.isArray(row.aliases) ? row.aliases : [];
  };
  const save = async (next) => {
    if (saving) return false;
    setSaving(true);
    const ok = await actions.saveAliases(p, next);
    setSaving(false);
    return ok;
  };
  const add = async () => {
    const alias = typed.trim();
    if (!alias || saving) return;
    const list = current();
    if (list.some(a => String(a).toLowerCase() === alias.toLowerCase()) || alias.toLowerCase() === String(p.name).toLowerCase()) { setTyped(''); return; }
    if (await save([...list, alias])) setTyped('');
  };
  const drop = (alias) => save(current().filter(a => a !== alias));

  const aliases = Array.isArray(p.aliases) ? p.aliases : [];
  return (
    <Card p={p} id="aliases" title="Aliases" count={aliases.length || null}>
      {aliases.length > 0
        ? (
          <div className="pm-detail-chips">
            {aliases.map(a => (
              <Badge key={a} tone="info" sx={{ pr: '2px' }}>
                {a}
                <ButtonBase aria-label={`Remove alias ${a}`} title={`Remove ${a}`} disabled={saving} onClick={() => drop(a)}
                  sx={{ width: 18, height: 18, borderRadius: 'var(--radius-sm)', color: 'inherit', '&:hover': { bgcolor: 'var(--raised)' }, '&.Mui-disabled': { opacity: 0.5 } }}>
                  <CloseIcon sx={{ fontSize: 14 }} />
                </ButtonBase>
              </Badge>
            ))}
          </div>
        )
        : <Line tone="muted">No aliases yet</Line>}
      <TextField size="small" fullWidth value={typed} disabled={saving} placeholder={saving ? 'Saving…' : 'Add an alias, Enter to save'}
        inputProps={{ 'aria-label': `Add an alias for ${p.name}` }}
        onChange={(e) => setTyped(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        sx={{ mt: 1 }} />
    </Card>
  );
}

function BasicCard({ p, actions, panel }) {
  const shared = Array.isArray(p.folderSharedWith) ? p.folderSharedWith : [];
  const where = p.actualPath || p.expectedPath;
  const pathValue = p.actualPath
    ? <span className="pm-detail-path">{p.actualPath}</span>
    : p.expectedPath
      ? <span><span className="pm-detail-path">{p.expectedPath}</span><span className="bad"> · not found</span></span>
      : 'no folder known';
  return (
    <Card p={p} id="basic" title="Basic information">
      <Facts rows={[
        ['ID', String(p.id)],
        ['Imported', p.import_date ? formatDay(p.import_date) : 'unknown'],
        ['Last scan', p.last_scan_date ? formatDay(p.last_scan_date) : 'never'],
        !panel && ['Size', formatSize(p.total_size_gb)],
        ['Folder', pathValue, p.actualPath ? null : 'muted']
      ]} />
      {shared.length > 0 && (
        <Line tone="warn">{`Another record (${shared.map(x => `#${x}`).join(', ')}) uses the same folder. Merge them before deleting anything.`}</Line>
      )}
      {where && <Buttons><SmallButton onClick={() => actions.copyPath(p)}>Copy path</SmallButton></Buttons>}
    </Card>
  );
}

function LibraryCard({ p, ctx, actions, panel }) {
  const vids = p.vids_count || 0;
  const unlabelled = ctx.unlabelled ? ctx.unlabelled(p) || 0 : 0;
  const after = sideOf(p) === 'after';
  return (
    <Card p={p} id="library" title="Content library">
      <Facts rows={[
        ['Pictures', withOriginal(p.pics_count || 0, p.pics_original_count || 0)],
        ['Videos', withOriginal(vids, p.vids_original_count || 0)],
        ['Funscript videos', withOriginal(p.funscript_vids_count || 0, p.funscript_vids_original_count || 0)],
        ['Funscript files', formatNumber(p.funscript_files_count || 0)],
        vids > 0 && ['Labels', unlabelled ? `${formatNumber(Math.max(0, vids - unlabelled))} of ${formatNumber(vids)} labelled` : `all ${formatNumber(vids)} labelled`, unlabelled ? 'warn' : 'ok']
      ]} />
      {p.isEmpty && <Line tone="warn">This folder has no media files.</Line>}
      <p className="pm-detail-line"><RouterLink to="/settings/space" className="pm-detail-textlink">Re-encode to save room</RouterLink></p>
      {after && !panel && <Buttons><Act a={actionOf(p, ctx, 'gallery')} p={p} actions={actions} label="Open gallery" /></Buttons>}
    </Card>
  );
}

/** GET /api/filter/stats/:id while `on`; again when her counts or decisions change. */
function useFilterStats(p, on) {
  const [state, setState] = useState({ stats: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const sig = `${p.id}|${p.pics_count}|${p.vids_count}|${p.funscript_vids_count}|${p.filterStats?.totalActions}`;
  useEffect(() => {
    if (!on) return undefined;
    let live = true;
    const ctl = new AbortController();
    setState(s => ({ ...s, error: null }));
    fetch(`/api/filter/stats/${encodeURIComponent(p.id)}`, { signal: ctl.signal })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
        return data;
      })
      .then((stats) => { if (live) setState({ stats, error: null }); })
      .catch((err) => { if (live && err.name !== 'AbortError') setState(s => ({ ...s, error: err.message || 'failed' })); });
    return () => { live = false; ctl.abort(); };
  }, [sig, on, attempt]);   // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, retry: () => setAttempt(n => n + 1) };
}

function FilteringCard({ p, ctx, actions, panel }) {
  const before = sideOf(p) === 'before' && !isBlacklisted(p) && !!p.folderExists;
  const { stats, error, retry } = useFilterStats(p, before);
  const fa = p.filterStats || {};
  const decided = fa.totalActions > 0
    ? `${formatNumber(fa.totalActions)} decisions · ${formatNumber(fa.kept || 0)} kept · ${formatNumber(fa.deleted || 0)} deleted`
    : null;

  let body;
  if (!before) {
    body = <Line tone="muted">{sideOf(p) === 'after' ? 'Done: she is in After.' : isBlacklisted(p) ? 'Not filtered: she is blacklisted.' : 'Her folder is missing.'}</Line>;
  } else if (error && !stats) {
    body = (
      <>
        <Line tone="warn">{`Could not load the progress: ${error}`}</Line>
        <Buttons><SmallButton onClick={retry}>Try again</SmallButton></Buttons>
      </>
    );
  } else if (!stats) {
    body = <Line tone="muted">Loading…</Line>;
  } else {
    const n = (k) => Number(stats[k]) || 0;
    body = (
      <div className="pm-detail-bars">
        <Bar label="Pictures" done={n('picsProcessed')} total={n('picsTotal')} />
        <Bar label="Videos" done={n('vidsProcessed')} total={n('vidsTotal')} />
        <Bar label="Funscripts" done={n('funscriptProcessed')} total={n('funscriptTotal')} />
      </div>
    );
  }
  return (
    <Card p={p} id="filtering" title="Filtering progress">
      {body}
      {decided && <Line>{decided}</Line>}
      {before && !panel && <Buttons><Act a={actionOf(p, ctx, 'filter')} p={p} actions={actions} label="Open in Filter" /></Buttons>}
    </Card>
  );
}

function HashCard({ p, ctx, actions }) {
  const job = ctx.job ? ctx.job(p.id) : null;
  const st = p.hashStats || {};
  const twin = twinOf(p, ctx);
  const rows = p.hasHashDB
    ? [
      ['Files', formatNumber(st.fileCount || 0)],
      ['Deleted', `${formatNumber(st.deletedCount || 0)} remembered`],
      ['Built', st.lastUpdated ? formatDay(st.lastUpdated) : 'unknown']
    ]
    : [['Database', job ? 'building' : 'none yet', job ? null : 'muted']];
  if (job) {
    rows.push(['Job', job.status === 'processing'
      ? (job.total > 0 ? `hashing ${formatNumber(job.processed || 0)} of ${formatNumber(job.total)}` : `hashing ${Math.round(job.progress || 0)}%`)
      : 'queued', 'info']);
  }
  if (p.latest_internal_run_id) {
    const open = p.internal_duplicate_count || 0;
    rows.push(['Latest check', (
      <span>
        <span className={open ? 'warn' : undefined}>{`${plural(open, 'duplicate')} open`}</span>
        {' · '}
        <RouterLink to={`/hash-results/${encodeURIComponent(p.latest_internal_run_id)}`} className="pm-detail-textlink">Open results</RouterLink>
      </span>
    )]);
  }
  return (
    <Card p={p} id="hash" title="Hash database">
      <Facts rows={rows} />
      <Buttons>
        <Act a={actionOf(p, ctx, 'hash-build')} p={p} actions={actions} />
        <Act a={actionOf(p, ctx, 'hash-check')} p={p} actions={actions} />
        <Act a={actionOf(p, ctx, 'hash-compare')} p={p} actions={actions} />
        {p.location === 'before' && twin && <Act a={actionOf(p, ctx, 'hash-compare-twin')} p={p} actions={actions} />}
        <Act a={actionOf(p, ctx, 'hash-delete')} p={p} actions={actions} />
      </Buttons>
    </Card>
  );
}

function TagsCard({ p }) {
  const tags = asList(p.scraped_tags).map(String).filter(Boolean);
  return (
    <Card p={p} id="tags" title="Tags" count={tags.length || null} wide>
      {tags.length > 0
        ? <div className="pm-detail-chips">{tags.map((t, i) => <Badge key={`${t}-${i}`}>{t}</Badge>)}</div>
        : <Line tone="muted">No tags. A scrape fills them.</Line>}
    </Card>
  );
}

function ScrapedCard({ p }) {
  const rows = [];
  const age = ageOf(p);
  if (age) {
    const then = p.age && Number(p.age) !== age ? ` (${p.age} when scraped)` : '';
    rows.push(['Age', `${age}${then}`]);
  }
  for (const [k, label] of PROFILE_FIELDS) {
    if (!filled(p[k])) continue;
    rows.push([label, String(p[k])]);
    if (k === 'measurements_cup') {
      if (filled(p.measurements_band_size)) rows.push(['Band size', String(p.measurements_band_size)]);
      if (p.measurements_fake === 1 || p.measurements_fake === true) rows.push(['Breasts', 'fake']);
    }
  }
  if (filled(p.country_flag)) rows.push(['Country', String(p.country_flag)]);
  if (filled(p.leakshaven_alias)) rows.push(['Leakhaven name', String(p.leakshaven_alias)]);
  if (filled(p.scraped_source)) rows.push(['Source', sourceName(p.scraped_source)]);
  if (!rows.length && !p.hasScrapedData) return null;
  return (
    <Card p={p} id="scraped" title="Scraped performer data" wide>
      {rows.length
        ? <Facts rows={rows} className="pm-detail-facts-wide" />
        : <Line tone="muted">The scrape found no profile fields.</Line>}
    </Card>
  );
}

function DangerCard({ p, ctx, actions, onOpen, panel }) {
  const blacklisted = isBlacklisted(p);
  const other = twinOf(p, ctx) || otherRecordOf(p, ctx);
  const otherWhere = other && (other.location === 'before' || other.location === 'after') ? `in ${locationWord(other)}` : `(#${other?.id})`;
  return (
    <Card p={p} id="danger" title="Danger zone">
      {blacklisted && (
        <Facts rows={[
          ['Blacklisted', p.blacklist_date ? formatDay(p.blacklist_date) : 'yes', 'bad'],
          filled(p.blacklist_reason) && ['Reason', String(p.blacklist_reason)]
        ]} />
      )}
      {other && (
        <Line>{`Her other record ${otherWhere} keeps its own folder: nothing here touches it.`}</Line>
      )}
      <Buttons>
        {other && onOpen && !panel && <SmallButton onClick={() => onOpen(other.id)}>Open it</SmallButton>}
        {blacklisted && !panel && <Act a={actionOf(p, ctx, 'unblacklist')} p={p} actions={actions} />}
        <Act a={actionOf(p, ctx, moveActionKey(p))} p={p} actions={actions} />
        <Act a={actionOf(p, ctx, 'merge')} p={p} actions={actions} />
        <Act a={actionOf(p, ctx, 'remove')} p={p} actions={actions} label="Remove or blacklist…" />
      </Buttons>
    </Card>
  );
}

// ── the panel's header ──────────────────────────────────────

function PanelPicture({ p }) {
  const [failed, setFailed] = useState(false);
  const src = failed ? null : thumbUrl(p);
  return (
    <div className="pm-panel-pic" aria-hidden>
      {src
        ? <img src={src} alt="" decoding="async" onError={() => setFailed(true)} />
        : <span>{(p.name || '?').trim().charAt(0).toUpperCase() || '?'}</span>}
    </div>
  );
}

/** Picture, name, where she is (and her other record), her counts, and the actions no card holds. */
function PanelHead({ p, ctx, actions, onOpen }) {
  const blacklisted = isBlacklisted(p);
  const tone = locationTone(p);
  const other = twinOf(p, ctx) || otherRecordOf(p, ctx);
  const otherText = other && (other.location === 'before' || other.location === 'after')
    ? `also in ${locationWord(other)}` : other ? `other record #${other.id}` : null;
  // a blacklisted record is never filtered, but one in After still has her gallery (Content library's button, inline)
  const gallery = sideOf(p) === 'after' ? actionOf(p, ctx, 'gallery', 'Open gallery') : null;
  const open = blacklisted ? actionOf(p, ctx, 'unblacklist') : gallery || actionOf(p, ctx, 'filter', 'Open in Filter');
  const counts = [
    [p.pics_count, 'pic'], [p.vids_count, 'vid']
  ].map(([n, w]) => <span key={w}><b>{formatNumber(n || 0)}</b>{` ${(n || 0) === 1 ? w : `${w}s`}`}</span>);
  if (p.funscript_vids_count > 0) counts.push(<span key="s"><b>{formatNumber(p.funscript_vids_count)}</b> scripted</span>);
  counts.push(<span key="gb">{formatSize(p.total_size_gb)}</span>);
  return (
    <header className="pm-panel-head">
      <PanelPicture key={p.thumbnail || ''} p={p} />
      <div className="pm-panel-who">
        <h2 className="pm-panel-name" title={p.name}>{p.name}</h2>
        <div className="pm-panel-where">
          <span className="pm-panel-pill" style={{ color: tone, borderColor: tone }}>{locationWord(p)}</span>
          {otherText && (onOpen
            ? (
              <ButtonBase className="pm-panel-other" title={`Open her record ${otherText.replace(/^also /, '')}`} onClick={() => onOpen(other.id)}>
                <Badge tone="info">{otherText}</Badge>
              </ButtonBase>
            )
            : <Badge tone="info">{otherText}</Badge>)}
        </div>
        <p className="pm-panel-counts">{counts}</p>
      </div>
      <div className="pm-panel-actions">
        <Act a={open} p={p} actions={actions} primary={!open?.disabled} />
        {blacklisted && <Act a={gallery} p={p} actions={actions} />}
        <Act a={actionOf(p, ctx, 'rename')} p={p} actions={actions} />
        <Act a={actionOf(p, ctx, 'rescan')} p={p} actions={actions} />
        <Act a={actionOf(p, ctx, 'pipeline')} p={p} actions={actions} />
      </div>
    </header>
  );
}

// ── the detail ──────────────────────────────────────────────
export default function PerformerDetail({ performer, ctx, actions, layout, intent: intentProp, onOpen: onOpenProp }) {
  const p = performer;
  const pid = p?.id;
  const panel = layout === 'panel';
  // the page's actions carry both: intentFor(id) (what the detail was opened for) and expand(id) (another record)
  const intent = intentProp !== undefined ? intentProp : (pid != null && actions?.intentFor ? actions.intentFor(pid) : null);
  const onOpen = onOpenProp || (actions?.expand ? (id) => actions.expand(id) : null);
  const [editRequest, setEditRequest] = useState(0);
  const lastIntent = useRef(null);

  // The intent: scroll its card into view (after the row's expand or the panel's slide-in) and open the link field
  useEffect(() => {
    if (pid == null || !intent || lastIntent.current === intent) return undefined;
    lastIntent.current = intent;
    if (intent.section === 'leakhaven' && intent.edit) setEditRequest(n => n + 1);
    if (!intent.section) return undefined;
    let done = false;
    const t = setTimeout(() => {
      done = true;
      document.getElementById(`pm-sec-${pid}-${intent.section}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 250);
    // cut short (StrictMode's second run, a quick collapse): the next run may try again
    return () => { clearTimeout(t); if (!done) lastIntent.current = null; };
  }, [pid, intent]);

  if (!p) return null;
  const leakhaven = <LeakhavenCard key={`lh-${p.id}`} p={p} ctx={ctx} actions={actions} editRequest={editRequest} />;
  const profile = <ProfileCard p={p} ctx={ctx} actions={actions} />;
  const aliases = <AliasesCard key={`al-${p.id}`} p={p} ctx={ctx} actions={actions} />;
  const basic = <BasicCard p={p} actions={actions} panel={panel} />;
  const library = <LibraryCard p={p} ctx={ctx} actions={actions} panel={panel} />;
  const filtering = <FilteringCard p={p} ctx={ctx} actions={actions} panel={panel} />;
  const hash = <HashCard p={p} ctx={ctx} actions={actions} />;
  const danger = <DangerCard p={p} ctx={ctx} actions={actions} onOpen={onOpen} panel={panel} />;
  const tags = <TagsCard p={p} />;
  const scraped = <ScrapedCard p={p} />;

  // clicks in here never reach the row or the page (a click on the row opens her); typing in a field never reaches
  // their keys either, but Escape still reaches the panel, so it closes it
  const keys = (e) => {
    if (!e.target.closest?.('input, textarea')) return;
    if (panel && e.key === 'Escape') return;
    e.stopPropagation();
  };

  if (panel) {
    return (
      <div className="pm-detail pm-detail-panel" data-performer-detail={p.id} onClick={stop} onKeyDown={keys}>
        <PanelHead p={p} ctx={ctx} actions={actions} onOpen={onOpen} />
        <div className="pm-panel-cols">
          <div className="pm-panel-col">{leakhaven}{profile}{aliases}{basic}</div>
          <div className="pm-panel-col">{library}{filtering}{hash}{danger}</div>
        </div>
        <div className="pm-panel-full">{tags}{scraped}</div>
      </div>
    );
  }
  return (
    <div className="pm-detail" data-performer-detail={p.id} onClick={stop} onKeyDown={keys}>
      {leakhaven}{profile}{aliases}{basic}{library}{filtering}{hash}{danger}{tags}{scraped}
    </div>
  );
}
