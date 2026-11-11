import React, { useState } from 'react';
import { Box, IconButton, Typography, Menu, MenuItem, ListItemText } from '@mui/material';
import { ArrowBack, MoreVert } from '@mui/icons-material';
import { useLocation } from 'react-router-dom';
import { useBack, titleOf, usePageBarValue } from '../nav';

/**
 * The phone page bar: Back, the page title, the page's own actions and, when the page registered one, its
 * overflow menu. The app's own More is the bottom tab, so this More is never a second copy of the app menu.
 * A page fills it through usePageBar (PageHeader does that for most pages). data-app-bar marks it, like the
 * desktop app bar, for pages that keep a sticky bar of their own under it.
 */
const LIST_ROUTES = ['/', '/filter', '/pairs'];

export default function PhoneBar() {
  const bar = usePageBarValue();
  const { pathname } = useLocation();
  const back = useBack(bar?.parent);
  const [menuAnchor, setMenuAnchor] = useState(null);

  const showBack = !LIST_ROUTES.includes(pathname);
  const menu = Array.isArray(bar?.menu) ? bar.menu : [];
  const title = bar?.title || titleOf(pathname);

  const choose = (item) => {
    setMenuAnchor(null);
    item.onClick?.();
  };

  return (
    <Box
      component="header"
      data-app-bar=""
      sx={{
        position: 'sticky', top: 0, zIndex: 1100,
        bgcolor: 'var(--bg)', borderBottom: '1px solid var(--line)',
        paddingTop: 'env(safe-area-inset-top)'
      }}
    >
      <Box sx={{ height: 48, px: 0.5, gap: 0.5, display: 'flex', alignItems: 'center', minWidth: 0 }}>
        {showBack && (
          <IconButton
            aria-label="Back"
            onClick={() => (bar?.onBack ? bar.onBack() : back())}
            sx={{ width: 40, height: 40, flexShrink: 0, color: 'var(--text)' }}
          >
            <ArrowBack sx={{ fontSize: 20 }} />
          </IconButton>
        )}
        <Typography
          component="h1"
          noWrap
          sx={{
            flex: 1, minWidth: 0, pl: showBack ? 0 : 1,
            fontSize: 15, fontWeight: 600, color: 'var(--text)', lineHeight: 1.2
          }}
        >
          {title}
        </Typography>
        {bar?.actions ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>{bar.actions}</Box>
        ) : null}
        {menu.length > 0 && (
          <>
            <IconButton
              aria-label="More"
              aria-haspopup="menu"
              aria-expanded={menuAnchor ? 'true' : undefined}
              onClick={(e) => setMenuAnchor(e.currentTarget)}
              sx={{ width: 40, height: 40, flexShrink: 0, color: 'var(--dim)' }}
            >
              <MoreVert sx={{ fontSize: 20 }} />
            </IconButton>
            <Menu
              anchorEl={menuAnchor}
              open={!!menuAnchor}
              onClose={() => setMenuAnchor(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
              slotProps={{ paper: { sx: { minWidth: 220, maxWidth: 'calc(100vw - 32px)', maxHeight: '70dvh' } } }}
            >
              {menu.map((item, i) => (
                <MenuItem
                  key={item.label || i}
                  disabled={!!item.disabled}
                  onClick={() => choose(item)}
                  sx={{ minHeight: 44 }}
                >
                  <ListItemText
                    primary={item.label}
                    secondary={item.hint || null}
                    slotProps={{
                      primary: { sx: { fontSize: 14, color: item.danger ? 'var(--bad)' : 'var(--text)' } },
                      secondary: { sx: { fontSize: 12, color: 'var(--muted)' } }
                    }}
                  />
                </MenuItem>
              ))}
            </Menu>
          </>
        )}
      </Box>
    </Box>
  );
}
