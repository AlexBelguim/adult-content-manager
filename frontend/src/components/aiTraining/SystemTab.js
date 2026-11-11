/**
 * The AI & Training page's System tab: the AI server (from the page's acm-gpu check and the address setting), the
 * database (GET /api/health?ai=0) with its orphan cleanup, and the library folders on disk (a sidebar group). The AI
 * server part never waits for /api/health. acm-gpu's state and Check again are the page's sidebar group.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import FolderOutlined from '@mui/icons-material/FolderOutlined';
import { Panel, Section, LoadingState, SideGroup, SideFacts, SideNote, ContentLine } from '../layout';
import { useAsk, useNotify, errorText, plural } from '../ui';
import { SmallButton, ListError } from '../discover/shared';
import { modelName, fmtWhen } from './modelInfo';
const SOURCE = {
  coordinator: 'The coordinator (Settings > Workers)',
  saved: 'Saved in Settings > Workers',
  env: 'The AI_SERVER_URL environment variable',
  default: 'The default address',
};
const num = (n) => (n == null ? '–' : n.toLocaleString());

function Facts({ rows }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(90px, max-content) minmax(0, 1fr)', columnGap: 2, rowGap: 0.75, alignItems: 'baseline' }}>
      {rows.map(([label, value]) => (
        <React.Fragment key={label}>
          <Typography sx={{ fontSize: '.75rem', color: 'var(--dim)' }}>{label}</Typography>
          <Box sx={{ fontSize: '.85rem', color: 'var(--text)', overflowWrap: 'anywhere', minWidth: 0 }}>{value}</Box>
        </React.Fragment>
      ))}
    </Box>
  );
}

function AiServer({ ai, reloadKey }) {
  const [address, setAddress] = useState({ status: 'loading', data: null });
  useEffect(() => {
    let alive = true;
    fetch('/api/settings/effective/ai_server_url')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`The server answered ${r.status}`))))
      .then(d => { if (alive) setAddress({ status: 'ok', data: d }); })
      .catch(() => { if (alive) setAddress(cur => ({ ...cur, status: 'error' })); });
    return () => { alive = false; };
  }, [reloadKey, ai.state]);

  const online = ai.state === 'online';
  const h = ai.health || {};
  const addr = address.data;
  const unknown = address.status === 'error' ? 'Could not read the setting' : '–';
  return (
    <Section title="AI server" actions={
      <SmallButton component={RouterLink} to="/settings/workers">Open Workers settings</SmallButton>
    }>
      <Panel>
        <Facts rows={[
          ['Checked', ai.checkedAt ? fmtWhen(ai.checkedAt) : 'not yet'],
          ['Address', addr?.url || unknown],
          ['Comes from', addr ? (SOURCE[addr.source] || addr.source || '–') : unknown],
          ['Loaded model', !online ? '–' : h.model_loaded ? (h.current_model || modelName(h.model_type)) : 'Nothing loaded'],
          ['Device', h.device || '–'],
          ['VRAM in use', h.vram_allocated || '–'],
        ]} />
        {ai.state === 'offline' && (
          <Typography sx={{ fontSize: '.75rem', color: 'var(--warn)', mt: 1.25 }}>
            acm-gpu does not answer at this address. Check that the GPU PC is on and acm-gpu runs.
          </Typography>
        )}
      </Panel>
    </Section>
  );
}

export default function SystemTab({ ai, reloadKey }) {
  const ask = useAsk();
  const notify = useNotify();
  const [health, setHealth] = useState({ status: 'loading', data: null, error: null });
  const [cleaning, setCleaning] = useState(false);

  const load = useCallback(async () => {
    setHealth(cur => ({ ...cur, status: 'loading', error: null }));
    try {
      const r = await fetch('/api/health?ai=0');
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.database) throw new Error(d.error || `The server answered ${r.status}`);
      setHealth({ status: 'ok', data: d, error: null });
    } catch (err) {
      setHealth(cur => ({ ...cur, status: 'error', error: errorText(err, 'Could not read the database') }));
    }
  }, []);
  useEffect(() => { load(); }, [load, reloadKey]);

  const d = health.data;
  const sizes = d?.database?.tableSizes || {};
  const total = Object.values(sizes).reduce((a, n) => a + (n >= 0 ? n : 0), 0);
  const o = d?.database?.orphanedRecords || {};
  const orphans = (o.ratings || 0) + (o.hashes || 0) + (o.pairwise || 0) + (o.filterActions || 0) + (o.performerComparisons || 0) + (o.tags || 0);
  const disk = d?.disk || {};
  const folder = (x) => (x?.exists ? 'Folder there' : 'Folder missing');
  const folderRow = (label, x) => ({
    label, value: num(x?.performers || 0), tone: x && !x.exists ? 'warn' : undefined, title: folder(x),
  });
  const missing = d ? [disk.beforeFilter, disk.afterFilter, disk.trainingData].filter(x => !x?.exists).length : 0;

  const cleanup = async () => {
    let cleaned = 0;
    const done = await ask({
      title: 'Clean up the database?',
      text: 'Deletes the rows that point at a performer who is no longer in the app. The kept file hashes of deleted performers and the tag definitions stay. Cannot be undone.',
      rows: [
        ['Ratings', num(o.ratings)],
        ['File hashes', num(o.hashes)],
        ['Pairwise scores', num(o.pairwise)],
        ['Filter actions', num(o.filterActions)],
        ['Duels', num(o.performerComparisons)],
        ['Tags', num(o.tags)],
      ],
      okLabel: `Delete ${plural(orphans, 'row')}`,
      danger: true,
      busyLabel: 'Deleting…',
      run: async () => {
        setCleaning(true);
        try {
          const res = await fetch('/api/health/cleanup', { method: 'POST' });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.cleaned) throw new Error(data.error || `The server answered ${res.status}`);
          cleaned = Object.values(data.cleaned).reduce((a, n) => a + (Number(n) || 0), 0);
        } finally { setCleaning(false); }
      },
    });
    if (!done) return;
    notify(cleaned ? `Deleted ${plural(cleaned, 'orphaned row')}` : 'Nothing to clean up');
    load();
  };

  const cleanBtn = (
    <SmallButton tip={d && !orphans ? 'Nothing to clean up' : undefined} disabled={!d || !orphans || cleaning} onClick={cleanup}>
      {cleaning ? 'Deleting…' : 'Clean up orphans'}
    </SmallButton>
  );

  let database;
  if (health.status === 'error') database = <ListError error={health.error} onRetry={load} />;
  else if (!d) database = <LoadingState />;
  else {
    database = (
      <Panel sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', columnGap: 3, rowGap: 0.25 }}>
        {Object.entries(sizes).map(([table, n]) => (
          <Box key={table} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: '.75rem', color: 'var(--dim)', overflowWrap: 'anywhere', minWidth: 0 }}>{table}</Typography>
            <Typography sx={{ fontSize: '.75rem', color: n < 0 ? 'var(--warn)' : 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
              {n < 0 ? 'missing' : num(n)}
            </Typography>
          </Box>
        ))}
      </Panel>
    );
  }

  return (
    <Box>
      <SideGroup id="folders" title="Folders" icon={<FolderOutlined />} dot={missing ? 'warn' : null}
        summary={!d ? (health.status === 'error' ? 'Could not read' : 'Reading…') : missing ? `${plural(missing, 'folder')} missing` : 'All there'}>
        {d ? (
          <SideFacts rows={[
            folderRow('Before folders', disk.beforeFilter),
            folderRow('After folders', disk.afterFilter),
            folderRow('Training folders', disk.trainingData),
          ]} />
        ) : (
          <SideNote>{health.status === 'error' ? 'Could not read the disk.' : 'Reading the disk…'}</SideNote>
        )}
      </SideGroup>

      <ContentLine title="System" />

      <AiServer ai={ai} reloadKey={reloadKey} />

      <Section title="Database" description={d ? `${total.toLocaleString()} records · schema v${d.schemaVersion}` : undefined} actions={cleanBtn}>
        {database}
      </Section>
    </Box>
  );
}
