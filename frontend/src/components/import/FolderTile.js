/**
 * One folder of "before upload" on the Import page's server tab: the Discover tile (components/discover/Tile.js) with
 * the match on the picture, the counts as chips and one control row (Select, Change the name).
 *
 *   folder: { name, match, job, details, detailsError, loading, override, checking, checkError }
 *   facts:  folderFacts(folder) (below): what the tile, the selection and the bar read
 *   onToggle(name), onRename(name), onReload(name), onPictures(name, index): stable callbacks (the tile is memoised)
 *
 * The picture opens her pictures (the viewer), and a strip of the next four sits under it; the counts and the size are
 * the line under the name. Only the match is on the picture. Select is in the control row.
 */
import React, { memo } from 'react';
import EditOutlined from '@mui/icons-material/EditOutlined';
import { Tile, TileChip, RowBtn, RowIcon } from '../discover/Tile';
import { fmtGb, matchChip } from './importApi';

/** The counts a folder's details give: shown videos include the funscript videos. */
export function countsOf(details) {
  const s = details?.stats || {};
  const pics = s.pics_count || 0;
  const vids = (s.vids_count || 0) + (s.funscript_vids_count || 0);
  const scripts = s.funscript_files_count || 0;
  return { pics, vids, scripts, total: pics + vids + scripts };
}

/**
 * What a folder is now: importable or not, and why not (the Select button's tip).
 * Importable: details read, something supported in it, no job, the name check settled, and the match new or existing.
 */
export function folderFacts(f) {
  const counts = countsOf(f.details);
  const unsupportedOnly = !!f.details && counts.total === 0;
  const kind = f.match?.kind;
  let reason = null;
  if (f.job) reason = f.job.status === 'processing' ? 'Importing now' : 'Already queued';
  else if (f.detailsError) reason = 'Could not read the folder';
  else if (f.checkError) reason = f.checkError;
  else if (f.checking || !f.match) reason = 'Checking the name…';
  else if (kind === 'blacklisted') reason = `Blacklisted: ${f.match.reason || 'no reason given'}`;
  else if (kind === 'invalid') reason = f.match.reason || 'Name not allowed';
  else if (kind !== 'new' && kind !== 'existing') reason = 'Name not allowed';
  else if (!f.details) reason = 'Reading the folder…';
  else if (unsupportedOnly) reason = 'Nothing here can be imported';
  return { counts, unsupportedOnly, importable: !reason, reason };
}

function FolderTile({ folder: f, selected, onToggle, onRename, onReload, onPictures }) {
  const { counts, unsupportedOnly, importable, reason } = folderFacts(f);
  const shown = f.override || f.name;
  const details = f.details;
  const previews = details?.previewImages || [];
  const other = details?.other;
  const kind = f.match?.kind;

  const size = details?.stats?.total_size_gb;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  // The line under the name: what is in it first, then what stays behind and a renamed folder
  const meta = f.loading ? 'Reading…' : [
    details && counts.pics > 0 ? plural(counts.pics, 'pic', 'pics') : null,
    details && counts.vids > 0 ? plural(counts.vids, 'vid', 'vids') : null,
    details && counts.scripts > 0 ? plural(counts.scripts, 'script', 'scripts') : null,
    details && size > 0 ? fmtGb(size) : null,
    other && other.count > 0
      ? `${other.count} other ${other.count === 1 ? 'file stays' : 'files stay'}${other.exts?.length ? ` (${other.exts.join(', ')})` : ''}`
      : null,
    f.override ? `folder: ${f.name}` : null
  ].filter(Boolean).join(' · ');

  const chip = f.checkError && !f.job
    ? { text: 'Not checked', tone: 'warn', title: f.checkError }
    : matchChip(f.match, { checking: f.checking || !f.match, job: f.job, unsupportedOnly });

  const bl = f.detailsError ? <TileChip tone="bad" title={f.detailsError}>Could not read</TileChip> : null;

  // The next four pictures under the cover; the last one says how many more there are. Always four places, so every
  // tile is the same height.
  const more = Math.max(0, counts.pics - 5);
  const strip = [1, 2, 3, 4].map(i => {
    const p = previews[i];
    if (!p) return <span key={i} className="im-th empty" />;
    const last = i === 4 && more > 0;
    return (
      <button
        key={i}
        type="button"
        className="im-th"
        title={last ? `${more} more pictures` : 'Show this picture'}
        aria-label={last ? `Show the pictures, ${more} more` : `Show picture ${i + 1}`}
        onClick={() => onPictures(f.name, i)}
      >
        <img src={`/api/files/preview?path=${encodeURIComponent(p)}`} alt="" loading="lazy" decoding="async" draggable={false} />
        {last && <span className="im-more">+{more}</span>}
      </button>
    );
  });

  const tone = selected ? 'accent'
    : (kind === 'blacklisted' || kind === 'invalid') ? 'bad'
      : f.detailsError ? 'warn' : undefined;

  return (
    <Tile
      title={shown}
      titleTip={`Folder: ${f.name}`}
      meta={meta}
      image={previews[0] ? `/api/files/preview?path=${encodeURIComponent(previews[0])}` : undefined}
      ariaLabel={`${shown}${selected ? ', selected' : ''}`}
      tone={tone}
      selected={selected}
      dimmed={!!f.job || unsupportedOnly}
      onOpen={importable ? () => onToggle(f.name) : undefined}
      onPicture={previews.length > 0 ? () => onPictures(f.name, 0) : undefined}
      pictureTip="Show the pictures"
      strip={strip}
      chips={{
        // The match chip is cut first on a narrow tile, so its tip carries the whole text
        tl: chip ? <TileChip tone={chip.tone} title={chip.title && chip.title !== chip.text ? `${chip.text} · ${chip.title}` : chip.text}>{chip.text}</TileChip> : null,
        bl
      }}
      controls={(
        <>
          {f.detailsError
            ? <RowBtn onClick={() => onReload(f.name)}>Read again</RowBtn>
            : (
              <RowBtn primary={selected} disabled={!importable} title={reason || undefined} onClick={() => onToggle(f.name)}>
                {selected ? 'Selected' : 'Select'}
              </RowBtn>
            )}
          <RowIcon title="Change the name" disabled={!!f.job} onClick={() => onRename(f.name)}>
            <EditOutlined fontSize="inherit" />
          </RowIcon>
        </>
      )}
    />
  );
}

export default memo(FolderTile);
