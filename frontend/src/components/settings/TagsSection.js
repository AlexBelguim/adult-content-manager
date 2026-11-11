/**
 * Settings → Tags: every tag (a folder in <library>/content), how many files carry it and how many of those a rule
 * tagged, what its folder holds, and its rule. Create, edit a rule (components/settings/TagRuleDialog.js) and delete.
 *
 *   GET    /api/tags/manage           -> { folder: { id, path } | null, tags: [{ tag, files, auto, folder, folderFiles, rule }], terms }
 *   POST   /api/tags { basePath, tag } (400: a bad name)
 *   DELETE /api/tags { basePath, tag } -> { success, files, rule } | 409 { error } while its folder holds files
 *
 * Without basePath the server uses the first library folder, as the app does. Tags are shared by every folder.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, TextField, Typography } from '@mui/material';
import { Section, EmptyState, LoadingState } from '../layout';
import { useAsk, useNotify, errorText, plural } from '../ui';
import { SmallButton } from '../discover/shared';
import { useIsPhone } from '../../nav';
import { metaSx, rowSx, Rows, getJson, sendJson, SectionError } from './kit';
import TagRuleDialog from './TagRuleDialog';

const ellipsis = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 };

const filesText = (t) => `${plural(t.files, 'file')}${t.auto ? ` · ${t.auto} by rule` : ''}${
  t.folder === 'files' ? ` · folder holds ${t.folderFiles}` : t.folder === 'missing' ? ' · no folder' : ''}`;

export default function TagsSection() {
  const isPhone = useIsPhone();
  const ask = useAsk();
  const notify = useNotify();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);   // the tag whose rule dialog is open
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback(() => getJson('/api/tags/manage')
    .then((d) => { if (alive.current) { setData(d); setError(null); } })
    .catch((e) => { if (alive.current) setError(errorText(e, 'Could not load the tags')); }), []);
  useEffect(() => { load(); }, [load]);

  const terms = data?.terms || {};
  const termName = (v) => Object.values(terms).flat().find(([x]) => x === v)?.[1] || v;
  const ruleText = (rule) => `${rule.terms.map(termName).join(', ')} · at least ${Math.round(rule.min_share * 100)}%`;

  if (!data && error) return <SectionError error={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading the tags…" />;
  if (!data.folder) {
    return (
      <EmptyState title="No library folder" description="Tags are folders in the library."
        action={<SmallButton component={RouterLink} to="/settings/library">Library settings</SmallButton>} />
    );
  }

  const basePath = data.folder.path;
  const tags = data.tags || [];

  const create = async (e) => {
    e.preventDefault();
    const tag = name.trim();
    if (!tag || creating) return;
    setCreating(true);
    try {
      await sendJson('POST', '/api/tags', { basePath, tag });
      if (!alive.current) return;
      notify(`Created the tag "${tag}"`);
      setName('');
      await load();
      if (alive.current) setEditing(tag);   // a new folder: say what it means in labelmaster's terms
    } catch (err) {
      notify({ severity: 'error', message: errorText(err, `Could not create the tag "${tag}"`) });
    } finally {
      if (alive.current) setCreating(false);
    }
  };

  const remove = async (t) => {
    const done = await ask({
      title: `Delete the tag "${t.tag}"?`,
      rows: [
        ['Files', t.files ? `${plural(t.files, 'file')} lose the tag` : 'none carry it'],
        ['Rule', t.rule ? 'is deleted' : 'none'],
        ['Folder', t.folder === 'empty' ? `${basePath}/content/${t.tag} is removed (it is empty)` : 'none on disk'],
      ],
      text: 'The videos themselves are not touched.',
      okLabel: t.files ? `Delete tag from ${plural(t.files, 'file')}` : 'Delete tag',
      danger: true,
      busyLabel: 'Deleting…',
      run: () => sendJson('DELETE', '/api/tags', { basePath, tag: t.tag }),
    });
    if (!done) return;
    notify(`Deleted the tag "${t.tag}"`);
    load();
  };

  const editingRow = editing ? tags.find(t => t.tag === editing) : null;

  return (
    <Section title="Tags"
      description="A tag is a folder in content. A rule tags labelled videos by itself. Tags are shared by every library folder.">
      {error && <SectionError error={error} onRetry={load} />}
      <Box component="form" onSubmit={create} sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', mb: 1.5 }}>
        <TextField size="small" placeholder="New tag" value={name} onChange={(e) => setName(e.target.value)}
          disabled={creating} inputProps={{ 'aria-label': 'New tag' }} sx={{ width: { xs: '100%', sm: 240 } }} />
        <SmallButton primary type="submit" disabled={!name.trim() || creating}>{creating ? 'Creating…' : 'Create'}</SmallButton>
      </Box>

      {tags.length === 0 ? (
        <Typography sx={metaSx}>No tags yet.</Typography>
      ) : (
        <Rows>
          {tags.map((t) => {
            const full = t.folder === 'files';
            const name600 = <Typography sx={{ fontWeight: 600, fontSize: '.8125rem', color: 'var(--text)', ...ellipsis }} title={t.tag}>{t.tag}</Typography>;
            const files = <Typography sx={{ ...metaSx, ...ellipsis }}>{filesText(t)}</Typography>;
            return (
              <Box key={t.tag} sx={{ ...rowSx, ...(isPhone ? { height: 56 } : {}), display: 'flex', alignItems: 'center', gap: 1.5 }}>
                {isPhone ? (
                  <Box sx={{ flex: 1, minWidth: 0 }}>{name600}{files}</Box>
                ) : (
                  <>
                    <Box sx={{ width: 160, flex: 'none', minWidth: 0 }}>{name600}</Box>
                    <Box sx={{ width: 240, flex: 'none', minWidth: 0 }}>{files}</Box>
                  </>
                )}
                <Typography sx={{
                  ...metaSx, ...ellipsis, flex: 1, display: { xs: 'none', sm: 'block' },
                  ...(t.rule ? {} : { color: 'var(--muted)' })
                }} title={t.rule ? ruleText(t.rule) : undefined}>
                  {t.rule ? ruleText(t.rule) : 'no rule'}
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.75, flex: 'none' }}>
                  <SmallButton onClick={() => setEditing(t.tag)}>{t.rule ? 'Edit rule' : 'Add rule'}</SmallButton>
                  <SmallButton danger disabled={full} tip={full ? `Its folder holds ${plural(t.folderFiles, 'file')}` : undefined}
                    onClick={() => remove(t)}>
                    Delete…
                  </SmallButton>
                </Box>
              </Box>
            );
          })}
        </Rows>
      )}

      <TagRuleDialog open={!!editing} key={editing || ''} tag={editing} terms={terms} rule={editingRow?.rule || null}
        onClose={(msg) => { setEditing(null); if (msg) notify(msg); load(); }} />
    </Section>
  );
}
