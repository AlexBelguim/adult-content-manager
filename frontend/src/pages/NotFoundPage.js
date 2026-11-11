import React from 'react';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { Button } from '@mui/material';
import { PageShell, EmptyState } from '../components/layout';
import { useChrome } from '../nav';

/**
 * Any path the route table does not know. Rendered in the page shell, so the app's navigation stays. On a phone the
 * page bar already says "Page not found", so the panel only says where.
 */
export default function NotFoundPage() {
  const { pathname } = useLocation();
  const phone = useChrome() === 'phone';
  const where = `No page at ${pathname}.`;
  return (
    <PageShell full>
      <EmptyState
        title={phone ? where : 'Page not found'}
        description={phone ? null : where}
        action={(
          <Button variant="contained" disableElevation component={RouterLink} to="/">
            Open the library
          </Button>
        )}
      />
    </PageShell>
  );
}
