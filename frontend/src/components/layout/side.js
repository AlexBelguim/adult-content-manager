/**
 * The sidebar's parts. All go inside a SideGroup, which SidebarPage draws in the sidebar, the rail's flyout or the
 * phone sheet (never where it sits in the tree). Tokens only; text 12px and up.
 *
 *   <SideGroup id="show" title="Show" icon={<FilterListIcon/>} badge={2} dot={null|'ok'|'warn'|'bad'} summary="2 on" order={SIDE.show}>…</SideGroup>
 *   <SideList label="Kind" items={[{ id, label, count?, sub?, icon?, to?, replace?, state?, onClick?, disabled?, dim?, title? }]} value onChange={(id)=>…} />
 *   <SideFacts rows={[{ label, value, tone?: 'ok'|'warn'|'bad'|'accent', title? }]} />
 *   <SideChecks items={[{ id, label, checked, onChange: (bool)=>…, title?, disabled?, count? }]} />
 *   <SideSearch value onChange placeholder phoneRow={true} />
 *   <SideSelect label value onChange options={[{ value, label }]} />
 *   <SideSegment label value onChange options={[{ id, label, count? }]} />
 *   <SideField label="Every" hint?>{control}</SideField>
 *   <SideButtons columns={1|2}><SideButton plain? danger? icon? tip? disabled? onClick | component={RouterLink} to | href>Label</SideButton></SideButtons>
 *   <SideMain label="Scan now" icon={<SearchIcon/>} onClick disabled? tip? busy? busyLabel? />
 *   <SideNote>text</SideNote>
 *   <ContentLine title="Performers" meta="13,018 to decide · score, high to low" actions={<…/>} />
 */
import React, { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Box, ButtonBase, InputBase, MenuItem, Select, Tooltip, Typography } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import { useChrome } from '../../nav/shell';
import {
  SIDE, SidebarApiContext, SidebarModeContext, NavItem, ItemContent, MainButton, FiltersButton,
  itemRowSx, groupHeadSx, visuallyHiddenSx
} from './SidebarPage';

const focusRing = { outline: '2px solid var(--accent)', outlineOffset: '-2px' };

/* ─── SideGroup ───────────────────────────────────────────────── */
/**
 * Registers with the nearest SidebarPage and portals its children into that group's persistent node. Render a group
 * only while its tab or view is active: mounted means shown. Outside a SidebarPage it draws inline with its heading.
 */
export function SideGroup({ id, title = '', icon = null, badge = null, dot = null, summary = '', order = SIDE.page, children }) {
  const api = useContext(SidebarApiContext);

  // Every render: keep the meta up to date (the frame ignores an unchanged one).
  useLayoutEffect(() => {
    if (api) api.register(id, { title, icon, badge, dot, summary, order });
  });
  useLayoutEffect(() => {
    if (!api) return undefined;
    return () => api.unregister(id);
  }, [api, id]);

  if (!api) {
    return (
      <Box sx={{ mb: '20px' }}>
        {title ? <Typography component="h2" sx={groupHeadSx}>{title}</Typography> : null}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>{children}</Box>
      </Box>
    );
  }
  return createPortal(children, api.nodeFor(id));
}

/* ─── SideList ────────────────────────────────────────────────── */
/** A second list, rows like the View list. An item with `to` is a Link; otherwise onChange(id). heading: an optional visible label. */
export function SideList({ label, heading, items = [], value, onChange, sx }) {
  return (
    <Box role="group" aria-label={label} sx={{ display: 'flex', flexDirection: 'column', minWidth: 0, ...sx }}>
      {heading ? (
        <Box sx={{ fontSize: 12, color: 'var(--muted)', px: '8px', mb: '2px' }}>{heading}</Box>
      ) : null}
      {items.filter(Boolean).map((it) => {
        const on = it.id === value;
        return (
          <NavItem
            key={it.id}
            item={it}
            pressed={on}
            onSelect={onChange}
            sx={itemRowSx(on, { dim: !!it.dim, disabled: !!it.disabled })}
          >
            <ItemContent item={it} showIcon />
          </NavItem>
        );
      })}
    </Box>
  );
}

/* ─── SideFacts ───────────────────────────────────────────────── */
const toneColor = (t) => ({
  ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)', accent: 'var(--accent)', info: 'var(--info)'
}[t] || 'var(--text)');

/** Label/value rows. Falsy rows are skipped. */
export function SideFacts({ rows = [], sx }) {
  const shown = rows.filter(Boolean);
  if (!shown.length) return null;
  return (
    <Box component="dl" sx={{ m: 0, px: '8px', minWidth: 0, ...sx }}>
      {shown.map((r, i) => (
        <Box
          key={r.key ?? (typeof r.label === 'string' ? r.label : i)}
          title={r.title}
          sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px', fontSize: 13, py: '3px', lineHeight: 1.4 }}
        >
          <Box component="dt" sx={{ m: 0, color: 'var(--dim)', minWidth: 0, flexShrink: 0 }}>{r.label}</Box>
          <Box component="dd" sx={{
            m: 0, minWidth: 0, color: toneColor(r.tone), fontWeight: 600, fontVariantNumeric: 'tabular-nums',
            textAlign: 'right', overflowWrap: 'anywhere'
          }}>
            {r.value}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

/* ─── SideChecks ──────────────────────────────────────────────── */
export function SideChecks({ items = [], sx }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0, ...sx }}>
      {items.filter(Boolean).map((it) => {
        const on = !!it.checked;
        return (
          <ButtonBase
            key={it.id}
            role="checkbox"
            aria-checked={on}
            disabled={!!it.disabled}
            title={it.title}
            onClick={() => it.onChange?.(!on)}
            disableRipple
            sx={{
              display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '8px', width: '100%', height: 30,
              px: '8px', borderRadius: 'var(--radius)', fontSize: 13, fontFamily: 'inherit', textAlign: 'left',
              color: on ? 'var(--text)' : 'var(--dim)',
              '&:hover': { bgcolor: 'var(--raised)', color: 'var(--text)' },
              '&:focus-visible': focusRing,
              '&.Mui-disabled': { opacity: 0.5 }
            }}
          >
            <Box component="span" aria-hidden sx={{
              width: 14, height: 14, flexShrink: 0, borderRadius: '3px', boxSizing: 'border-box',
              border: '1px solid', borderColor: on ? 'var(--accent)' : 'var(--line-strong)',
              bgcolor: on ? 'var(--accent)' : 'transparent', color: 'var(--on-accent)',
              display: 'grid', placeItems: 'center', '& svg': { fontSize: 12 }
            }}>
              {on ? <CheckIcon /> : null}
            </Box>
            <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</Box>
            {it.count != null ? (
              <Box component="span" sx={{ ml: 'auto', pl: '8px', fontSize: 13, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
                {typeof it.count === 'number' ? it.count.toLocaleString() : it.count}
              </Box>
            ) : null}
          </ButtonBase>
        );
      })}
    </Box>
  );
}

/* ─── fields ──────────────────────────────────────────────────── */
const fieldBoxSx = {
  width: '100%', height: 32, fontSize: 13, color: 'var(--text)', bgcolor: 'var(--bg)',
  border: '1px solid var(--line)', borderRadius: 'var(--radius)', boxSizing: 'border-box',
  transition: 'border-color .12s ease',
  '&:hover': { borderColor: 'var(--line-strong)' },
  '&.Mui-focused': { borderColor: 'var(--accent)' }
};

let searchSeq = 0;

/** Search, a quarter of a second after the typing stops. On the phone (phoneRow) it sits in the row over the content. */
export function SideSearch({ value = '', onChange, placeholder = 'Search', phoneRow = true, sx }) {
  const api = useContext(SidebarApiContext);
  const modeCtx = useContext(SidebarModeContext);
  const [text, setText] = useState(value ?? '');
  const timer = useRef(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const keyRef = useRef(null);
  if (!keyRef.current) {
    searchSeq += 1;
    keyRef.current = `search-${searchSeq}`;
  }

  useEffect(() => { setText(value ?? ''); }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const inRow = !!(api && modeCtx && modeCtx.mode === 'phone' && modeCtx.phoneRow && phoneRow);
  useLayoutEffect(() => {
    if (!inRow) return undefined;
    const k = keyRef.current;
    api.registerSearch(k);
    return () => api.unregisterSearch(k);
  }, [inRow, api]);

  const field = (
    <InputBase
      type="search"
      value={text}
      placeholder={placeholder}
      inputProps={{ 'aria-label': placeholder, enterKeyHint: 'search' }}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => onChangeRef.current?.(next), 250);
      }}
      sx={{
        ...fieldBoxSx,
        ...(inRow ? { height: 40, fontSize: 14 } : null),
        '& input': { px: '10px', py: 0, height: '100%', boxSizing: 'border-box' },
        '& input::placeholder': { color: 'var(--muted)', opacity: 1 },
        ...sx
      }}
    />
  );
  if (inRow) return createPortal(field, api.searchNodeFor(keyRef.current));
  return <Box sx={{ px: '8px', minWidth: 0 }}>{field}</Box>;
}

/** A full-width 32px select. */
export function SideSelect({ label, value, onChange, options = [], sx }) {
  return (
    <Box sx={{ px: '8px', minWidth: 0 }}>
      <Select
        size="small"
        fullWidth
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        inputProps={{ 'aria-label': label }}
        MenuProps={{
          slotProps: {
            paper: {
              sx: {
                bgcolor: 'var(--overlay)', backgroundImage: 'none', color: 'var(--text)',
                border: '1px solid var(--line-strong)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-md)'
              }
            }
          }
        }}
        sx={{
          height: 32, fontSize: 13, color: 'var(--text)', bgcolor: 'var(--bg)', borderRadius: 'var(--radius)',
          '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--line)' },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--line-strong)' },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--accent)', borderWidth: '1px' },
          '& .MuiSelect-select': { py: 0, pl: '10px', minHeight: 0, display: 'flex', alignItems: 'center', height: '100%' },
          '& .MuiSelect-icon': { color: 'var(--dim)' },
          ...sx
        }}
      >
        {options.filter(Boolean).map((o) => (
          <MenuItem key={o.value} value={o.value} disabled={!!o.disabled} sx={{ fontSize: 13, minHeight: 34 }}>{o.label}</MenuItem>
        ))}
      </Select>
    </Box>
  );
}

/** A full-width segmented control: equal widths, the selected one in the accent's quiet colour. */
export function SideSegment({ label, value, onChange, options = [], sx }) {
  return (
    <Box sx={{ px: '8px', minWidth: 0 }}>
      <Box role="radiogroup" aria-label={label} sx={{
        display: 'flex', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden', ...sx
      }}>
        {options.filter(Boolean).map((o) => {
          const on = o.id === value;
          return (
            <ButtonBase
              key={o.id}
              role="radio"
              aria-checked={on}
              disabled={!!o.disabled}
              title={o.title}
              onClick={() => { if (!on) onChange?.(o.id); }}
              disableRipple
              sx={{
                flex: '1 1 0', minWidth: 0, height: 30, px: '6px', fontSize: 13, fontFamily: 'inherit', whiteSpace: 'nowrap',
                color: on ? 'var(--text)' : 'var(--dim)', bgcolor: on ? 'var(--accent-quiet)' : 'transparent',
                '&:hover': { color: 'var(--text)', bgcolor: on ? 'var(--accent-quiet)' : 'var(--raised)' },
                '&:focus-visible': focusRing,
                '&.Mui-disabled': { opacity: 0.5 }
              }}
            >
              <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {o.label}
                {o.count != null ? (
                  <Box component="span" sx={{ ml: '4px', fontVariantNumeric: 'tabular-nums', color: on ? 'var(--text)' : 'var(--muted)' }}>
                    {typeof o.count === 'number' ? o.count.toLocaleString() : o.count}
                  </Box>
                ) : null}
              </Box>
            </ButtonBase>
          );
        })}
      </Box>
    </Box>
  );
}

/** One row: the label on the left, any control (number field, Switch, Slider) on the right; an optional hint under it. */
export function SideField({ label, hint, children, sx }) {
  return (
    <Box sx={{ px: '8px', minWidth: 0, ...sx }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', minHeight: 30, fontSize: 13, color: 'var(--dim)' }}>
        <Box component="span" sx={{ flexShrink: 0 }}>{label}</Box>
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>{children}</Box>
      </Box>
      {hint ? <Box sx={{ fontSize: 12, color: 'var(--muted)', mt: '2px' }}>{hint}</Box> : null}
    </Box>
  );
}

/* ─── buttons ─────────────────────────────────────────────────── */
export function SideButtons({ columns = 1, children, sx }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: '6px', px: '8px', minWidth: 0, ...sx }}>
      {children}
    </Box>
  );
}

const sideButtonSx = ({ plain, danger }) => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px', width: '100%', height: 32,
  px: '12px', minWidth: 0, borderRadius: 'var(--radius)', border: '1px solid',
  borderColor: plain ? 'transparent' : 'var(--line-strong)', bgcolor: 'transparent',
  color: danger ? 'var(--bad)' : plain ? 'var(--dim)' : 'var(--text)',
  fontSize: 13, fontWeight: 600, fontFamily: 'inherit', whiteSpace: 'nowrap', textDecoration: 'none',
  '&:hover': { bgcolor: 'var(--raised)', color: danger ? 'var(--bad)' : 'var(--text)' },
  '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: '2px' },
  '&.Mui-disabled': { opacity: 0.5 },
  '& svg': { fontSize: 16, width: 16, height: 16, flexShrink: 0 },
  '& .sb-label': { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }
});

/** 32px. plain: no border, dim. danger: the bad colour. tip: a Tooltip that works when disabled. */
export const SideButton = React.forwardRef(function SideButton(
  { plain = false, danger = false, icon = null, tip, disabled = false, children, sx, ...rest }, ref
) {
  const btn = (
    <ButtonBase ref={ref} disabled={disabled} disableRipple sx={{ ...sideButtonSx({ plain, danger }), ...sx }} {...rest}>
      {icon}
      <span className="sb-label">{children}</span>
    </ButtonBase>
  );
  if (!tip) return btn;
  return (
    <Tooltip title={tip}>
      <Box component="span" sx={{ display: 'block', minWidth: 0 }}>{btn}</Box>
    </Tooltip>
  );
});

/**
 * The page's one main action, drawn where it is placed. It also registers with the frame for the rail's accent
 * button (on a phone it shows once, inside its group in the Filters sheet). The latest mounted wins.
 */
export function SideMain({ label, icon = null, onClick, disabled = false, tip, busy = false, busyLabel, sx }) {
  const api = useContext(SidebarApiContext);
  const cb = useRef(onClick);
  cb.current = onClick;
  const run = useRef(null);
  if (!run.current) run.current = (e) => cb.current?.(e);
  const key = useRef(null);
  if (!key.current) key.current = Symbol('sideMain');

  useLayoutEffect(() => {
    if (api) api.registerMain(key.current, { label, icon, disabled: !!disabled, tip, busy: !!busy, busyLabel, run: run.current });
  });
  useLayoutEffect(() => {
    if (!api) return undefined;
    const k = key.current;
    return () => api.unregisterMain(k);
  }, [api]);

  const main = { label, icon, disabled: !!disabled, tip, busy: !!busy, busyLabel, run: run.current };
  return (
    <Box sx={{ px: '8px', minWidth: 0 }}>
      <MainButton main={main} block sx={sx} />
    </Box>
  );
}

export function SideNote({ children, sx }) {
  return (
    <Box sx={{ fontSize: 12, lineHeight: 1.45, color: 'var(--muted)', px: '8px', minWidth: 0, ...sx }}>{children}</Box>
  );
}

/* ─── ContentLine ─────────────────────────────────────────────── */
/** The one thin line over the items: what is shown, and that view's own actions on its right. */
export function ContentLine({ title, meta, actions, sx }) {
  const modeCtx = useContext(SidebarModeContext);
  const api = useContext(SidebarApiContext);
  const chrome = useChrome();
  const phone = modeCtx ? modeCtx.mode === 'phone' : chrome === 'phone';
  const filtersHere = phone && !!modeCtx?.filtersInLine;

  // The frame learns there is a line, so on a phone page without a search it can put Filters on it.
  const key = useRef(null);
  if (!key.current) key.current = Symbol('contentLine');
  useLayoutEffect(() => {
    if (!api) return undefined;
    const k = key.current;
    api.registerLine(k);
    return () => api.unregisterLine(k);
  }, [api]);

  const metaEl = meta != null && meta !== '' ? (
    <Box sx={{
      // the meta gives way first (shrink 1000), then the title
      fontSize: 13, color: 'var(--muted)', minWidth: 0, flex: '0 1000 auto', overflow: 'hidden', textOverflow: 'ellipsis',
      whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums'
    }} title={typeof meta === 'string' ? meta : undefined}>
      {meta}
    </Box>
  ) : null;
  const actionsEl = actions ? (
    <Box className="cl-actions" sx={{
      ml: 'auto', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0,
      ...(phone ? { flexWrap: 'wrap', justifyContent: 'flex-end', flexShrink: 1, minWidth: 0 } : null)
    }}>
      {actions}
    </Box>
  ) : null;

  if (phone) {
    return (
      <>
        {title ? <Typography component="h2" sx={visuallyHiddenSx}>{title}</Typography> : null}
        {metaEl || actionsEl || filtersHere ? (
          // With Filters here and actions too: meta and Filters on the first row, the actions on a row of their own.
          <Box sx={{
            display: 'flex', alignItems: 'center', gap: '8px', minHeight: 32, mb: '12px', minWidth: 0, flexShrink: 0,
            ...(filtersHere && actionsEl ? { flexWrap: 'wrap', '& > .cl-actions': { order: 2, flexBasis: '100%', ml: 0, justifyContent: 'flex-start' } } : null),
            ...sx
          }}>
            {metaEl ? <Box sx={{ flex: '1 1 0', minWidth: 0, display: 'flex' }}>{metaEl}</Box> : <Box sx={{ flex: 1 }} />}
            {actionsEl}
            {filtersHere ? <FiltersButton sx={{ height: 36, order: 1 }} /> : null}
          </Box>
        ) : null}
      </>
    );
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px', height: 32, mb: '16px', minWidth: 0, flexShrink: 0, ...sx }}>
      {title ? (
        <Typography
          component="h2"
          title={typeof title === 'string' ? title : undefined}
          sx={{
            fontSize: 15, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', lineHeight: 1.3,
            flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis'
          }}
        >
          {title}
        </Typography>
      ) : null}
      {metaEl}
      {actionsEl}
    </Box>
  );
}
