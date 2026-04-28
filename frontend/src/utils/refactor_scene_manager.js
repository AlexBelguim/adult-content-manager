const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'SceneManagerModal.js');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Remove the custom theme creation
content = content.replace(/const darkTheme = createTheme\(\{[\s\S]*?\}\);\n/, '');

// 2. Remove ThemeProvider from imports if it's there
// createTheme is probably also imported, let's just let the linter complain or we can fix it if needed.

// 3. Replace <ThemeProvider theme={darkTheme}> and </ThemeProvider>
content = content.replace(/<ThemeProvider theme=\{darkTheme\}>/g, '');
content = content.replace(/<\/ThemeProvider>/g, '');

// 4. Replace hardcoded background colors
content = content.replace(/'#1a1a1a'/g, "'background.default'");
content = content.replace(/'#2d2d30'/g, "'background.paper'");
content = content.replace(/'#252526'/g, "'background.paper'"); // Another dark shade
content = content.replace(/'#1e1e1e'/g, "'background.paper'"); // Another dark shade
content = content.replace(/'#1a237e'/g, "'info.dark'"); // Alert background

// 5. Replace text colors
content = content.replace(/'#ffffff'/g, "'text.primary'");
content = content.replace(/'#cccccc'/g, "'text.secondary'");
content = content.replace(/'#aaaaaa'/g, "'text.secondary'");
content = content.replace(/'#888888'/g, "'text.disabled'");
content = content.replace(/'#888'/g, "'text.disabled'");
content = content.replace(/'#666666'/g, "'text.disabled'");
content = content.replace(/'#666'/g, "'text.disabled'");
content = content.replace(/'#aaa'/g, "'text.secondary'");

// 6. Replace border colors
content = content.replace(/'#404040'/g, "'divider'");
content = content.replace(/'#333333'/g, "'divider'");
content = content.replace(/'#333'/g, "'divider'");
content = content.replace(/'#444'/g, "'divider'");
content = content.replace(/'#555555'/g, "'divider'");

// 7. Replace primary/secondary colors
content = content.replace(/'#2196F3'/g, "'primary.main'");
content = content.replace(/'#1976D2'/g, "'primary.dark'");
content = content.replace(/'#4CAF50'/g, "'success.main'");
content = content.replace(/'#f44336'/g, "'error.main'");
content = content.replace(/'#d32f2f'/g, "'error.dark'");
content = content.replace(/'#FF9800'/g, "'warning.main'");
content = content.replace(/'#F57C00'/g, "'warning.dark'");
content = content.replace(/'#ff6b6b'/g, "'error.light'");
content = content.replace(/'#FF5722'/g, "'error.main'");
content = content.replace(/'#9C27B0'/g, "'secondary.main'");
content = content.replace(/'#7B1FA2'/g, "'secondary.dark'");

fs.writeFileSync(filePath, content, 'utf8');
console.log('Refactoring complete');
