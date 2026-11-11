import React from 'react';
import { Box } from '@mui/material';

/**
 * Keeps one broken slideshow view from taking the whole dialog down.
 * The error is cleared when `resetKey` changes (a new mode was picked).
 */
export default class ModeErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    // eslint-disable-next-line no-console
    console.error('Slideshow view stopped:', error);
  }

  componentDidUpdate(prevProps) {
    if (this.state.failed && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (this.state.failed) {
      return (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--dim)',
            fontSize: '.9rem',
          }}
        >
          This view stopped. Pick another one or close.
        </Box>
      );
    }
    return this.props.children;
  }
}
