/**
 * Rank pictures: one row per performer in the after folder, with how many picture pairs they have. Rank opens the
 * ranker; a click on the row opens its ranking lane (the pictures, best first), where two taps fix the order of a
 * pair. Everything comes from the main server (pairwise routes); the fixes are stored as 'intra' pairs, the kind
 * the CLIP models train on.
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Typography, Button, TextField, Select, MenuItem, IconButton } from '@mui/material';
import { ExpandMore, ExpandLess, Close, PhotoLibraryOutlined } from '@mui/icons-material';
import {
    PageShell, PageHeader, Panel, Toolbar, EmptyState, LoadingState, iconBtnSx, overlayChipSx, SPACE
} from '../components/layout';
import { useNotify } from '../components/ui';
import { useIsPhone } from '../nav';
import RateTabs from '../components/rating/RateTabs';

const SORT_KEY = 'rate.pictures.sort';
const SORTS = [['needs', 'Needs pairs'], ['most', 'Most pairs'], ['name', 'Name']];
const LANE_LIMIT = 60; // above this a lane shows the best 40 and the worst 20 until 'Show all'
const LANE_HEAD = 40;
const LANE_TAIL = 20;
const TILE = { xs: 88, sm: 110 };

const readSort = () => {
    try {
        const v = localStorage.getItem(SORT_KEY);
        return SORTS.some(([id]) => id === v) ? v : 'needs';
    } catch { return 'needs'; }
};
const writeSort = (v) => { try { localStorage.setItem(SORT_KEY, v); } catch { /* a per-viewer convenience only */ } };

/** '1,234 pairs', '1 pair' */
const count = (n, word) => `${n.toLocaleString()} ${n === 1 ? word : `${word}s`}`;

const previewUrl = (p) => `/api/files/preview?path=${encodeURIComponent(p)}`;
// The large pictures in the tray: the whole picture (the preview is a centre crop), loaded the way the ranker does.
const fullUrl = (p, basePath) => (basePath
    ? `/api/files/cached-image?path=${encodeURIComponent(p)}&basePath=${encodeURIComponent(basePath)}&folderType=${p.includes('before filter performer') ? 'before' : 'after'}`
    : previewUrl(p));
// The same parameters as the gallery's 'Rank images'
const rankPath = (p) => `/pairwise-rank?performerId=${p.id}&performerName=${encodeURIComponent(p.name)}&basePath=${encodeURIComponent(p.folder_path || '')}`;

/** A thrown fetch (no answer) or a refused answer, as one line of text. */
const messageOf = (err) => (err && err.name !== 'TypeError' && err.message ? err.message : 'No answer from the server');

async function getJson(url) {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

async function postJson(url, body) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `The server refused it (${res.status})`);
    return data;
}

/** Best first; pictures marked both-bad go last. */
function laneOrder(images) {
    const byScore = (a, b) => (b.score ?? 0) - (a.score ?? 0);
    return [...images.filter(i => !i.bothBad).sort(byScore), ...images.filter(i => i.bothBad).sort(byScore)];
}

const factChipSx = (tone = 'var(--dim)') => ({
    display: 'inline-flex', alignItems: 'center', height: 20, px: '6px', flexShrink: 0,
    border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)',
    fontSize: 12, lineHeight: 1, color: tone, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums'
});

const tileChipSx = (tone) => ({
    ...overlayChipSx(tone), position: 'absolute', fontSize: 12, fontWeight: 600, px: '6px', py: '3px', gap: 0
});

const plainBtnSx = {
    p: 0, m: 0, border: 0, background: 'none', color: 'inherit', font: 'inherit', textAlign: 'left', cursor: 'pointer',
    '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: '-2px' }
};

function Avatar({ performer }) {
    const [failed, setFailed] = useState(false);
    const src = performer.thumbnail && !failed ? previewUrl(performer.thumbnail) : null;
    return (
        <Box sx={{
            width: 36, height: 36, flexShrink: 0, borderRadius: '50%', overflow: 'hidden', bgcolor: 'var(--raised)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dim)', fontSize: 13, fontWeight: 600
        }}>
            {src
                ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : (performer.name || '?').trim().charAt(0).toUpperCase()}
        </Box>
    );
}

function Tile({ img, rank, selected, onClick }) {
    const score = img.bothBad ? 'bad' : Math.round(img.score ?? 0);
    return (
        <Box
            component="button" type="button" onClick={onClick} aria-pressed={!!selected}
            aria-label={`Picture ${rank}, ${img.bothBad ? 'marked bad' : `score ${score}`}`}
            sx={{
                ...plainBtnSx, position: 'relative', flex: 'none', width: TILE, height: TILE,
                borderRadius: 'var(--radius-sm)', overflow: 'hidden', bgcolor: 'var(--raised)',
                opacity: img.bothBad ? 0.45 : 1
            }}
        >
            <img src={previewUrl(img.path)} alt="" loading="lazy" decoding="async" draggable={false}
                style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} />
            <Box sx={{ ...tileChipSx('var(--text)'), top: 4, left: 4 }}>{rank}</Box>
            <Box sx={{ ...tileChipSx(img.bothBad ? 'var(--bad)' : 'var(--text)'), bottom: 4, right: 4 }}>{score}</Box>
            {selected && (
                <>
                    <Box sx={{ position: 'absolute', inset: 0, border: '2px solid var(--accent)', borderRadius: 'inherit', pointerEvents: 'none' }} />
                    <Box sx={{ ...tileChipSx('var(--accent)'), top: 4, right: 4 }}>{selected}</Box>
                </>
            )}
        </Box>
    );
}

function Lane({ performer, lane, selectedOf, onTile, onRetry, onShowAll, onRank }) {
    let body = null;
    if (!lane || lane.status === 'loading') {
        body = (
            <Box sx={{ display: 'flex', gap: SPACE.sm, overflow: 'hidden' }} aria-label="Loading pictures">
                {Array.from({ length: 8 }, (_, i) => (
                    <Box key={i} sx={{ flex: 'none', width: TILE, height: TILE, borderRadius: 'var(--radius-sm)', bgcolor: 'var(--raised)' }} />
                ))}
            </Box>
        );
    } else if (lane.status === 'ready' && (lane.images || []).length === 0) {
        body = (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, flexWrap: 'wrap' }}>
                <Typography sx={{ fontSize: 13, color: 'var(--dim)' }}>No pictures ranked yet.</Typography>
                <Button size="small" variant="outlined" onClick={onRank}>Rank</Button>
            </Box>
        );
    } else if (lane.status === 'ready') {
        const images = lane.images;
        const cut = images.length > LANE_LIMIT && !lane.showAll;
        const shown = cut
            ? [...images.slice(0, LANE_HEAD).map((img, i) => [img, i + 1]), null,
                ...images.slice(-LANE_TAIL).map((img, i) => [img, images.length - LANE_TAIL + i + 1])]
            : images.map((img, i) => [img, i + 1]);
        body = (
            <Box sx={{
                display: 'flex', gap: SPACE.sm, overflowX: 'auto', overscrollBehaviorX: 'contain', pb: SPACE.xs,
                opacity: lane.refreshing ? 0.6 : 1, transition: 'opacity .16s ease'
            }}>
                {shown.map((entry) => {
                    if (!entry) {
                        return (
                            <Box key="show-all" component="button" type="button" onClick={onShowAll}
                                sx={{
                                    ...plainBtnSx, flex: 'none', width: TILE, height: TILE, textAlign: 'center',
                                    borderRadius: 'var(--radius-sm)', border: '1px dashed var(--line-strong)',
                                    color: 'var(--dim)', fontSize: 13, fontVariantNumeric: 'tabular-nums',
                                    '&:hover': { color: 'var(--text)', bgcolor: 'var(--raised)' }
                                }}>
                                {`Show all ${images.length.toLocaleString()}`}
                            </Box>
                        );
                    }
                    const [img, rank] = entry;
                    return <Tile key={img.path} img={img} rank={rank} selected={selectedOf(img)} onClick={() => onTile(img)} />;
                })}
            </Box>
        );
    }

    return (
        <Panel id={`lane-${performer.id}`} padded={false} sx={{ p: 1.5, mt: SPACE.xs, minWidth: 0 }}>
            <Typography sx={{ fontSize: 12, color: 'var(--dim)', mb: SPACE.sm }}>
                Best first. Tap two pictures to fix their order.
            </Typography>
            {lane?.error && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, mb: body ? SPACE.sm : 0, flexWrap: 'wrap' }}>
                    <Typography sx={{ fontSize: 13, color: 'var(--bad)', minWidth: 0 }}>{lane.error}</Typography>
                    <Button size="small" variant="text" onClick={onRetry}>Retry</Button>
                </Box>
            )}
            {body}
        </Panel>
    );
}

function Tray({ tray, onChoose, onClose }) {
    const { performer, first, second, busy, error } = tray;
    const picSx = {
        ...plainBtnSx, position: 'relative', width: 'calc((100% - 12px) / 2)', maxWidth: 200, aspectRatio: '3 / 4',
        border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden', bgcolor: 'var(--bg)',
        '&:hover': { borderColor: 'var(--accent)' },
        '&:disabled': { cursor: 'wait', opacity: 0.6 }
    };
    return (
        <Panel role="dialog" aria-label={`Fix the order for ${performer.name}`} padded={false} sx={{
            position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 'calc(16px + var(--nav-bottom, 0px))',
            width: 'min(520px, calc(100vw - 32px))', boxSizing: 'border-box', zIndex: 1250, p: 1.5,
            borderColor: 'var(--accent)', boxShadow: 'var(--shadow-lg)'
        }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, mb: SPACE.sm }}>
                <Typography noWrap sx={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', flex: 1, minWidth: 0 }}>
                    Tap the better picture
                </Typography>
                <IconButton aria-label="Cancel" onClick={onClose} disabled={busy} sx={iconBtnSx()}>
                    <Close />
                </IconButton>
            </Box>
            {error && <Typography sx={{ fontSize: 13, color: 'var(--bad)', mb: SPACE.sm }}>{error}</Typography>}
            <Box sx={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                {[[first, second, 'First picture is better', 1], [second, first, 'Second picture is better', 2]].map(([win, lose, label, n]) => (
                    <Box key={n} component="button" type="button" aria-label={label} disabled={busy}
                        onClick={() => onChoose(win, lose)} sx={picSx}>
                        <img src={fullUrl(win.path, performer.folder_path)} alt="" decoding="async" draggable={false}
                            style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }} />
                        <Box sx={{ ...tileChipSx('var(--accent)'), top: 6, left: 6 }}>{n}</Box>
                    </Box>
                ))}
            </Box>
        </Panel>
    );
}

function RankingInsightPage() {
    const navigate = useNavigate();
    const notify = useNotify();
    const isPhone = useIsPhone();

    const [load, setLoad] = useState({ status: 'loading', error: null });
    const [performers, setPerformers] = useState([]); // [{ id, name, folder_path, thumbnail, pics_count, pairs }]
    const [query, setQuery] = useState('');
    const [sort, setSort] = useState(readSort);
    const [open, setOpen] = useState({}); // id -> true; several lanes can be open
    const [lanes, setLanes] = useState({}); // id -> { status, images, error, refreshing, showAll }
    const [selection, setSelection] = useState(null); // { id, img }: the first of two taps
    const [tray, setTray] = useState(null); // { performer, first, second, busy, error }

    const laneGen = useRef({});
    const openRef = useRef(open);
    openRef.current = open;

    const loadPerformers = useCallback(async () => {
        setLoad({ status: 'loading', error: null });
        // without the stats the rows still show, with '–' for pairs
        const statsPromise = getJson('/api/training/performer-stats')
            .then(d => (Array.isArray(d?.performers) ? d.performers : null))
            .catch(() => null);
        let gallery;
        try {
            gallery = await getJson('/api/performers/gallery');
            if (!Array.isArray(gallery)) throw new Error('The server sent no performer list');
        } catch (err) {
            setLoad({ status: 'error', error: messageOf(err) });
            return;
        }
        const stats = await statsPromise;
        const pairsById = new Map();
        if (stats) for (const s of stats) pairsById.set(s?.id, Number(s?.pairwise?.total) || 0);
        setPerformers(gallery
            .filter(p => p && p.id != null)
            .map(p => ({
                id: p.id,
                name: p.name || '',
                folder_path: p.folder_path || '',
                thumbnail: p.thumbnail || '',
                pics_count: Number(p.pics_count) || 0,
                pairs: stats ? (pairsById.get(p.id) ?? 0) : null
            })));
        setLoad({ status: 'ready', error: null });
    }, []);

    useEffect(() => { loadPerformers(); }, [loadPerformers]);

    // A refetch keeps the tiles mounted (dimmed), so the lane keeps its scroll position.
    const loadLane = useCallback(async (id) => {
        const gen = (laneGen.current[id] || 0) + 1;
        laneGen.current[id] = gen;
        setLanes(prev => ({
            ...prev,
            [id]: prev[id]?.images
                ? { ...prev[id], refreshing: true, error: null }
                : { status: 'loading', images: null, error: null, refreshing: false, showAll: prev[id]?.showAll || false }
        }));
        try {
            const data = await getJson(`/api/pairwise/image-rankings?performer_id=${encodeURIComponent(id)}`);
            if (!Array.isArray(data?.images)) throw new Error('The server sent no picture list');
            if (laneGen.current[id] !== gen) return;
            setLanes(prev => ({
                ...prev,
                [id]: { ...prev[id], status: 'ready', images: laneOrder(data.images.filter(i => i && i.path)), error: null, refreshing: false }
            }));
        } catch (err) {
            if (laneGen.current[id] !== gen) return;
            setLanes(prev => ({
                ...prev,
                [id]: { ...prev[id], status: prev[id]?.images ? 'ready' : 'error', error: messageOf(err), refreshing: false }
            }));
        }
    }, []);

    /** After a fix or an undo: refetch an open lane in place; a closed one fetches when it opens. */
    const refreshLane = useCallback((id) => {
        if (openRef.current[id]) loadLane(id);
    }, [loadLane]);

    const bumpPairs = useCallback((id, delta) => {
        setPerformers(prev => prev.map(p => (p.id === id && p.pairs != null ? { ...p, pairs: Math.max(0, p.pairs + delta) } : p)));
    }, []);

    const toggle = (id) => {
        const opening = !open[id];
        setOpen(prev => {
            const next = { ...prev };
            if (opening) next[id] = true; else delete next[id];
            return next;
        });
        if (opening) loadLane(id);
    };

    const closeTray = useCallback(() => { setTray(null); setSelection(null); }, []);

    useEffect(() => {
        if (!tray) return undefined;
        const onKey = (e) => {
            if (e.key === 'Escape' && !e.defaultPrevented && !tray.busy) { e.preventDefault(); closeTray(); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [tray, closeTray]);

    const onTile = (performer, img) => {
        if (tray?.busy) return;
        if (tray) {
            if (tray.performer.id === performer.id && (img.path === tray.first.path || img.path === tray.second.path)) {
                // unselect that one; the other stays picked
                setSelection({ id: performer.id, img: img.path === tray.first.path ? tray.second : tray.first });
            } else {
                setSelection({ id: performer.id, img });
            }
            setTray(null);
            return;
        }
        if (!selection || selection.id !== performer.id) { setSelection({ id: performer.id, img }); return; }
        if (selection.img.path === img.path) { setSelection(null); return; }
        setTray({ performer, first: selection.img, second: img, busy: false, error: null });
    };

    const selectedOf = (performerId) => (img) => {
        if (tray) {
            if (tray.performer.id !== performerId) return null;
            if (img.path === tray.first.path) return '1';
            if (img.path === tray.second.path) return '2';
            return null;
        }
        return selection && selection.id === performerId && selection.img.path === img.path ? '1' : null;
    };

    const undo = useCallback(async (performer, pairId) => {
        try {
            await postJson('/api/pairwise/undo', { performer_id: performer.id, pair_id: pairId });
        } catch (err) {
            notify({ message: messageOf(err), severity: 'error' });
            return;
        }
        bumpPairs(performer.id, -1);
        refreshLane(performer.id);
    }, [notify, bumpPairs, refreshLane]);

    const choose = async (winner, loser) => {
        if (!tray || tray.busy) return;
        const { performer } = tray;
        setTray(t => (t ? { ...t, busy: true, error: null } : t));
        let data;
        try {
            data = await postJson('/api/pairwise/submit', {
                performer_id: performer.id, winner: winner.path, loser: loser.path, type: 'intra'
            });
        } catch (err) {
            setTray(t => (t ? { ...t, busy: false, error: messageOf(err) } : t)); // the selection stays
            return;
        }
        closeTray();
        if (data?.duplicate) {
            notify({ message: 'That order was already stored', severity: 'info' });
            return;
        }
        bumpPairs(performer.id, 1);
        refreshLane(performer.id);
        const pairId = data?.pairId;
        notify({
            message: `Order fixed for ${performer.name}`,
            // Undo only names an exact pair: an undo without pair_id would take the performer's newest pair
            ...(typeof pairId === 'number' && { action: { label: 'Undo', onClick: () => undo(performer, pairId) } })
        });
    };

    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        const list = q ? performers.filter(p => p.name.toLowerCase().includes(q)) : [...performers];
        const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        if (sort === 'name') return list.sort(byName);
        const sign = sort === 'most' ? -1 : 1;
        return list.sort((a, b) => sign * ((a.pairs ?? 0) - (b.pairs ?? 0)) || byName(a, b));
    }, [performers, query, sort]);

    const totalPairs = useMemo(
        () => (performers.some(p => p.pairs == null) ? null : performers.reduce((sum, p) => sum + p.pairs, 0)),
        [performers]
    );

    let content;
    if (load.status === 'loading') {
        content = <LoadingState label="Loading performers…" />;
    } else if (load.status === 'error') {
        content = (
            <EmptyState
                title="Could not load performers"
                description={load.error}
                action={<Button variant="contained" onClick={loadPerformers}>Retry</Button>}
            />
        );
    } else if (performers.length === 0) {
        content = (
            <EmptyState
                icon={<PhotoLibraryOutlined />}
                title="No performers in the after folder"
                description="Performers show up here once Filter has moved them to the after folder."
                action={<Button variant="contained" onClick={() => navigate('/filter')}>Open Filter</Button>}
            />
        );
    } else if (shown.length === 0) {
        content = <Typography sx={{ fontSize: 13, color: 'var(--dim)', py: SPACE.md }}>No names match.</Typography>;
    } else {
        content = (
            <Box sx={{ display: 'grid', gap: SPACE.sm, minWidth: 0 }}>
                {shown.map((p) => {
                    const isOpen = !!open[p.id];
                    let pairsChip;
                    if (p.pairs == null) pairsChip = <Box component="span" sx={factChipSx()}>– pairs</Box>;
                    else if (p.pairs === 0) pairsChip = <Box component="span" sx={factChipSx('var(--warn)')}>Needs pairs</Box>;
                    else pairsChip = <Box component="span" sx={factChipSx()}>{count(p.pairs, 'pair')}</Box>;
                    return (
                        <Box key={p.id} sx={{ minWidth: 0 }}>
                            <Panel padded={false} sx={{
                                height: 56, display: 'flex', alignItems: 'center', gap: SPACE.sm, pr: 1.5, overflow: 'hidden',
                                contentVisibility: 'auto', containIntrinsicSize: '0 56px',
                                ...(isOpen && { borderColor: 'var(--line-strong)' })
                            }}>
                                <Box component="button" type="button" onClick={() => toggle(p.id)}
                                    aria-expanded={isOpen} aria-controls={isOpen ? `lane-${p.id}` : undefined}
                                    sx={{
                                        ...plainBtnSx, flex: '1 1 auto', minWidth: 0, alignSelf: 'stretch',
                                        display: 'flex', alignItems: 'center', gap: 1.25, pl: 1.5,
                                        borderRadius: 'var(--radius-lg)'
                                    }}>
                                    <Avatar performer={p} />
                                    <Box sx={{
                                        flex: '1 1 auto', minWidth: 0, display: 'flex', gap: isPhone ? 0.5 : SPACE.sm,
                                        flexDirection: isPhone ? 'column' : 'row', alignItems: isPhone ? 'flex-start' : 'center'
                                    }}>
                                        <Typography noWrap sx={{
                                            fontSize: 14, fontWeight: 560, color: 'var(--text)', minWidth: 0, maxWidth: '100%',
                                            flex: isPhone ? 'none' : '0 1 auto'
                                        }}>
                                            {p.name}
                                        </Typography>
                                        <Box sx={{ display: 'flex', gap: SPACE.xs, flexShrink: 0, overflow: 'hidden', maxWidth: '100%' }}>
                                            {pairsChip}
                                            <Box component="span" sx={factChipSx()}>{count(p.pics_count, 'picture')}</Box>
                                        </Box>
                                    </Box>
                                    <Box sx={{ color: 'var(--dim)', display: 'flex', flexShrink: 0, '& svg': { fontSize: 20 } }}>
                                        {isOpen ? <ExpandLess /> : <ExpandMore />}
                                    </Box>
                                </Box>
                                <Button size="small" variant="contained" sx={{ flexShrink: 0 }}
                                    onClick={() => navigate(rankPath(p))}>
                                    Rank
                                </Button>
                            </Panel>
                            {isOpen && (
                                <Lane
                                    performer={p}
                                    lane={lanes[p.id]}
                                    selectedOf={selectedOf(p.id)}
                                    onTile={(img) => onTile(p, img)}
                                    onRetry={() => loadLane(p.id)}
                                    onShowAll={() => setLanes(prev => ({ ...prev, [p.id]: { ...prev[p.id], showAll: true } }))}
                                    onRank={() => navigate(rankPath(p))}
                                />
                            )}
                        </Box>
                    );
                })}
            </Box>
        );
    }

    const facts = load.status === 'ready' && performers.length > 0
        ? `${query.trim() ? `${shown.length.toLocaleString()} of ` : ''}${count(performers.length, 'performer')} · ${totalPairs == null ? '– pairs' : count(totalPairs, 'pair')}`
        : null;

    return (
        <PageShell full>
            <PageHeader title="Rank pictures" />

            <Toolbar>
                <RateTabs current="pictures" />
                {facts && (
                    <Typography sx={{ fontSize: 13, color: 'var(--dim)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        {facts}
                    </Typography>
                )}
                <Box sx={{ display: 'flex', gap: SPACE.sm, alignItems: 'center', width: { xs: '100%', sm: 'auto' }, ml: { sm: 'auto' } }}>
                    <TextField
                        size="small" type="search" placeholder="Search names" value={query}
                        onChange={(e) => setQuery(e.target.value)} inputProps={{ 'aria-label': 'Search names' }}
                        sx={{
                            flex: { xs: '1 1 auto', sm: '0 0 180px' }, minWidth: 0,
                            '& .MuiInputBase-root': { fontSize: 13, height: 32, bgcolor: 'var(--surface)' }
                        }}
                    />
                    <Select
                        size="small" value={sort} inputProps={{ 'aria-label': 'Sort' }}
                        onChange={(e) => { setSort(e.target.value); writeSort(e.target.value); }}
                        sx={{ flexShrink: 0, fontSize: 13, height: 32, bgcolor: 'var(--surface)' }}
                    >
                        {SORTS.map(([id, label]) => <MenuItem key={id} value={id}>{label}</MenuItem>)}
                    </Select>
                </Box>
            </Toolbar>

            {content}

            {tray && <Tray tray={tray} onChoose={choose} onClose={closeTray} />}
        </PageShell>
    );
}

export default RankingInsightPage;
