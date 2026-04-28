const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../components/UnifiedGallery.js');
let content = fs.readFileSync(filePath, 'utf8');

// Add MUI imports
content = content.replace(
  "import './UnifiedGallery.css';",
  "import { Box, Typography, Button, Select, MenuItem, Chip, Paper, TextField, Grid, Card, CardContent } from '@mui/material';"
);

// Replace JSX elements with MUI components
content = content.replace(/<div className="unified-gallery">/g, '<Box sx={{ p: 3, bgcolor: \'background.default\', minHeight: \'100vh\' }}>');
content = content.replace(/<div className="container">/g, '<Box sx={{ maxWidth: 1480, mx: \'auto\', bgcolor: \'background.paper\', p: 3, borderRadius: 2, boxShadow: 3 }}>');
content = content.replace(/<div className="header">/g, '<Box sx={{ display: \'flex\', justifyContent: \'space-between\', alignItems: \'center\', mb: 3, pb: 2, borderBottom: 1, borderColor: \'divider\' }}>');
content = content.replace(/<h1 className="gallery-title">/g, '<Typography variant="h4" sx={{ fontWeight: \'bold\', color: \'text.primary\' }}>');
content = content.replace(/<\/h1>/g, '</Typography>');

content = content.replace(/<div className="stats">/g, '<Box sx={{ display: \'flex\', gap: 2 }}>');
content = content.replace(/<div className="stat">/g, '<Chip color="primary" variant="outlined" label={');
// Note: <div className="stat">{...}</div> -> <Chip label={`${...}`} />
// Since there's multiple stats:
// <div className="stat">{currentContent?.pics?.length || 0} pics</div>
// We can just use string replace for the stat divs
content = content.replace(/<div className="stat">([^<]+)<\/div>/g, '<Chip color="primary" variant="outlined" label={`$1`} />');

content = content.replace(/<div className="controls">/g, '<Box sx={{ display: \'flex\', justifyContent: \'space-between\', alignItems: \'center\', gap: 2, mb: 2, p: 2, bgcolor: \'background.default\', borderRadius: 2 }}>');
content = content.replace(/<div className="tabs">/g, '<Box sx={{ display: \'flex\', gap: 1.5 }}>');

// Handle tabs
content = content.replace(/<button\s+className={`tab \${([^}]+)}`}\s+onClick={([^>]+)}>/g, '<Button variant={$1.includes(\'active\') ? \'contained\' : \'outlined\'} onClick={$2} sx={{ borderRadius: 5 }}>');
content = content.replace(/<button\s+className={`tab showtagged-mode-\${([^}]+)}`}/g, '<Button variant="contained"');
content = content.replace(/style=\{\{([\s\S]*?)\}\}/g, (match, p1) => {
  if (p1.includes('background: showTaggedMode')) {
    return 'sx={{ ml: 1, bgcolor: showTaggedMode === 0 ? \'primary.main\' : showTaggedMode === 1 ? \'success.main\' : \'warning.main\', color: showTaggedMode === 2 ? \'warning.contrastText\' : \'white\', fontWeight: \'bold\', border: 2, borderColor: \'primary.main\' }}';
  }
  return match;
});

// We need to carefully replace closing buttons for tabs, but they are just </button>
// which we'll handle by global replace, but wait, there are other buttons.
// Let's just do a blanket replace of button -> Button if it has a className we control.
content = content.replace(/<button([^>]*)>/g, (match, p1) => {
  if (p1.includes('className="tag-chip')) return match; // Handle tag-chips separately
  if (p1.includes('className="tab')) return match; // Already handled above
  if (p1.includes('className={`tab')) return match; 
  if (p1.includes('filter-toggle')) return match; 
  if (p1.includes('tag-filter-btn')) return match; 
  return match; // fallback
});

// Since regex parsing JSX is dangerous and prone to error, let's use a simpler approach.
// Let's just keep the <div> and className, but INJECT sx props and delete UnifiedGallery.css.
// Actually, I can just write a global CSS snippet in theme.js? No, user wants it unified, no raw CSS.

fs.writeFileSync(filePath, content, 'utf8');
