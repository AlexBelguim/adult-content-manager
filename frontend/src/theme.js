import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#7e57c2', // Deep purple
      light: '#b085f5',
      dark: '#4d2c91',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#03dac6', // Vibrant teal/cyan
      light: '#66fff9',
      dark: '#00a896',
      contrastText: '#000000',
    },
    background: {
      default: '#121212', // Material dark background
      paper: '#1e1e1e',   // Slightly lighter for cards/surfaces
    },
    error: {
      main: '#cf6679',
    },
    warning: {
      main: '#ffb74d',
    },
    info: {
      main: '#29b6f6',
    },
    success: {
      main: '#66bb6a',
    },
    text: {
      primary: 'rgba(255, 255, 255, 0.87)',
      secondary: 'rgba(255, 255, 255, 0.60)',
      disabled: 'rgba(255, 255, 255, 0.38)',
    },
    divider: 'rgba(255, 255, 255, 0.12)',
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h1: {
      fontWeight: 700,
      fontSize: '2.5rem',
      letterSpacing: '-0.01562em',
    },
    h2: {
      fontWeight: 700,
      fontSize: '2rem',
      letterSpacing: '-0.00833em',
    },
    h3: {
      fontWeight: 600,
      fontSize: '1.75rem',
      letterSpacing: '0em',
    },
    h4: {
      fontWeight: 600,
      fontSize: '1.5rem',
      letterSpacing: '0.00735em',
    },
    h5: {
      fontWeight: 500,
      fontSize: '1.25rem',
      letterSpacing: '0em',
    },
    h6: {
      fontWeight: 500,
      fontSize: '1rem',
      letterSpacing: '0.0075em',
    },
    button: {
      textTransform: 'none', // Modern apps often avoid all-caps buttons
      fontWeight: 600,
    },
  },
  shape: {
    borderRadius: 12, // More rounded, premium feel
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          padding: '8px 16px',
          boxShadow: 'none',
          transition: 'all 0.2s ease-in-out',
          '&:hover': {
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
            transform: 'translateY(-1px)',
          },
        },
        containedPrimary: {
          background: 'linear-gradient(135deg, #7e57c2 0%, #5e35b1 100%)',
          '&:hover': {
            background: 'linear-gradient(135deg, #8e67d2 0%, #6e45c1 100%)',
          },
        },
        containedSecondary: {
          background: 'linear-gradient(135deg, #03dac6 0%, #00b3a6 100%)',
          '&:hover': {
            background: 'linear-gradient(135deg, #33eac6 0%, #00c3b6 100%)',
          },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          borderRadius: 16,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          border: '1px solid rgba(255,255,255,0.05)',
          transition: 'transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out',
          '&:hover': {
            transform: 'translateY(-2px)',
            boxShadow: '0 12px 28px rgba(0,0,0,0.2)',
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 8,
            transition: 'all 0.2s',
            '&:hover fieldset': {
              borderColor: 'rgba(255,255,255,0.3)',
            },
            '&.Mui-focused fieldset': {
              borderWidth: '2px',
            },
          },
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 16,
          padding: '8px',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          background: 'rgba(18, 18, 18, 0.8)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow: 'none',
        },
      },
    },
  },
});

export default theme;
