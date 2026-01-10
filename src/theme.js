import { createTheme } from '@mui/material/styles';

const theme = createTheme({
    palette: {
    mode: 'dark',
    background: {
      default: '#121212',
      paper: '#1e1e1e'
    },
    text: {
      primary: '#ffffff',
      secondary: '#aaaaaa'
    }
  },
  typography: {
    fontFamily: 'Roboto, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontSize: 19.6,
    htmlFontSize: 22.4
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          fontSize: '140%'
        }
      }
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: '#111111'
        }
      }
    }
  }
});

export default theme;
