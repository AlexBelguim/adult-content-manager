const fs = require('fs-extra');
const path = require('path');

async function calculateSize(dir) {
  let size = 0;
  const files = await fs.readdir(dir, { withFileTypes: true });
  for (const file of files) {
    const fullPath = path.join(dir, file.name);
    if (file.isDirectory()) {
      size += await calculateSize(fullPath);
    } else {
      size += (await fs.stat(fullPath)).size;
    }
  }
  return size;
}

async function getPerformerStats(performerPath) {
  const picsPath = path.join(performerPath, 'pics');
  const vidsPath = path.join(performerPath, 'vids');
  const funPath = path.join(vidsPath, 'funscript');

  const pics = (await fs.pathExists(picsPath)) ? (await fs.readdir(picsPath)).length : 0;
  const vids = (await fs.pathExists(vidsPath)) ? (await fs.readdir(vidsPath)).filter(f => f.endsWith('.mp4')).length : 0;
  const funDirs = (await fs.pathExists(funPath)) ? await fs.readdir(funPath) : [];
  const funVids = funDirs.length;
  let funscripts = 0;
  for (const dir of funDirs) {
    const subFiles = await fs.readdir(path.join(funPath, dir));
    funscripts += subFiles.filter(f => f.endsWith('.funscript')).length;
  }
  const size = await calculateSize(performerPath);
  return { pics, vids, funVids, funscripts, size: (size / 1e9).toFixed(2) };
}

module.exports = { getPerformerStats, calculateSize };