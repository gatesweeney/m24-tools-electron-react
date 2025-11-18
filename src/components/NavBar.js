import React from 'react';
import { useLocation, Link as RouterLink } from 'react-router-dom';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Toolbar from '@mui/material/Toolbar';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import HomeIcon from '@mui/icons-material/Home';

const pages = [
  { label: 'Home', path: '/' },
  { label: 'Proxies', path: '/proxy' },
  { label: 'HEIC', path: '/heic-converter' },
  { label: 'Compressor', path: '/image-compressor' }
];

function NavBar() {
  const location = useLocation();

    return (
    <AppBar
      position="static"
      elevation={1}
      sx={{
        WebkitAppRegion: 'drag',
        pt: 3  // a little extra padding at the top where the macOS controls live
      }}
    >
      <Toolbar>
                <IconButton
          size="large"
          edge="start"
          color="inherit"
          aria-label="home"
          component={RouterLink}
          to="/"
          sx={{ mr: 2, WebkitAppRegion: 'no-drag' }}
        >
          <HomeIcon />
        </IconButton>
        <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center' }}>
        <img
        src={require('../assets/logo.png')}
        alt="M24 Tools"
        style={{ height: 28, WebkitAppRegion: 'no-drag', marginRight: 12, pointerEvents: 'none' }}
      />
</Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {pages.map((page) => {
            const active = location.pathname === page.path;
            return (
                            <Button
                key={page.path}
                component={RouterLink}
                to={page.path}
                color={active ? 'primary' : 'inherit'}
                variant={active ? 'contained' : 'text'}
                sx={{ textTransform: 'none', WebkitAppRegion: 'no-drag' }}
              >
                {page.label}
              </Button>
            );
          })}
        </Box>
      </Toolbar>
    </AppBar>
  );
}

export default NavBar;
