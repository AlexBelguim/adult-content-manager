import React, { useEffect, useMemo } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import PhotoLibraryOutlinedIcon from '@mui/icons-material/PhotoLibraryOutlined';
import FullscreenGalleryDialog from './fullscreenModes/FullscreenGalleryDialog';
import { SideGroup, SideFacts, SideButtons, SideButton, SIDE } from './layout';
import { useOverlay } from './discover/shared';
import useHomeQuery from './home/useHomeQuery';
import { useGalleryPerformers, useGenres, useGalleryList, formatGb } from './home/homeData';
import { galleryUrl, hasNewUpload } from './home/performerFacts';
import { buildFacets, normalizeFilters, matchesSearch, applyFilters, sortPerformers } from './home/filterModel';
import PerformersTab from './home/PerformersTab';
import GenresTab from './home/GenresTab';

/**
 * The sidebar's Library section: facts summed over the gallery performers, then Group rate and (on the gallery)
 * the slideshow. The Filter list shows it too, without the slideshow. It reads the gallery list as it is; the
 * page's View list loads it. facts=false (the Genres view, which has its own totals): only the buttons.
 */
export function LibraryGroup({ onSlideshow, canShow = false, facts = true }) {
  const list = useGalleryList();
  const rows = useMemo(() => {
    if (!list) return [];
    let pics = 0;
    let vids = 0;
    let gb = 0;
    let fresh = 0;
    for (const p of list) {
      pics += Number(p.pics_count) || 0;
      vids += Number(p.vids_count) || 0;
      gb += Number(p.total_size_gb) || 0;
      if (hasNewUpload(p)) fresh += 1;
    }
    // the performer count is in the View list already (each fact once)
    return [
      { label: 'Pictures', value: pics.toLocaleString() },
      { label: 'Videos', value: vids.toLocaleString() },
      { label: 'Size', value: formatGb(gb) },
      fresh > 0 ? { label: 'New uploads', value: fresh.toLocaleString(), tone: 'accent', title: 'Performers with a new upload on Leakhaven' } : null
    ];
  }, [list]);

  return (
    <SideGroup
      id="library"
      title="Library"
      icon={<PhotoLibraryOutlinedIcon />}
      summary={list ? `${list.length.toLocaleString()} performers` : 'loading'}
      order={SIDE.page}
    >
      {facts ? <SideFacts rows={rows} /> : null}
      <SideButtons>
        <SideButton component={RouterLink} to="/group-rate">Group rate</SideButton>
        {onSlideshow ? (
          <SideButton plain disabled={!canShow} tip={canShow ? undefined : 'Nothing to show'} onClick={onSlideshow}>
            Slideshow
          </SideButton>
        ) : null}
      </SideButtons>
    </SideGroup>
  );
}

/**
 * The Gallery home (`/`, 900px and wider), inside MainPage's SidebarPage: the Performers or the Genres view (the
 * sidebar's View list switches them, ?tab=genres), their Show groups, the Library section and the slideshow.
 * basePath is the library root from MainPage. The lists live in components/home/homeData.js, so a remount shows
 * the last list at once; the query (tab, search, sort, filters) lives in the URL.
 */
export default function GalleryView({ basePath }) {
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

  const showOv = useOverlay('show');

  // A reload never reopens the slideshow without a click.
  useEffect(() => {
    if (showOv.value != null) showOv.set(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the first mount only
  }, []);

  const canShow = performers != null && shownList.length > 0;

  return (
    <>
      {query.tab === 'genres' ? (
        <GenresTab genres={g.genres} error={g.error} reload={g.reload}
          gq={query.gq} gsort={query.gsort} onQuery={query.set} basePath={basePath} />
      ) : (
        <PerformersTab data={data} shown={shown} total={total} newCount={newCount} q={query.q} sort={query.sort}
          filters={filters} facets={facets} onQuery={query.set} basePath={basePath} />
      )}

      <LibraryGroup onSlideshow={() => showOv.open('1')} canShow={canShow} facts={query.tab !== 'genres'} />

      <FullscreenGalleryDialog
        open={showOv.value != null}
        onClose={showOv.close}
        performers={shownList}
        onPhotoClick={(p) => navigate(galleryUrl(p, basePath), { replace: true })}
      />
    </>
  );
}
