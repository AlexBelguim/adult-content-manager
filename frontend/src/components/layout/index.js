/**
 * Layout primitives — the structural half of the design language.
 *
 * The token pass (styles/tokens.js) unified COLOUR. It could not unify
 * STRUCTURE, and an audit of the 38 pages found:
 *   5 different page-shell wrappers
 *   4 different heading levels used for the page title
 *  15 different content maxWidths
 *  11 different page paddings, 8 different gaps
 *   3 different "panel" metaphors (Paper / Card / raw Box)
 *
 * That is why pages sharing one palette still feel like different products.
 * Build pages out of these primitives and the geometry stops drifting.
 *
 * Usage:
 *   <PageShell>
 *     <PageHeader title="Ranking" subtitle="3,915 pairs" actions={<Button/>} back parent="/" />
 *     <StatRow items={[{label:'Scored', value:'12,480'}]} />
 *     <Section title="Results">
 *       <Panel>…</Panel>
 *     </Section>
 *   </PageShell>
 *
 * Pages with a sidebar use SidebarPage instead (SidebarPage.js: the frame, rail, flyout, phone tabs and sheet;
 * side.js: SideGroup, SideList, SideFacts, SideChecks, SideSearch, SideSelect, SideSegment, SideField,
 * SideButtons/SideButton, SideMain, SideNote, ContentLine; FillGrid.js: grids that meet both edges). All are
 * re-exported here.
 */
import React from 'react';
import { Box, Typography, IconButton, Tooltip, CircularProgress } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
// The nav submodules, not '../../nav': nav/actions imports components/ui, which imports this file.
import useBack from '../../nav/useBack';
import { usePageBar } from '../../nav/pageBar';
import { useChrome } from '../../nav/shell';

/* ─── the one spacing scale ─────────────────────────────────────
   Pages were using 11 padding values and 8 gaps. Use these names
   instead of raw numbers so the rhythm stays even. */
export const SPACE = { xs: 0.5, sm: 1, md: 2, lg: 3, xl: 4 };

/* ─── the one icon scale ────────────────────────────────────────
   PerformerCard alone mixed 14px and 18px icons inside a single card,
   which is why they read as not fitting. Two sizes only:

     inline  — sits next to text (stat counts, meta rows). Slightly
               smaller than the cap height so it doesn't shout.
     action  — sits inside a tappable IconButton.

   `iconBtnSx` pairs `action` with a box big enough to be a real hit
   target. The box is deliberately larger than the glyph: shrinking the
   BUTTON to the icon size is what made these feel cramped. */
export const ICON = { inline: 15, action: 17 };

export const iconBtnSx = (tone = 'var(--dim)', hover = 'var(--text)') => ({
  p: 0,
  width: 26,
  height: 26,
  minWidth: 26,
  flexShrink: 0,
  color: tone,
  borderRadius: 'var(--radius-sm, 4px)',
  '& svg': { width: ICON.action, height: ICON.action },
  '&:hover': { color: hover, bgcolor: 'var(--raised)' }
});

/**
 * A chip that floats ON TOP of media — the rating badge, the age/country
 * badge, score pills over thumbnails.
 *
 * These existed as two independent inline styles on the SAME card: one a 20px
 * pill with a 2px border on hardcoded black, the other a 6px chip with a
 * hairline. Anything overlaying a thumbnail should use this so they cannot
 * drift apart again.
 *
 * Height is intentionally NOT fixed — padding sets it. Pinning the height is
 * what left the country flag with 20px of box for a 20.8px glyph.
 *
 * @param {string} [tone] foreground colour; the border picks it up at low alpha
 */
export const overlayChipSx = (tone = 'var(--text)') => ({
  display: 'flex',
  alignItems: 'center',
  gap: 0.75,
  px: '9px',
  py: '5px',
  borderRadius: 'var(--radius, 6px)',
  // Translucent so the image still reads behind it
  background: 'var(--scrim-strong)',
  backdropFilter: 'blur(8px)',
  border: '1px solid var(--line-strong)',
  boxShadow: 'var(--shadow-md)',
  color: tone,
  fontWeight: 700,
  fontSize: '0.95rem',
  lineHeight: 1,
  fontVariantNumeric: 'tabular-nums'
});

/** The one content width. Wide enough for dense tables, capped so text
 *  lines stay readable on ultrawide displays. */
export const CONTENT_MAX = 1600;

/**
 * Outermost page wrapper. Replaces the five competing shells.
 *
 * @param {boolean} [full]  opt out of the max width (galleries, VR, reader)
 * @param {boolean} [flush] remove padding (full-bleed media pages)
 */
export function PageShell({ children, full = false, flush = false, sx = {}, ...rest }) {
  return (
    <Box
      sx={{
        width: '100%',
        maxWidth: full ? 'none' : CONTENT_MAX,
        mx: 'auto',
        p: flush ? 0 : { xs: SPACE.sm, sm: SPACE.md, md: SPACE.lg },
        minHeight: '100%',
        ...sx
      }}
      {...rest}
    >
      {children}
    </Box>
  );
}

/**
 * Page title block. ONE heading level for every page — the audit found the
 * same semantic thing rendered as h4, h5 and h6 depending on the page.
 *
 *   title       the page title (a string also becomes the phone page bar's title)
 *   subtitle    one line under the title
 *   actions     buttons on the right of the header
 *   back        show a Back arrow, only in the bare chrome (VR): with the app bar, the sidebar's View list is the way back
 *   parent      where Back goes when the app did not push this entry (default: the route table's parent)
 *   onBack      replaces the back rule (nav/useBack) for the arrow and the phone bar
 *   barActions  phone only: nodes in the page bar, right of the title
 *   barMenu     phone only: the page bar's More menu, [{ label, onClick, disabled?, hint?, danger? }]
 *
 * In the phone chrome the page bar shows the title and Back, so the header draws neither: only the
 * subtitle and actions, in a compact row, or nothing when there are neither.
 */
export function PageHeader({ title, titleIsInfo = false, subtitle, actions, back = false, parent, onBack, barActions, barMenu, sx = {} }) {
  const chrome = useChrome();
  const goBack = useBack(parent);
  usePageBar({
    title: typeof title === 'string' ? title : undefined,
    parent,
    onBack,
    actions: barActions,
    menu: barMenu
  });

  if (chrome === 'phone') {
    if (!subtitle && !actions) return null;
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: SPACE.sm,
          flexWrap: 'wrap',
          mb: SPACE.md,
          pb: SPACE.sm,
          borderBottom: '1px solid var(--line)',
          ...sx
        }}
      >
        {subtitle && (
          <Typography variant="body2" sx={{ color: 'var(--dim)', flex: '1 1 auto', minWidth: 0 }}>
            {subtitle}
          </Typography>
        )}
        {actions && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, flexWrap: 'wrap', ml: 'auto' }}>
            {actions}
          </Box>
        )}
      </Box>
    );
  }

  // PC: no big page title, the app bar already says where you are. One compact row instead: Back, a title only
  // when it carries information (titleIsInfo, e.g. "Duplicates: katielefit"), the subtitle line and the actions.
  // A page with none of these draws nothing. The title still names the page for screen readers.
  const shownTitle = titleIsInfo ? title : null;
  // The arrow is drawn only in the bare chrome (no app bar); with the app bar the sidebar's View list leads back.
  const showBack = !!back && chrome === 'bare';
  if (!subtitle && !actions && !shownTitle && !showBack) {
    return typeof title === 'string' ? <Typography component="h1" sx={visuallyHidden}>{title}</Typography> : null;
  }
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: SPACE.md,
        flexWrap: 'wrap',
        mb: SPACE.md,
        pb: SPACE.sm,
        borderBottom: '1px solid var(--line)',
        ...sx
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, minWidth: 0, flex: '1 1 auto' }}>
        {showBack && (
          <Tooltip title="Back">
            <IconButton aria-label="Back" onClick={onBack || goBack} size="small" sx={{ color: 'var(--dim)' }}>
              <ArrowBackIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        {!shownTitle && typeof title === 'string' && <Typography component="h1" sx={visuallyHidden}>{title}</Typography>}
        {shownTitle && (
          <Typography component="h1" sx={{ fontSize: '1rem', fontWeight: 640, color: 'var(--text)', whiteSpace: 'nowrap' }}>
            {shownTitle}
          </Typography>
        )}
        {subtitle && (
          <Typography variant="body2" sx={{ color: 'var(--dim)', minWidth: 0 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {actions && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, flexWrap: 'wrap', ml: 'auto' }}>
          {actions}
        </Box>
      )}
    </Box>
  );
}

const visuallyHidden = {
  position: 'absolute', width: '1px', height: '1px', p: 0, m: '-1px', overflow: 'hidden',
  clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0
};

/** A titled block within a page. Gives every page the same vertical rhythm. */
export function Section({ title, description, actions, children, sx = {} }) {
  return (
    <Box sx={{ mb: SPACE.lg, ...sx }}>
      {(title || actions) && (
        <Box sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: SPACE.md, mb: SPACE.md, flexWrap: 'wrap'
        }}>
          <Box>
            {title && (
              <Typography variant="subtitle1" sx={{ fontWeight: 620, color: 'var(--text)' }}>
                {title}
              </Typography>
            )}
            {description && (
              <Typography variant="caption" sx={{ color: 'var(--muted)' }}>{description}</Typography>
            )}
          </Box>
          {actions && <Box sx={{ display: 'flex', gap: SPACE.sm }}>{actions}</Box>}
        </Box>
      )}
      {children}
    </Box>
  );
}

/**
 * The ONE panel metaphor. Replaces the Paper / Card / raw-Box split.
 * Flat by default — elevation was one of the things that made pages diverge.
 */
export function Panel({ children, padded = true, interactive = false, sx = {}, ...rest }) {
  return (
    <Box
      sx={{
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-lg, 10px)',
        p: padded ? SPACE.md : 0,
        transition: 'border-color .16s ease, background-color .16s ease',
        ...(interactive && {
          cursor: 'pointer',
          '&:hover': { borderColor: 'var(--line-strong)', background: 'var(--raised)' }
        }),
        ...sx
      }}
      {...rest}
    >
      {children}
    </Box>
  );
}

/** Horizontal row of actions / filters directly under the header. */
export function Toolbar({ children, sx = {} }) {
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: SPACE.sm,
      flexWrap: 'wrap', mb: SPACE.md, ...sx
    }}>
      {children}
    </Box>
  );
}

/** A single metric. This app is full of counts and scores. */
export function StatTile({ label, value, tone = 'default', hint }) {
  const toneColor = {
    default: 'var(--text)', accent: 'var(--accent)',
    ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)', info: 'var(--info)'
  }[tone] || 'var(--text)';

  return (
    <Panel padded={false} sx={{ p: SPACE.md, minWidth: 0 }}>
      <Typography
        sx={{ fontSize: '1.35rem', fontWeight: 660, lineHeight: 1.15, color: toneColor,
          fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </Typography>
      <Typography sx={{ fontSize: '.75rem', color: 'var(--dim)', mt: 0.25 }}>{label}</Typography>
      {hint && <Typography sx={{ fontSize: '.75rem', color: 'var(--muted)', mt: 0.25 }}>{hint}</Typography>}
    </Panel>
  );
}

/** Responsive grid of StatTiles. */
export function StatRow({ items = [], min = 150, sx = {} }) {
  return (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`,
      gap: SPACE.sm, mb: SPACE.lg, ...sx
    }}>
      {items.map((it, i) => <StatTile key={it.label ?? i} {...it} />)}
    </Box>
  );
}

/** Consistent empty state — 21 of 38 pages had their own. */
export function EmptyState({ icon, title, description, action, sx = {} }) {
  return (
    <Panel sx={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', textAlign: 'center', py: 6, gap: SPACE.sm, ...sx
    }}>
      {icon && <Box sx={{ color: 'var(--muted)', '& svg': { fontSize: 40 } }}>{icon}</Box>}
      <Typography sx={{ fontWeight: 600, color: 'var(--text)' }}>{title}</Typography>
      {description && (
        <Typography variant="body2" sx={{ color: 'var(--dim)', maxWidth: 420 }}>{description}</Typography>
      )}
      {action && <Box sx={{ mt: SPACE.sm }}>{action}</Box>}
    </Panel>
  );
}

/** Consistent loading state — 34 of 38 pages roll their own. */
export function LoadingState({ label = 'Loading…', sx = {} }) {
  return (
    <Box sx={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', py: 8, gap: SPACE.md, ...sx
    }}>
      <CircularProgress size={28} sx={{ color: 'var(--accent)' }} />
      <Typography variant="body2" sx={{ color: 'var(--dim)' }}>{label}</Typography>
    </Box>
  );
}

export * from './SidebarPage';
export * from './side';
export * from './FillGrid';

const layout = {
  PageShell, PageHeader, Section, Panel, Toolbar,
  StatTile, StatRow, EmptyState, LoadingState, SPACE, CONTENT_MAX
};
export default layout;
