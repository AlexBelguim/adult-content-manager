/**
 * AppMoreMenu — the desktop app bar's More menu.
 *
 * Groups: Pages (the sections the bar folds away below lg), then the shared
 * MORE_GROUPS from nav/items. `to` items are router links and `href` items are
 * plain links, so ctrl-click and middle-click open a tab natively. Action items
 * (Settings, Scene editor) run through useNavAction.
 */
import React from 'react';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { Menu, MenuItem, ListSubheader, ListItemIcon, ListItemText, Typography, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { SECTIONS, MORE_GROUPS, itemActive, useNavAction } from '../nav';

/** Nav items carry an icon component (or an element); draw it at `size` px. */
export function navIcon(icon, size) {
  if (!icon) return null;
  const sx = { fontSize: size };
  if (React.isValidElement(icon)) return React.cloneElement(icon, { sx: { ...sx, ...(icon.props.sx || {}) } });
  return React.createElement(icon, { sx });
}

const subheaderSx = {
  fontSize: 12,
  fontWeight: 500,
  lineHeight: '28px',
  color: 'var(--muted)',
  bgcolor: 'inherit',
  textTransform: 'none',
  letterSpacing: 0,
  px: 2,
  pt: 0.5,
};

const itemSx = {
  py: 0.75,
  px: 2,
  alignItems: 'flex-start',
  whiteSpace: 'normal',
  '& .MuiListItemIcon-root': { minWidth: 30, mt: '3px', color: 'var(--dim)' },
  '&:hover': { bgcolor: 'var(--raised)' },
  '&.Mui-selected': { bgcolor: 'var(--accent-quiet)' },
  '&.Mui-selected:hover': { bgcolor: 'var(--raised)' },
  '&.Mui-selected .MuiListItemIcon-root': { color: 'var(--accent)' },
};

export default function AppMoreMenu({ anchorEl, open, onClose }) {
  const { pathname } = useLocation();
  const theme = useTheme();
  const belowLg = useMediaQuery(theme.breakpoints.down('lg'));
  const runAction = useNavAction();

  const groups = [];
  if (belowLg) {
    groups.push({
      id: 'pages',
      label: 'Pages',
      items: SECTIONS.filter((s) => s.id !== 'library'),
    });
  }
  groups.push(...MORE_GROUPS);

  const renderItem = (item, key) => {
    // A section's match list leaves out routes with their own item, so only one item is ever selected.
    const active = itemActive(item, pathname);
    const common = {
      selected: active,
      'aria-current': active ? 'page' : undefined,
      sx: itemSx,
    };
    const body = (
      <>
        <ListItemIcon>{navIcon(item.icon, 17)}</ListItemIcon>
        <ListItemText
          primary={item.label}
          secondary={item.hint}
          sx={{ my: 0 }}
          slotProps={{
            primary: { sx: { fontSize: 13.5, color: 'var(--text)', fontWeight: active ? 600 : 500, lineHeight: 1.35 } },
            secondary: { sx: { fontSize: 12, color: 'var(--muted)', lineHeight: 1.35 } },
          }}
        />
      </>
    );

    if (item.to) {
      return (
        <MenuItem key={key} {...common} component={RouterLink} to={item.to} onClick={onClose}>
          {body}
        </MenuItem>
      );
    }
    if (item.href) {
      return (
        <MenuItem key={key} {...common} component="a" href={item.href} onClick={onClose}>
          {body}
        </MenuItem>
      );
    }
    return (
      <MenuItem
        key={key}
        {...common}
        onClick={(e) => {
          onClose();
          runAction(item, e);
        }}
      >
        {body}
      </MenuItem>
    );
  };

  // Menu wants a flat list of children (no fragments).
  const children = [];
  groups.forEach((group) => {
    children.push(
      <ListSubheader key={`h-${group.id}`} disableSticky sx={subheaderSx}>
        {group.label}
      </ListSubheader>
    );
    group.items.forEach((item) => children.push(renderItem(item, `${group.id}-${item.id}`)));
  });
  children.push(
    <Typography
      key="footer"
      component="div"
      role="none"
      sx={{ fontSize: 12, color: 'var(--muted)', px: 2, py: 1, mt: 0.5, borderTop: '1px solid var(--line)' }}
    >
      Ctrl-click opens a page in a new tab.
    </Typography>
  );

  return (
    <Menu
      id="app-more-menu"
      anchorEl={anchorEl}
      open={open}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      slotProps={{
        paper: {
          sx: {
            width: 320,
            maxHeight: 'calc(100vh - 80px)',
            bgcolor: 'var(--overlay)',
            backgroundImage: 'none',
            border: '1px solid var(--line-strong)',
            borderRadius: 'var(--radius-lg, 10px)',
            mt: 0.5,
          },
        },
        list: { dense: true, 'aria-labelledby': 'app-more-button', sx: { py: 0.5 } },
      }}
    >
      {children}
    </Menu>
  );
}
