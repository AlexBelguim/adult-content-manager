import React from 'react';
import {
  Box, Drawer, IconButton, Typography, List, ListSubheader, ListItemButton, ListItemIcon, ListItemText
} from '@mui/material';
import { Close, ListAlt } from '@mui/icons-material';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import { SECTIONS, MORE_GROUPS, itemActive, useNavAction, canPop, isNewTabClick } from '../nav';
import { usePhoneJobs } from './PhoneJobs';

/**
 * The phone's More sheet: jobs, the Handy connection, and every page the bottom tabs do not reach.
 * It is open while the current history entry carries { sheet: 'more' }, so the back gesture closes it.
 * Choosing a page replaces the sheet's entry, so Back from that page skips the sheet.
 */
const PHONE_PAGES = ['performers', 'ai'];

const rowSx = {
  minHeight: 48, px: 2, gap: 0,
  '&.Mui-selected': { bgcolor: 'var(--raised)' },
  '&.Mui-selected:hover': { bgcolor: 'var(--raised)' },
  '&.Mui-disabled': { opacity: 1 }
};
const iconSx = { minWidth: 36, color: 'var(--dim)', '& svg': { fontSize: 20 } };
const subheaderSx = {
  bgcolor: 'var(--surface)', color: 'var(--muted)', fontSize: 12, fontWeight: 500,
  lineHeight: '32px', px: 2, mt: 0.5
};

function ItemIcon({ icon }) {
  if (!icon) return null;
  if (React.isValidElement(icon)) return icon;
  const Icon = icon;
  return <Icon />;
}

function rowText(label, hint, { disabled = false, selected = false } = {}) {
  return (
    <ListItemText
      primary={label}
      secondary={hint || null}
      sx={{ my: 0.5 }}
      slotProps={{
        primary: { sx: { fontSize: 14, color: disabled ? 'var(--dim)' : 'var(--text)', fontWeight: selected ? 600 : 400 } },
        secondary: { sx: { fontSize: 12, color: 'var(--muted)' } }
      }}
    />
  );
}

export default function MoreSheet() {
  const location = useLocation();
  const navigate = useNavigate();
  const navAction = useNavAction();
  const { running, queued, failed } = usePhoneJobs();
  const open = location.state?.sheet === 'more';
  const { pathname } = location;

  const close = () => {
    if (!location.state?.sheet) return;
    if (canPop(location)) { navigate(-1); return; }
    const { sheet, ...rest } = location.state || {};
    navigate(
      { pathname, search: location.search, hash: location.hash },
      { replace: true, state: Object.keys(rest).length ? rest : null }
    );
  };

  const runAction = (item, event) => {
    close();
    navAction(item, event);
  };

  const groups = [
    { id: 'pages', label: 'Pages', items: SECTIONS.filter((s) => PHONE_PAGES.includes(s.id)) },
    ...MORE_GROUPS.map((g) => ({
      id: g.id || g.label,
      label: g.label ?? g.title,
      // Jobs has its own row at the top, with the counts.
      items: (g.items || []).filter((item) => item.phone !== 'no' && item.to !== '/jobs')
    }))
  ].filter((g) => g.items.length > 0);

  const jobParts = [];
  if (running > 0) jobParts.push(`${running} running`);
  if (queued > 0) jobParts.push(`${queued} queued`);

  const renderItem = (item) => {
    const key = item.id || item.label;
    const icon = <ListItemIcon sx={iconSx}><ItemIcon icon={item.icon} /></ListItemIcon>;
    if (item.phone === 'disabled') {
      return (
        <ListItemButton key={key} disabled sx={rowSx}>
          {icon}
          {rowText(item.label, item.phoneReason || item.hint, { disabled: true })}
        </ListItemButton>
      );
    }
    if (item.to) {
      const selected = itemActive(item, pathname);
      return (
        <ListItemButton
          key={key}
          component={RouterLink}
          to={item.to}
          replace
          selected={selected}
          aria-current={selected ? 'page' : undefined}
          sx={rowSx}
        >
          {icon}
          {rowText(item.label, item.hint, { selected })}
        </ListItemButton>
      );
    }
    if (item.href) {
      // A static page of the app (profile.html): a plain link in the same tab, inside the installed app. Like
      // the page items it takes the sheet's place in the history, so leaving it does not reopen the sheet.
      const follow = (e) => {
        if (isNewTabClick(e)) return;
        e.preventDefault();
        window.location.replace(item.href);
      };
      return (
        <ListItemButton key={key} component="a" href={item.href} onClick={follow} sx={rowSx}>
          {icon}
          {rowText(item.label, item.hint)}
        </ListItemButton>
      );
    }
    return (
      <ListItemButton key={key} onClick={(e) => runAction(item, e)} sx={rowSx}>
        {icon}
        {rowText(item.label, item.hint)}
      </ListItemButton>
    );
  };

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={close}
      disableEnforceFocus
      slotProps={{
        paper: {
          'aria-label': 'More',
          sx: {
            bgcolor: 'var(--surface)', color: 'var(--text)', backgroundImage: 'none',
            borderTop: '1px solid var(--line-strong)',
            borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0',
            maxHeight: '85dvh', overflowY: 'auto',
            paddingBottom: 'env(safe-area-inset-bottom)'
          }
        }
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', minHeight: 48, pl: 2, pr: 0.5 }}>
        <Typography component="h2" sx={{ flex: 1, fontSize: 15, fontWeight: 600 }}>More</Typography>
        <IconButton aria-label="Close" onClick={close} sx={{ width: 40, height: 40, color: 'var(--dim)' }}>
          <Close sx={{ fontSize: 20 }} />
        </IconButton>
      </Box>

      <List disablePadding>
        <ListItemButton
          component={RouterLink}
          to="/jobs"
          replace
          selected={pathname === '/jobs'}
          sx={{ ...rowSx, borderTop: '1px solid var(--line)' }}
        >
          <ListItemIcon sx={iconSx}><ListAlt /></ListItemIcon>
          <ListItemText
            primary="Jobs"
            secondary={
              jobParts.length || failed > 0 ? (
                <>
                  {jobParts.join(' · ')}
                  {jobParts.length > 0 && failed > 0 ? ' · ' : ''}
                  {failed > 0 && <Box component="span" sx={{ color: 'var(--bad)' }}>{failed} failed</Box>}
                </>
              ) : 'Nothing running'
            }
            sx={{ my: 0.5 }}
            slotProps={{
              primary: { sx: { fontSize: 14, color: 'var(--text)' } },
              secondary: { sx: { fontSize: 12, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' } }
            }}
          />
        </ListItemButton>

        <Box
          sx={{
            display: 'flex', alignItems: 'center', gap: 1.5, minHeight: 48, px: 2, py: 0.5,
            borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)'
          }}
        >
          <Typography sx={{ fontSize: 14, color: 'var(--text)', flexShrink: 0, width: 52 }}>Handy</Typography>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <handy-control />
          </Box>
        </Box>

        {groups.map((g) => (
          <li key={g.id}>
            <List disablePadding>
              <ListSubheader disableSticky sx={subheaderSx}>{g.label}</ListSubheader>
              {g.items.map(renderItem)}
            </List>
          </li>
        ))}
      </List>
    </Drawer>
  );
}
