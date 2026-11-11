/**
 * Settings > Appearance: the theme, kept in this browser (localStorage 'appTheme', through shell.setTheme).
 */
import React from 'react';
import { Box, ButtonBase } from '@mui/material';
import { Section } from '../layout';
import { useShell } from '../../nav';
import { themes } from '../../theme';
import { LocalMark, SaveNote, useSave } from './kit';

const swatchSx = (color) => ({
  width: 14, height: 14, flexShrink: 0, bgcolor: color,
  border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-sm, 4px)'
});

export default function AppearanceSection() {
  const shell = useShell();
  const { state, error, run } = useSave();

  const pick = (id) => {
    if (id === shell.themeId) return;
    shell.setTheme(id);
    run(async () => {});
  };

  return (
    <Section
      title="Theme"
      description="Colours and corner radius everywhere."
      actions={(
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <LocalMark />
          <SaveNote state={state} error={error} />
        </Box>
      )}
    >
      <Box role="radiogroup" aria-label="Theme" sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 1 }}>
        {Object.entries(themes).map(([id, t]) => {
          const active = id === shell.themeId;
          return (
            <ButtonBase
              key={id}
              role="radio"
              aria-checked={active}
              onClick={() => pick(id)}
              sx={{
                height: 64, px: 1.5, gap: 1.5, justifyContent: 'flex-start', textAlign: 'left',
                border: '1px solid', borderColor: active ? 'var(--accent)' : 'var(--line)',
                borderRadius: 'var(--radius-lg, 10px)', bgcolor: 'var(--surface)',
                boxShadow: active ? 'inset 0 0 0 1px var(--accent)' : 'none',
                '&:hover': { bgcolor: 'var(--raised)' },
                '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: 2 }
              }}
            >
              <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
                <Box sx={swatchSx(t.tokens.bg)} />
                <Box sx={swatchSx(t.tokens.surface)} />
                <Box sx={swatchSx(t.tokens.accent)} />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Box sx={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>{t.label}</Box>
                <Box sx={{ fontSize: 12, color: 'var(--dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.desc}</Box>
              </Box>
            </ButtonBase>
          );
        })}
      </Box>
    </Section>
  );
}
