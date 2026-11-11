/**
 * The one Discover tile (performers, duplicates sides, uploads) and its controls. Each fact once: chips on the picture,
 * the name on one line, one control row; the border shows the state. Everything else is in the drawer.
 * Styles: discover.css (dv-).
 */
import React, { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import './discover.css';

export const TILE_GRID = 'dv-grid';

const cx = (...names) => names.filter(Boolean).join(' ');
const stop = (e) => e.stopPropagation();

/**
 * tone: 'ok' | 'bad' | 'warn' | 'accent' colours the border. chips: { tl, tr, bl, br } nodes in the picture's corners.
 * meta: one dim line under the name (cut with "…", the same height when empty: pass '' so every tile of the grid has it),
 * metaTip its title; left out when undefined. controls: the control row (clicks in it do not open the tile); left out
 * when null/false.
 */
export function Tile({ title, titleTip, meta, metaTip, image, ariaLabel, onOpen, onPicture, pictureTip, strip, tone, selected, busy, dimmed, chips = {}, controls }) {
  const [failed, setFailed] = useState(null);
  const showImage = !!image && failed !== image;
  const open = () => { if (onOpen) onOpen(); };
  const top = chips.tl || chips.tr;
  const bottom = chips.bl || chips.br;
  return (
    <article
      className={cx('dv-tile', tone, selected && 'selected', busy && 'busy')}
      tabIndex={0}
      aria-label={ariaLabel || title}
      aria-busy={busy || undefined}
      onClick={open}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); open(); } }}
    >
      <div
        className={cx('dv-pic', dimmed && 'dimmed', onPicture && 'opens')}
        title={onPicture ? pictureTip : undefined}
        onClick={onPicture ? (e) => { e.stopPropagation(); onPicture(); } : undefined}
      >
        {showImage
          ? <img src={image} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(image)} />
          : <span className="dv-ph">No picture</span>}
        {top && (
          <div className="dv-corners top">
            {chips.tl && <span className="dv-c l">{chips.tl}</span>}
            {chips.tr && <span className="dv-c r">{chips.tr}</span>}
          </div>
        )}
        {bottom && (
          <div className="dv-corners bottom">
            {chips.bl && <span className="dv-c l">{chips.bl}</span>}
            {chips.br && <span className="dv-c r">{chips.br}</span>}
          </div>
        )}
      </div>
      {strip && <div className="dv-strip" onClick={stop} onKeyDown={stop}>{strip}</div>}
      <div className={cx('dv-name', meta !== undefined && 'with-meta')} title={titleTip || title}>{title}</div>
      {meta !== undefined && <div className="dv-meta" title={metaTip || meta || undefined}>{meta}</div>}
      {controls != null && controls !== false && (
        <div className="dv-row" onClick={stop} onKeyDown={stop}>{controls}</div>
      )}
    </article>
  );
}

/**
 * A chip on a tile's picture. tone: ok | bad | warn | info | accent | dim (default: text colour). With href it is a
 * link (an app path starting with '/' goes through the router, any other opens in a new tab), with onClick a button;
 * their clicks do not reach the tile (Enter on them does not open it either). Other props (aria-*) go on the element.
 */
export function TileChip({ tone, title, href, onClick, children, ...rest }) {
  const cls = cx('dv-chip', tone);
  if (href) {
    return href.startsWith('/')
      ? <RouterLink className={cls} to={href} title={title} onClick={stop} {...rest}>{children}</RouterLink>
      : <a className={cls} href={href} target="_blank" rel="noreferrer" title={title} onClick={stop} {...rest}>{children}</a>;
  }
  if (onClick) {
    return (
      <button type="button" className={cls} title={title} {...rest}
        onClick={(e) => { e.stopPropagation(); onClick(e); }}>
        {children}
      </button>
    );
  }
  return <span className={cls} title={title || undefined} {...rest}>{children}</span>;
}

/** A tile while the list loads: the same height as a tile with a control row (controls={false}: without) and a meta line (meta). */
export function TileSkeleton({ controls = true, meta = false }) {
  return (
    <div className={cx('dv-tile dv-skel', meta && 'with-meta')} aria-hidden>
      <div className="dv-pic" />
      <div className="dv-skel-line" />
      {meta && <div className="dv-skel-line meta" />}
      {controls && <div className="dv-row"><div className="dv-skel-block" /></div>}
    </div>
  );
}

// ── the control row's pieces ─────────────────────────────────
/** The span round a control: a disabled button gets no pointer events, the span still shows why. */
function Tip({ title, size, children }) {
  return <span className={cx('dv-tip', size)} title={title || undefined}>{children}</span>;
}

/** A segmented pair, like the duplicates page's Keep | Remove. */
export function RowSeg({ label, children }) {
  return <div className="dv-seg" role="group" aria-label={label}>{children}</div>;
}

/** One half of a RowSeg. on: ok → an ok ring, bad → a bad-quiet fill. */
export function RowSegBtn({ on, tone = 'ok', disabled, title, onClick, children }) {
  return (
    <Tip title={title} size="grow">
      <button type="button" className={cx('dv-segbtn', tone, on && 'on')} aria-pressed={!!on} disabled={disabled} onClick={onClick}>
        {children}
      </button>
    </Tip>
  );
}

/** A square icon button as high as the row. */
export function RowIcon({ title, ariaLabel, tone, disabled, onClick, children }) {
  return (
    <Tip title={title} size="fixed">
      <button type="button" className={cx('dv-icon', tone)} aria-label={ariaLabel || title} disabled={disabled} onClick={onClick}>
        {children}
      </button>
    </Tip>
  );
}

/** A button with a word that takes the room left in the row. */
export function RowBtn({ primary, tone, disabled, title, icon, onClick, children }) {
  return (
    <Tip title={title} size="grow">
      <button type="button" className={cx('dv-btn', primary && 'primary', tone)} disabled={disabled} onClick={onClick}>
        {icon}{children}
      </button>
    </Tip>
  );
}
