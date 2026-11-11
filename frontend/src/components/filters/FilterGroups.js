/**
 * Filter groups for FiltersDrawer.
 *
 * ChipGroup        tri-state chips (off -> include -> exclude -> off), optional
 *                  collapse ("N more") and a filter box for long lists.
 * RangeGroup       a two-thumb slider that commits on release; a full range is no filter.
 * NumberRangeGroup two number fields that commit on blur or Enter, so typing one
 *                  bound never rewrites the other mid-word (F4-10).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Box, ButtonBase, Slider, TextField } from '@mui/material';
import { TriChip } from './FiltersDrawer';

const sectionSx = {
  py: 1.75,
  borderBottom: '1px solid var(--line)',
  '&:last-of-type': { borderBottom: 0 }
};

const headRowSx = { display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' };
const labelSx = { fontSize: '.8rem', fontWeight: 620, color: 'var(--text)' };
const summarySx = { fontSize: '.75rem', color: 'var(--dim)', fontVariantNumeric: 'tabular-nums' };
const noteSx = { fontSize: '.75rem', color: 'var(--muted)', mt: 1 };

const linkSx = {
  fontSize: '.75rem', color: 'var(--dim)', fontFamily: 'inherit', borderRadius: 'var(--radius-sm, 4px)', px: '2px',
  '&:hover': { color: 'var(--text)' },
  '&.Mui-disabled': { opacity: 0.5 },
  '&.Mui-focusVisible': { outline: '2px solid var(--accent)', outlineOffset: 2 }
};

function TextLink({ children, ...rest }) {
  return <ButtonBase sx={linkSx} {...rest}>{children}</ButtonBase>;
}

function GroupHead({ label, summary, children }) {
  return (
    <Box sx={headRowSx}>
      <Box component="h3" sx={{ ...labelSx, m: 0 }}>{label}</Box>
      {summary && <Box component="span" sx={summarySx}>{summary}</Box>}
      <Box sx={{ flex: '1 1 auto' }} />
      {children}
    </Box>
  );
}

const inputSx = {
  '& .MuiInputBase-root': { height: 32, fontSize: '.84rem', bgcolor: 'var(--bg)', color: 'var(--text)' },
  '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--line-strong)' },
  '& .MuiInputBase-root:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--line-strong)' },
  '& .MuiInputBase-root.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--accent)' }
};

export function ChipGroup({
  label, values = [], stateOf, onCycle, onReset, extraActions = [], note,
  collapseAfter = Infinity, searchable = false, emptyText = 'No values'
}) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);

  const states = useMemo(() => values.map((v) => stateOf(v.value) || 'off'), [values, stateOf]);
  const included = states.filter((s) => s === 'include').length;
  const excluded = states.filter((s) => s === 'exclude').length;
  const anyActive = included + excluded > 0;
  const summary = [included ? `${included} included` : null, excluded ? `${excluded} excluded` : null].filter(Boolean).join(', ');

  const canSearch = searchable && values.length > collapseAfter;
  const q = canSearch ? query.trim().toLowerCase() : '';
  const collapsible = values.length > collapseAfter;

  let shown;
  if (q) {
    shown = values
      .map((v, i) => ({ v, s: states[i] }))
      .filter(({ v }) => String(v.label ?? v.value).toLowerCase().includes(q));
  } else if (expanded || !collapsible) {
    shown = values.map((v, i) => ({ v, s: states[i] }));
  } else {
    shown = values
      .map((v, i) => ({ v, s: states[i], i }))
      .filter(({ s, i }) => i < collapseAfter || s !== 'off');
  }
  const hiddenCount = q ? 0 : values.length - shown.length;

  return (
    <Box component="section" sx={sectionSx}>
      <GroupHead label={label} summary={anyActive ? summary : null}>
        {extraActions.map((a) => (
          <TextLink key={a.label} onClick={a.onClick} disabled={!!a.disabled}>{a.label}</TextLink>
        ))}
        {anyActive && onReset && <TextLink onClick={onReset} aria-label={`Reset ${label}`}>Reset</TextLink>}
      </GroupHead>

      {canSearch && (
        <TextField
          size="small"
          fullWidth
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Filter ${String(label).toLowerCase()}`}
          slotProps={{ htmlInput: { 'aria-label': `Filter ${String(label).toLowerCase()}` } }}
          sx={{ mb: 1, ...inputSx }}
        />
      )}

      {values.length === 0 ? (
        <Box sx={{ fontSize: '.78rem', color: 'var(--muted)' }}>{emptyText}</Box>
      ) : shown.length === 0 ? (
        <Box sx={{ fontSize: '.78rem', color: 'var(--muted)' }}>{`Nothing matches "${query.trim()}"`}</Box>
      ) : (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
          {shown.map(({ v, s }) => (
            <TriChip
              key={String(v.value)}
              label={String(v.label ?? v.value)}
              count={v.count}
              state={s}
              onClick={() => onCycle(v.value)}
            />
          ))}
          {!q && hiddenCount > 0 && (
            <ButtonBase onClick={() => setExpanded(true)} sx={{ ...linkSx, fontSize: '.76rem', color: 'var(--accent)', px: 0.5, '&:hover': { color: 'var(--accent)', textDecoration: 'underline' } }}>
              {`${hiddenCount} more`}
            </ButtonBase>
          )}
          {!q && expanded && collapsible && (
            <ButtonBase onClick={() => setExpanded(false)} sx={{ ...linkSx, fontSize: '.76rem', color: 'var(--accent)', px: 0.5, '&:hover': { color: 'var(--accent)', textDecoration: 'underline' } }}>
              Show fewer
            </ButtonBase>
          )}
        </Box>
      )}

      {note && <Box sx={noteSx}>{note}</Box>}
    </Box>
  );
}

const withUnit = (n, unit) => `${n}${unit ? ` ${unit}` : ''}`;

export function RangeGroup({ label, min, max, value, unit = '', note, onCommit, step = 1 }) {
  const lo0 = value ? value[0] : min;
  const hi0 = value ? value[1] : max;
  const [local, setLocal] = useState([lo0, hi0]);

  useEffect(() => { setLocal([lo0, hi0]); }, [lo0, hi0]);

  const commit = (_e, v) => {
    const [lo, hi] = Array.isArray(v) ? v : [v, v];
    if (lo <= min && hi >= max) onCommit(null);
    else onCommit([lo, hi]);
  };

  return (
    <Box component="section" sx={sectionSx}>
      <GroupHead label={label} summary={value ? `${value[0]}–${withUnit(value[1], unit)}` : 'Any'}>
        {value && <TextLink onClick={() => onCommit(null)} aria-label={`Reset ${label}`}>Reset</TextLink>}
      </GroupHead>
      <Box sx={{ px: 1 }}>
        <Slider
          value={local}
          min={min}
          max={max}
          step={step}
          valueLabelDisplay="auto"
          getAriaLabel={(i) => (i ? `${label} maximum` : `${label} minimum`)}
          onChange={(_e, v) => setLocal(v)}
          onChangeCommitted={commit}
          sx={{
            color: 'var(--accent)',
            '& .MuiSlider-rail': { bgcolor: 'var(--line-strong)', opacity: 1 },
            '& .MuiSlider-thumb': {
              width: 16, height: 16, bgcolor: 'var(--text)', border: '2px solid var(--accent)',
              '&:hover, &.Mui-focusVisible': { boxShadow: '0 0 0 6px var(--accent-quiet)' }
            },
            '& .MuiSlider-valueLabel': { fontSize: '.75rem', bgcolor: 'var(--raised)', color: 'var(--text)' }
          }}
        />
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: '.75rem', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
        <span>{withUnit(min, unit)}</span>
        <span>{withUnit(max, unit)}</span>
      </Box>
      {note && <Box sx={noteSx}>{note}</Box>}
    </Box>
  );
}

const toText = (n) => (n === null || n === undefined ? '' : String(n));

function BoundField({ label, bound, propValue, onChange, min, max, step }) {
  const propText = toText(propValue);
  const [text, setText] = useState(propText);
  const [focused, setFocused] = useState(false);

  // Follow the parent when it changes the value (a reset, a clamp after a commit),
  // and fall back to it when the field loses focus. Typing only changes `text`,
  // so the other bound is never rewritten mid-word.
  useEffect(() => { setText(propText); }, [propText, focused]);

  const commit = () => { if (text !== propText) onChange(bound, text); };

  return (
    <TextField
      type="number"
      size="small"
      value={text}
      placeholder={bound === 'min' ? 'Min' : 'Max'}
      onChange={(e) => setText(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); commit(); }}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
      slotProps={{
        htmlInput: {
          min, max, step, inputMode: 'decimal',
          'aria-label': `${label} ${bound === 'min' ? 'minimum' : 'maximum'}`
        }
      }}
      sx={{ width: 96, ...inputSx }}
    />
  );
}

export function NumberRangeGroup({ label, value, active, onChange, onReset, min = 0, max = 10, step = 0.1 }) {
  const v = value || { min: null, max: null };
  return (
    <Box component="section" sx={sectionSx}>
      <GroupHead label={label} summary={active ? `${v.min ?? 'any'} to ${v.max ?? 'any'}` : 'Any'}>
        {active && <TextLink onClick={onReset} aria-label={`Reset ${label}`}>Reset</TextLink>}
      </GroupHead>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <BoundField label={label} bound="min" propValue={v.min} onChange={onChange} min={min} max={max} step={step} />
        <Box component="span" sx={{ fontSize: '.8rem', color: 'var(--dim)' }}>to</Box>
        <BoundField label={label} bound="max" propValue={v.max} onChange={onChange} min={min} max={max} step={step} />
      </Box>
    </Box>
  );
}
