import React from 'react';
import { Box } from '@mui/material';
import PhoneBar from './PhoneBar';
import BottomNav from './BottomNav';
import MoreSheet from './MoreSheet';
import { PhoneJobsProvider } from './PhoneJobs';

/**
 * The phone chrome around a page: the page bar on top, the bottom navigation and the More sheet.
 * Inactive (desktop or a bare page) it draws only the page. The page keeps its tree position either way
 * (provider > wrapper > [bar, main, nav, sheet]), so a chrome flip, such as rotating a phone on Smart
 * Compare, never remounts it. BottomNav lifts the toasts above itself while it shows.
 */
// Both keep the page in the same layout as a direct child of .App (a flex column): inactive the wrappers
// are display: contents; active, main is itself a flex column that fills the screen below the page bar
// (.App is min-height 100vh), with room at the bottom for the fixed BottomNav.
const MAIN_SX = {
  pb: 'calc(56px + env(safe-area-inset-bottom))',
  bgcolor: 'var(--bg)',
  flex: '1 0 auto', minWidth: 0,
  display: 'flex', flexDirection: 'column'
};
const CONTENTS_SX = { display: 'contents' };

export default function PhoneFrame({ active = false, children }) {
  return (
    <PhoneJobsProvider active={!!active}>
      <Box sx={CONTENTS_SX}>
        {active ? <PhoneBar /> : null}
        <Box component="main" sx={active ? MAIN_SX : CONTENTS_SX}>{children}</Box>
        {active ? <BottomNav /> : null}
        {active ? <MoreSheet /> : null}
      </Box>
    </PhoneJobsProvider>
  );
}
