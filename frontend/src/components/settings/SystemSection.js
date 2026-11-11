/**
 * Settings > System: server status, the database, the rating snapshots (RatingSnapshots) and restart. Local numbers only.
 *
 *   GET  /api/admin/stats    { startedAt, uptimeMs, node, platform, docker, memory, database: { file, bytes, schema, tables } }
 *   POST /api/admin/restart  { confirm: 'restart' } -> { ok, docker }; the process exits 1 s later
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { Section, Panel, LoadingState } from '../layout';
import { useAsk, useNotify, FactRows, errorText } from '../ui';
import { SmallButton } from '../discover/shared';
import { Rows, rowSx, metaSx, monoSx, getJson, sendJson, SectionError } from './kit';
import { RatingSnapshots } from '../rating/RatingReset';

const REFRESH_MS = 30000;
const POLL_MS = 2000;
const WAIT_MS = 120000;

function fmt(b) {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(Math.abs(b)) / Math.log(1024)));
  const v = b / 1024 ** i;
  return `${v >= 100 || i < 2 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

function dur(ms) {
  const min = Math.floor((ms || 0) / 60000);
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d) return `${d} d ${h} h`;
  if (h) return `${h} h ${m} min`;
  return `${m} min`;
}

export default function SystemSection() {
  const ask = useAsk();
  const notify = useNotify();
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [waiting, setWaiting] = useState(null); // seconds waited for the restart, or null
  const [timedOut, setTimedOut] = useState(false);
  const restarting = useRef(false);
  const alive = useRef(true);
  const timers = useRef([]);

  useEffect(() => {
    alive.current = true;
    const list = timers.current;
    return () => {
      alive.current = false;
      list.forEach(clearInterval);
    };
  }, []);

  const load = useCallback(async () => {
    if (restarting.current) return;
    try {
      const data = await getJson('/api/admin/stats');
      if (!alive.current || restarting.current) return;
      // startedAt is an ISO date (routes/admin.js); an answer without one is an older server
      if (!data || Number.isNaN(Date.parse(data.startedAt))) throw new Error('The server answered in an older format. Restart it to see these numbers.');
      setStats(data);
      setError(null);
    } catch (e) {
      if (alive.current && !restarting.current) setError(errorText(e, 'Could not read the server status'));
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const docker = !!stats?.docker;
  const restartText = docker
    ? 'Docker starts the app again. Anything running in the background is cut off. This page waits until the server answers.'
    : 'The server is not in Docker: it stays off until you start it again by hand.';

  const waitForRestart = (startedAt) => {
    restarting.current = true;
    setTimedOut(false);
    setWaiting(0);
    const since = Date.now();
    let busy = false;
    const t = setInterval(async () => {
      if (!alive.current) { clearInterval(t); return; }
      const waited = Date.now() - since;
      setWaiting(Math.round(waited / 1000));
      if (waited >= WAIT_MS) {
        clearInterval(t);
        restarting.current = false;
        setWaiting(null);
        setTimedOut(true);
        return;
      }
      if (busy) return;
      busy = true;
      try {
        const data = await getJson('/api/admin/stats');
        if (alive.current && data.startedAt && data.startedAt !== startedAt) {
          clearInterval(t);
          restarting.current = false;
          setWaiting(null);
          setStats(data);
          setError(null);
          notify('The app restarted');
        }
      } catch {
        // the server is still down
      } finally {
        busy = false;
      }
    }, POLL_MS);
    timers.current.push(t);
  };

  const restart = async () => {
    const before = stats?.startedAt;
    const ok = await ask({
      title: docker ? 'Restart the app?' : 'Stop the server?',
      text: restartText,
      okLabel: docker ? 'Restart' : 'Stop server',
      danger: true,
      busyLabel: docker ? 'Restarting…' : 'Stopping…',
      run: () => sendJson('POST', '/api/admin/restart', { confirm: 'restart' })
    });
    if (!ok) return;
    if (docker) waitForRestart(before);
    else notify({ severity: 'info', message: 'The server is stopping' });
  };

  const db = stats?.database;
  const mem = stats?.memory || {};

  return (
    <>
      <Section title="Server" actions={<SmallButton onClick={load} disabled={waiting != null}>Reload</SmallButton>}>
        {error && <SectionError error={error} onRetry={load} />}
        {!stats && !error && <LoadingState />}
        {stats && (
          <Panel>
            <FactRows rows={[
              ['Up', `${dur(stats.uptimeMs)} · since ${new Date(stats.startedAt).toLocaleString()}`],
              ['Runs on', `Node ${stats.node} · ${stats.platform}${docker ? ' · in Docker' : ''}`],
              ['Memory', `${fmt(mem.rss)} (heap ${fmt(mem.heapUsed)} of ${fmt(mem.heapTotal)})`]
            ]} />
          </Panel>
        )}
      </Section>

      {db && (
        <Section title="Database" description={`${db.file} · ${fmt(db.bytes)} · schema ${db.schema ?? 'unknown'}`}>
          <Rows>
            {(db.tables || []).map(t => {
              const detail = t.detail
                ? Object.entries(t.detail).map(([k, v]) => `${k} ${Number(v).toLocaleString()}`).join(' · ')
                : '';
              return (
                <Box key={t.name} sx={{ ...rowSx, height: 36 }}>
                  <Box component="span" title={t.name} sx={{ ...monoSx, width: { xs: 140, sm: 200 }, flexShrink: 0, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.name}
                  </Box>
                  <Box component="span" sx={{ width: 90, flexShrink: 0, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text)' }}>
                    {Number(t.rows || 0).toLocaleString()}
                  </Box>
                  <Box component="span" title={detail || undefined} sx={{ ...metaSx, flex: 1, minWidth: 0, pl: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {detail}
                  </Box>
                </Box>
              );
            })}
          </Rows>
        </Section>
      )}

      <RatingSnapshots />

      {stats && (
        <Section title="Restart">
          <Box sx={{ ...metaSx, mb: 1.5 }}>{restartText}</Box>
          <SmallButton danger onClick={restart} disabled={waiting != null}>
            {docker ? 'Restart app…' : 'Stop server…'}
          </SmallButton>
          {waiting != null && (
            <Box aria-live="polite" sx={{ ...metaSx, mt: 1 }}>{`Restarting… waiting for the server (${waiting} s)`}</Box>
          )}
          {timedOut && (
            <Box sx={{ ...metaSx, mt: 1, color: 'var(--bad)' }}>The server has not answered for 2 minutes. Look at it on the NAS.</Box>
          )}
        </Section>
      )}
    </>
  );
}
