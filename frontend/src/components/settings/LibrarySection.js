/**
 * Settings > Library: the library folder, what Delete does with the files, the folder check (read-only) and
 * removing the folder from the app.
 *
 *   GET /api/folders/summary                 { folders: [{ id, path, name, performers, before, after, genres, exists }], currentId }
 *   GET /api/settings/save_deleted_for_training
 *   GET /api/truenas/truenas-status?folderId { folder, checked, missing, issues: [{ performerId, performer, kind, path, names, files? }], more, checkedAt }
 *   GET /api/folders/:id/removal             { folder, counts, kept, blockers }
 *   DELETE /api/folders/:id { confirm }      { success, folder, removed, backup }
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Switch } from '@mui/material';
import { Section, LoadingState } from '../layout';
import { useAsk, useNotify, errorText, plural } from '../ui';
import { useShell } from '../../nav';
import { SmallButton, Badge } from '../discover/shared';
import {
  Rows, rowSx, metaSx, monoSx, getJson, sendJson, saveSetting, useSave, SaveNote, SettingRow, SectionError
} from './kit';

const TRAINING_KEY = 'save_deleted_for_training';
const n = (v) => Number(v || 0).toLocaleString();
const basename = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || String(p || '');

function issueText(issue) {
  const names = issue.names || [];
  if (issue.kind === 'case') return `${names[0]} should be ${names[1]}`;
  if (issue.kind === 'both') return `${names.join(' and ')} are two folders`;
  const files = issue.files || [];
  return names.map((name, i) => `${name} (${files[i] ?? '?'})`).join(', ');
}

export default function LibrarySection() {
  const ask = useAsk();
  const notify = useNotify();
  const shell = useShell();

  // ── the library folders ───────────────────────────────────
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState(null);
  const loadSummary = useCallback(async () => {
    setSummaryError(null);
    try {
      setSummary(await getJson('/api/folders/summary'));
    } catch (e) {
      setSummaryError(errorText(e, 'Could not read the library folders'));
    }
  }, []);
  useEffect(() => { loadSummary(); }, [loadSummary]);

  const folders = summary?.folders || [];
  const current = folders.find(f => f.id === summary?.currentId) || null;
  const base = current?.path || shell.basePath || '<library>';
  const sep = base.includes('\\') ? '\\' : '/';

  const addFolder = async () => {
    let data = null;
    const done = await ask({
      title: 'Add a library folder',
      text: 'The folder that holds "before filter performer" and "after filter performer". Missing subfolders are created.',
      input: { label: 'Folder path', placeholder: '/media', validate: v => (v.trim() ? null : 'Enter a path') },
      okLabel: 'Add folder',
      busyLabel: 'Adding…',
      run: async (p) => { data = await sendJson('POST', '/api/folders/add', { path: p }); }
    });
    if (done == null) return;
    notify(data?.message || 'Added the folder');
    shell.reloadFolders();
    loadSummary();
  };

  // ── what Delete does ──────────────────────────────────────
  const [training, setTraining] = useState(null); // null until the server answered
  const [trainingError, setTrainingError] = useState(null);
  const trainingSave = useSave();
  const loadTraining = useCallback(async () => {
    setTrainingError(null);
    try {
      const data = await getJson(`/api/settings/${TRAINING_KEY}`);
      setTraining(data.value === 'true');
    } catch (e) {
      setTrainingError(errorText(e, 'Could not read this setting'));
    }
  }, []);
  useEffect(() => { loadTraining(); }, [loadTraining]);

  const toggleTraining = async (next) => {
    const before = training;
    setTraining(next);
    const ok = await trainingSave.run(() => saveSetting(TRAINING_KEY, String(next)));
    if (!ok) setTraining(before);
  };

  // ── folder check ──────────────────────────────────────────
  const [check, setCheck] = useState(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState(null);
  const runCheck = async () => {
    if (!current) return;
    setChecking(true);
    setCheckError(null);
    try {
      setCheck(await getJson(`/api/truenas/truenas-status?folderId=${encodeURIComponent(current.id)}`));
    } catch (e) {
      setCheckError(errorText(e, 'Could not check the folders'));
    } finally {
      setChecking(false);
    }
  };
  const issues = check?.issues || [];
  const more = Number(check?.more || 0);
  const missing = Number(check?.missing || 0);
  const toLook = issues.length + more;

  // ── remove the folder ─────────────────────────────────────
  const [planning, setPlanning] = useState(false);
  const removeFolder = async () => {
    if (!current) return;
    setPlanning(true);
    let plan;
    try {
      plan = await getJson(`/api/folders/${current.id}/removal`);
    } catch (e) {
      notify({ severity: 'error', message: errorText(e, 'Could not read what the folder holds') });
      return;
    } finally {
      setPlanning(false);
    }
    if (plan.blockers?.length) {
      notify({ severity: 'warning', message: plan.blockers.join(' ') });
      return;
    }
    const c = plan.counts || {};
    const path = plan.folder?.path || current.path;
    let result = null;
    const done = await ask({
      title: 'Remove this library folder?',
      rows: [
        ['Folder', path],
        ['Performers', n(c.performers)],
        ['Filter decisions', n(c.filterActions)],
        ['Scenes', n(c.scenes)],
        ['Exported files', n(c.exportedFiles)],
        ['Tags on files', n(c.fileTags)],
        ['Genres', n(c.genres)]
      ],
      text: 'Files on disk are not touched. App settings, shortcuts, tag rules, worker links and file hashes are kept. A copy of the database is saved first.',
      typeToConfirm: plan.folder.name,
      okLabel: 'Remove folder',
      danger: true,
      busyLabel: 'Removing…',
      run: async () => {
        result = await sendJson('DELETE', `/api/folders/${current.id}`, { confirm: plan.folder.name });
      }
    });
    if (!done) return;
    notify(`Removed ${path} from the app. Database copy: ${basename(result?.backup)}`);
    setCheck(null);
    shell.reloadFolders();
    loadSummary();
  };

  return (
    <>
      <Section title="Library folder" description="The app works in the first folder. Tags and the checks below apply to it.">
        {summaryError && <SectionError error={summaryError} onRetry={loadSummary} />}
        {!summary && !summaryError && <LoadingState />}
        {summary && (
          <Rows>
            {folders.length ? folders.map(f => (
              <Box key={f.id} sx={rowSx}>
                <Box component="span" title={f.path} sx={{ ...monoSx, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }}>
                  {f.path}
                </Box>
                <Box component="span" sx={{ ...metaSx, display: { xs: 'none', sm: 'inline' }, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  {`${plural(f.performers || 0, 'performer')} · ${n(f.after)} after · ${n(f.before)} before`}
                </Box>
                {f.id === summary.currentId && <Badge tone="accent">in use</Badge>}
                {!f.exists && <Badge tone="bad">missing on disk</Badge>}
              </Box>
            )) : (
              <Box sx={rowSx}>
                <Box component="span" sx={{ flex: 1, minWidth: 0, color: 'var(--dim)' }}>No library folder yet</Box>
                <SmallButton primary onClick={addFolder}>Add folder…</SmallButton>
              </Box>
            )}
          </Rows>
        )}
      </Section>

      <Section title="What Delete does">
        <SettingRow
          label="Keep deleted files for training"
          hint={training
            ? `When a trash is emptied, the files go to ${base}${sep}deleted keep for training${sep}<performer>.`
            : 'When a trash is emptied, the files are removed for good.'}
          note={<SaveNote state={trainingSave.state} error={trainingSave.error} />}
        >
          {trainingError ? (
            <SectionError error={trainingError} onRetry={loadTraining} />
          ) : (
            <Switch
              checked={!!training}
              disabled={training == null}
              onChange={(e) => toggleTraining(e.target.checked)}
              inputProps={{ 'aria-label': 'Keep deleted files for training' }}
            />
          )}
        </SettingRow>
      </Section>

      <Section
        title="Folder check"
        description="Looks for pics and vids folders spelled with capitals and for two funscript folders in one vids folder. It only reads: nothing on disk changes."
        actions={(
          <SmallButton onClick={runCheck} disabled={!current || checking}>
            {checking ? 'Checking…' : 'Check now'}
          </SmallButton>
        )}
      >
        {checkError && <SectionError error={checkError} onRetry={runCheck} />}
        {check && (
          <>
            <Box sx={{ ...metaSx, mb: 0.5 }}>
              {`Checked ${n(check.checked)} performer folders at ${new Date(check.checkedAt || Date.now()).toLocaleTimeString()}: ${toLook ? `${plural(toLook, 'thing')} to look at` : 'nothing to fix'}.`}
            </Box>
            {missing > 0 && (
              <Box sx={{ ...metaSx, mb: 1 }}>
                {`${plural(missing, 'performer')} ha${missing === 1 ? 's' : 've'} no folder: `}
                <Box component={RouterLink} to="/performer-management" sx={{ color: 'var(--accent)' }}>Performer Management</Box>
              </Box>
            )}
            {issues.length > 0 && (
              <Rows sx={{ mt: 1 }}>
                {issues.map((issue, i) => (
                  <Box key={`${issue.performerId}-${issue.kind}-${i}`} sx={rowSx}>
                    <Box component="span" title={issue.performer} sx={{
                      fontWeight: 600, color: 'var(--text)', width: { sm: 180 }, flexShrink: 0, maxWidth: { xs: '40%', sm: 180 },
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                    }}>
                      {issue.performer}
                    </Box>
                    <Box component="span" title={issueText(issue)} sx={{ flex: 1, minWidth: 0, color: 'var(--dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {issueText(issue)}
                    </Box>
                    <Box component="span" title={issue.path} sx={{
                      ...monoSx, display: { xs: 'none', sm: 'inline' }, flex: '0 1 40%', minWidth: 0, color: 'var(--muted)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                    }}>
                      {issue.path}
                    </Box>
                  </Box>
                ))}
              </Rows>
            )}
            {more > 0 && <Box sx={{ ...metaSx, mt: 0.5 }}>{`and ${more} more`}</Box>}
            {toLook > 0 && (
              <Box sx={{ ...metaSx, mt: 1 }}>Fix these on the share by hand. The app no longer renames or merges folders itself.</Box>
            )}
          </>
        )}
      </Section>

      {current && (
        <Section title="Remove this folder from the app">
          <Box sx={{ ...metaSx, mb: 1.5, overflowWrap: 'anywhere' }}>
            {`Forgets ${current.path}: its performers, filter decisions, scenes and the tags on its files. Files on disk stay. App settings, shortcuts, tag rules, worker links and file hashes stay. A copy of the database is saved first.`}
          </Box>
          <SmallButton danger onClick={removeFolder} disabled={planning}>
            Remove folder…
          </SmallButton>
        </Section>
      )}
    </>
  );
}
