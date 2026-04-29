const fs = require('fs');
const path = require('path');

function refactorFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');

    // 1. Remove background: '#1E1E1E' and color: '#fff' from Paper
    content = content.replace(/background:\s*['"]#1E1E1E['"],?/g, '');
    content = content.replace(/bgcolor:\s*['"]#1E1E1E['"],?/g, '');
    content = content.replace(/color:\s*['"]#fff['"],?/g, '');

    // 2. Gradients
    // LocalImport uses green gradient: #4CAF50 -> #66BB6A
    content = content.replace(/background:\s*['"]linear-gradient\(45deg,\s*#4CAF50\s*30%,\s*#66BB6A\s*90%\)['"]/g, "background: 'linear-gradient(45deg, #9c27b0 30%, #ce93d8 90%)'");
    
    // UploadQueue uses pink/orange gradient: #7e57c2 -> #b085f5
    content = content.replace(/background:\s*['"]linear-gradient\(45deg,\s*#7e57c2\s*30%,\s*#b085f5\s*90%\)['"]/g, "background: 'linear-gradient(45deg, #9c27b0 30%, #ce93d8 90%)'");
    
    // 3. Typography/colors
    // Replace hardcoded grays with text.secondary or text.disabled
    content = content.replace(/color:\s*['"]#aaa['"]/g, "color: 'text.secondary'");
    content = content.replace(/color:\s*['"]#888['"]/g, "color: 'text.secondary'");
    content = content.replace(/color:\s*['"]#777['"]/g, "color: 'text.secondary'");
    content = content.replace(/color:\s*['"]#666['"]/g, "color: 'text.secondary'");
    content = content.replace(/color:\s*['"]#ccc['"]/g, "color: 'text.secondary'");
    content = content.replace(/color:\s*['"]#555['"]/g, "color: 'text.disabled'");
    content = content.replace(/color:\s*['"]#444['"]/g, "color: 'text.disabled'");
    
    // Replace direct color strings in attributes like color="#aaa" -> color="text.secondary"
    content = content.replace(/color=['"]#aaa['"]/g, "color=\"text.secondary\"");
    content = content.replace(/color=['"]#888['"]/g, "color=\"text.secondary\"");
    content = content.replace(/color=['"]#555['"]/g, "color=\"text.disabled\"");
    content = content.replace(/color=['"]#444['"]/g, "color=\"text.disabled\"");

    // 4. Borders / Dividers
    content = content.replace(/borderColor:\s*['"]#333['"]/g, "borderColor: 'divider'");
    content = content.replace(/borderColor:\s*['"]#444['"]/g, "borderColor: 'divider'");
    content = content.replace(/borderBottom:\s*['"]1px solid #333['"]/g, "borderBottom: 1, borderColor: 'divider'");
    content = content.replace(/borderTop:\s*['"]1px solid #333['"]/g, "borderTop: 1, borderColor: 'divider'");
    content = content.replace(/borderLeft:\s*['"]3px solid transparent['"]/g, "borderLeft: 3, borderColor: 'transparent'");

    // 5. Button and interactions (green to primary)
    content = content.replace(/borderColor:\s*['"]#4CAF50['"]/g, "borderColor: 'primary.main'");
    content = content.replace(/color:\s*['"]#4CAF50['"]/g, "color: 'primary.main'");
    content = content.replace(/borderLeft:\s*['"]3px solid #4CAF50['"]/g, "borderLeft: 3, borderColor: 'primary.main'");
    // Background colors with opacity for green (#4CAF50 -> primary)
    content = content.replace(/bgcolor:\s*['"]rgba\(76,\s*175,\s*80,\s*0\.08\)['"]/g, "bgcolor: 'action.hover'");
    content = content.replace(/bgcolor:\s*['"]rgba\(76,\s*175,\s*80,\s*0\.2\)['"]/g, "bgcolor: 'action.selected'");
    // Box shadow for green
    content = content.replace(/boxShadow:\s*['"]0 3px 5px 2px rgba\(76, 175, 80, \.3\)['"]/g, "boxShadow: '0 3px 5px 2px rgba(156, 39, 176, .3)'");

    // Upload queue interactions (orange/pink to primary)
    content = content.replace(/borderColor:\s*['"]#b085f5['"]/g, "borderColor: 'primary.main'");
    content = content.replace(/color:\s*['"]#b085f5['"]/g, "color: 'primary.main'");
    content = content.replace(/bgcolor:\s*['"]rgba\(255,\s*142,\s*83,\s*0\.2\)['"]/g, "bgcolor: 'action.selected'");
    content = content.replace(/bgcolor:\s*['"]rgba\(255,\s*142,\s*83,\s*0\.05\)['"]/g, "bgcolor: 'action.hover'");
    content = content.replace(/boxShadow:\s*['"]0 3px 5px 2px rgba\(255, 105, 135, \.3\)['"]/g, "boxShadow: '0 3px 5px 2px rgba(156, 39, 176, .3)'");

    // General background elements
    content = content.replace(/bgcolor:\s*['"]#333['"]/g, "bgcolor: 'background.default'");
    content = content.replace(/bgcolor:\s*['"]#252525['"]/g, "bgcolor: 'background.paper'");

    // Specifically for progress bars (green -> primary)
    content = content.replace(/& \.MuiLinearProgress-bar': { bgcolor: '#4CAF50' }/g, "& .MuiLinearProgress-bar': { bgcolor: 'primary.main' }");

    // List item hover effect
    content = content.replace(/bgcolor:\s*['"]rgba\(255,255,255,0\.03\)['"]/g, "bgcolor: 'action.hover'");
    content = content.replace(/bgcolor:\s*['"]rgba\(255,255,255,0\.02\)['"]/g, "bgcolor: 'action.hover'");

    // Input fields
    content = content.replace(/& \.MuiInput-underline:after': { borderBottomColor: '#4CAF50' }/g, "& .MuiInput-underline:after': { borderBottomColor: 'primary.main' }");
    content = content.replace(/& \.MuiInput-underline:before': { borderBottomColor: '#444' }/g, "& .MuiInput-underline:before': { borderBottomColor: 'divider' }");

    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Refactored ${filePath}`);
}

const frontendSrc = path.join(__dirname, '..');
refactorFile(path.join(frontendSrc, 'pages', 'LocalImportPage.js'));
refactorFile(path.join(frontendSrc, 'pages', 'UploadQueuePage.js'));
