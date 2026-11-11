import React, { useEffect, useMemo, useRef } from 'react';
import { Link as RouterLink, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { Box, IconButton, Tooltip } from '@mui/material';
import SlideshowIcon from '@mui/icons-material/Slideshow';
import FullscreenGalleryDialog from './fullscreenModes/FullscreenGalleryDialog';
import { PageShell, PageHeader, iconBtnSx } from './layout';
import { TabBar, SmallButton, useOverlay } from './discover/shared';
import { useChrome } from '../nav';
import useHomeQuery from './home/useHomeQuery';
import { useGalleryPerformers, useGenres } from './home/homeData';
import { galleryUrl, hasNewUpload } from './home/performerFacts';
import { buildFacets, normalizeFilters, matchesSearch, applyFilters, sortPerformers } from './home/filterModel';
import PerformersTab from './home/PerformersTab';
import GenresTab from './home/GenresTab';
import PerformerFilters from './home/PerformerFilters';

/**
 * The Gallery home (`/` in Gallery mode, 900px and wider): Performers and Genres tabs, the filter drawer and the
 * slideshow. basePath is the library root from MainPage. The lists live in components/home/homeData.js, so a
 * remount shows the last list at once; the query (tab, search, sort, filters) lives in the URL.
 * No title block on PC (the app bar names the page): Group rate and the slideshow sit right of the tabs, and the
 * new-upload count is the Performers toolbar's "New uploads N" chip. In the phone chrome PageHeader gives the page
 * bar its title and holds the two buttons.
 */
export default function GalleryView({ basePath }) {
  const isPhone = useChrome() === 'phone';
  const navigate = useNavigate();
  const query = useHomeQuery();
  const data = useGalleryPerformers();
  const g = useGenres(basePath);
  const { performers } = data;

  const facets = useMemo(() => buildFacets(performers || []), [performers]);
  const filters = useMemo(() => normalizeFilters(query.filters, facets), [query.filters, facets]);
  const searched = useMemo(() => (performers || []).filter(p => matchesSearch(p, query.q)), [performers, query.q]);
  const filtered = useMemo(() => applyFilters(searched, filters, facets), [searched, filters, facets]);
  const shown = useMemo(() => sortPerformers(filtered, query.sort), [filtered, query.sort]);
  const shownList = useMemo(() => [...shown.main, ...shown.missing], [shown]);
  const total = performers?.length ?? 0;
  const newCount = useMemo(() => (performers ? performers.filter(hasNewUpload).length : 0), [performers]);

  const filtersOv = useOverlay('filters');
  const showOv = useOverlay('show');

  // The drawer's filters apply live, by replacing its own history entry. Closing it (Done, Close, Esc, Back) pops that
  // entry, which would bring back the query from before it opened: put the drawer's last query back on the entry below.
  const location = useLocation();
  const navType = useNavigationType();
  const keepOnClose = useRef(null);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.has('filters')) {
      params.delete('filters');
      const rest = params.toString();
      keepOnClose.current = rest ? `?${rest}` : '';
      return;
    }
    const keep = keepOnClose.current;
    keepOnClose.current = null;
    if (keep != null && navType === 'POP' && keep !== location.search) {
      navigate({ pathname: location.pathname, search: keep, hash: location.hash }, { replace: true, state: location.state });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per history entry
  }, [location.key]);

  // A reload never reopens the slideshow without a click.
  useEffect(() => {
    if (showOv.value != null) showOv.set(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the first mount only
  }, []);

  const canShow = performers != null && shownList.length > 0;

  const pageActions = (
    <>
      <SmallButton component={RouterLink} to="/group-rate">Group rate</SmallButton>
      <Tooltip title={canShow ? 'Slideshow' : 'Nothing to show'}>
        <span>
          <IconButton aria-label="Slideshow" disabled={!canShow} onClick={() => showOv.open('1')} sx={iconBtnSx()}>
            <SlideshowIcon />
          </IconButton>
        </span>
      </Tooltip>
    </>
  );

  const tabBar = (
    <TabBar
      label="Gallery"
      value={query.tab}
      onChange={(t) => { query.set({ tab: t }); window.scrollTo(0, 0); }}
      tabs={[
        { id: 'performers', label: 'Performers', count: performers ? total : null },
        { id: 'genres', label: 'Genres', count: g.genres ? g.genres.length : null }
      ]}
      sx={isPhone ? undefined : { flex: '1 1 auto', mb: 0 }}
    />
  );

  return (
    <PageShell full>
      {isPhone ? (
        <>
          <PageHeader title="Gallery" actions={pageActions} />
          {tabBar}
        </>
      ) : (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, minWidth: 0 }}>
          {tabBar}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 'none' }}>{pageActions}</Box>
        </Box>
      )}

      {query.tab === 'genres' ? (
        <GenresTab genres={g.genres} loading={g.loading} error={g.error} reload={g.reload}
          gq={query.gq} gsort={query.gsort} onQuery={query.set} basePath={basePath} />
      ) : (
        <PerformersTab data={data} shown={shown} total={total} newCount={newCount} q={query.q} sort={query.sort} filters={filters}
          facets={facets} onQuery={query.set} onOpenFilters={() => filtersOv.open('1')} basePath={basePath} />
      )}

      <PerformerFilters
        open={filtersOv.value != null}
        onClose={filtersOv.close}
        facets={facets}
        filters={filters}
        onChange={(next) => query.set({ filters: next })}
        shown={shownList.length}
        total={total}
      />

      <FullscreenGalleryDialog
        open={showOv.value != null}
        onClose={showOv.close}
        performers={shownList}
        onPhotoClick={(p) => navigate(galleryUrl(p, basePath), { replace: true })}
      />
    </PageShell>
  );
}
