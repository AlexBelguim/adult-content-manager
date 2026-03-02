const express = require('express');
const router = express.Router();
const TrueNASFixer = require('../utils/truenasFixer');

// Run TrueNAS compatibility fixes
router.post('/run-truenas-fixes', async (req, res) => {
  try {
    const fixer = new TrueNASFixer();
    const result = await fixer.runAllFixes();
    
    res.send({
      success: true,
      message: 'TrueNAS fixes completed',
      ...result
    });
  } catch (err) {
    console.error('Error running TrueNAS fixes:', err);
    res.status(500).send({ error: err.message });
  }
});

// Check TrueNAS compatibility status
router.get('/truenas-status', async (req, res) => {
  try {
    const issues = [];
    const db = require('../db');
    const fs = require('fs-extra');
    const path = require('path');
    const PathHelper = require('../utils/pathHelper');
    
    // Check for performers with stat discrepancies
    const performers = db.prepare(`
      SELECT p.*, f.path as folder_path 
      FROM performers p 
      JOIN folders f ON p.folder_id = f.id
    `).all();

    let duplicateFunscriptFolders = 0;
    let missingFolders = 0;
    let pathCaseIssues = 0;

    for (const performer of performers) {
      const performerPath = PathHelper.getPerformerPath({ path: performer.folder_path }, performer);
      
      // Check if performer folder exists
      if (!await PathHelper.safePathExists(performerPath)) {
        missingFolders++;
        issues.push(`Missing performer folder: ${performer.name}`);
        continue;
      }

      // Check for duplicate funscript folders
      const vidsPath = path.join(performerPath, 'vids');
      if (await PathHelper.safePathExists(vidsPath)) {
        const possiblePaths = PathHelper.getPossibleFunscriptPaths(vidsPath);
        const existingPaths = [];
        
        for (const possiblePath of possiblePaths) {
          if (await PathHelper.safePathExists(possiblePath)) {
            existingPaths.push(possiblePath);
          }
        }

        if (existingPaths.length > 1) {
          duplicateFunscriptFolders++;
          issues.push(`Duplicate funscript folders for: ${performer.name}`);
        }
      }

      // Check for path casing issues
      const picsPath = await PathHelper.findFolderCaseInsensitive(performerPath, 'pics');
      const vidsPathCheck = await PathHelper.findFolderCaseInsensitive(performerPath, 'vids');
      
      if (picsPath && path.basename(picsPath) !== 'pics') {
        pathCaseIssues++;
        issues.push(`Pics folder casing issue for: ${performer.name} (${path.basename(picsPath)})`);
      }
      
      if (vidsPathCheck && path.basename(vidsPathCheck) !== 'vids') {
        pathCaseIssues++;
        issues.push(`Vids folder casing issue for: ${performer.name} (${path.basename(vidsPathCheck)})`);
      }
    }

    const needsFixes = duplicateFunscriptFolders > 0 || missingFolders > 0 || pathCaseIssues > 0;

    res.send({
      compatible: !needsFixes,
      issues: {
        duplicateFunscriptFolders,
        missingFolders,
        pathCaseIssues,
        totalPerformers: performers.length
      },
      detailedIssues: issues,
      recommendedAction: needsFixes ? 'Run TrueNAS fixes' : 'No fixes needed'
    });
  } catch (err) {
    console.error('Error checking TrueNAS status:', err);
    res.status(500).send({ error: err.message });
  }
});

module.exports = router;
