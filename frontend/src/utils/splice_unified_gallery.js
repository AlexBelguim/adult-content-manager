const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../components/UnifiedGallery.js');
let content = fs.readFileSync(filePath, 'utf8');

// Normalize line endings to \n
content = content.replace(/\r\n/g, '\n');

// 1. Read the JSX chunk
const jsxChunkPath = path.join(__dirname, 'unified_gallery_jsx.txt');
const jsxChunk = fs.readFileSync(jsxChunkPath, 'utf8');

// 2. Find exact strings to replace
const startMarker = '  return (\n    <div className="unified-gallery">\n      <div className="container">';
const endMarker = '    </div>\n  );\n};\n\nexport default UnifiedGallery;';

const startIndex = content.indexOf(startMarker);
const endIndex = content.lastIndexOf(endMarker);

if (startIndex === -1 || endIndex === -1) {
  throw new Error("Could not find markers. Start: " + startIndex + ", End: " + endIndex);
}

const beforeJSX = content.substring(0, startIndex);

content = beforeJSX + `  return (\n${jsxChunk}\n  );\n};\n\nexport default UnifiedGallery;\n`;

// 3. Update imports
content = content.replace(
  "import './UnifiedGallery.css';",
  "import { Box, Typography, Button, Select, MenuItem, Chip, Paper, TextField, Grid } from '@mui/material';"
);

// 4. Replace loading state using a regex that only matches the loading block
const loadingStateRegex = /if \(loading\) \{\s*return \(\s*<div className="unified-gallery">\s*<div className="container">\s*<div className="loading">Loading\.\.\.<\/div>\s*<\/div>\s*<\/div>\s*\);\s*\}/;
const loadingStateNew = `if (loading) {
    return (
      <Box sx={{ p: 3, bgcolor: 'background.default', minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <Typography variant="h6" color="text.secondary">Loading...</Typography>
      </Box>
    );
  }`;
content = content.replace(loadingStateRegex, loadingStateNew);

// 5. Replace error state similarly
const errorStateRegex = /if \(error\) \{\s*return \(\s*<div className="unified-gallery">\s*<div className="container">\s*<div className="loading">\{error\}<\/div>\s*<\/div>\s*<\/div>\s*\);\s*\}/;
const errorStateNew = `if (error) {
    return (
      <Box sx={{ p: 3, bgcolor: 'background.default', minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <Typography variant="h6" color="error">{error}</Typography>
      </Box>
    );
  }`;
content = content.replace(errorStateRegex, errorStateNew);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Splice complete');
