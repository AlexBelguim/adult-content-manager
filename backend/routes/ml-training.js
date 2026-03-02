const express = require('express');
const router = express.Router();
const fs = require('fs-extra');
const path = require('path');
const db = require('../db');
const { v4: uuidv4 } = require('uuid');

const DATASETS_DIR = path.join(__dirname, '..', 'ml-datasets');
const REASONING_HISTORY_PATH = path.join(DATASETS_DIR, 'reasoning_history.json');

/**
 * Generate training dataset by sampling images from after folder (keep) 
 * and deleted training folder (delete)
 */
router.post('/generate-dataset', async (req, res) => {
  try {
    const { basePath, keepImagesPerPerformer, deleteImagesPerPerformer, maxKeepPerformers, maxDeletePerformers, balanceAcrossPerformers } = req.body;

    console.log('Generate dataset request:', { basePath, keepImagesPerPerformer, deleteImagesPerPerformer, maxKeepPerformers, maxDeletePerformers, balanceAcrossPerformers });

    if (!basePath) {
      return res.status(400).send({ error: 'basePath is required' });
    }

    // Load reasoning history
    let reasoningHistory = {};
    try {
      if (await fs.pathExists(REASONING_HISTORY_PATH)) {
        reasoningHistory = await fs.readJson(REASONING_HISTORY_PATH);
      }
    } catch (e) {
      console.warn('Failed to load reasoning history:', e);
    }

    const afterFolderPath = path.join(basePath, 'after filter performer');
    const deletedFolderPath = path.join(basePath, 'deleted keep for training');

    console.log('Checking folders:', { afterFolderPath, deletedFolderPath });

    // Check if folders exist
    if (!await fs.pathExists(afterFolderPath)) {
      return res.status(404).send({ error: `After folder not found: ${afterFolderPath}` });
    }

    // Helper to process images with priority for those with reasoning
    const processImages = (files, picsPath, performerName, limit, label) => {
      // Get performer ID to look up tags
      const performer = db.prepare('SELECT id FROM performers WHERE name = ?').get(performerName);
      let actionsMap = new Map();
      
      if (performer) {
        const actions = db.prepare('SELECT file_path, reasons FROM filter_actions WHERE performer_id = ?').all(performer.id);
        actions.forEach(a => {
          if (a.reasons) {
            try {
              // Normalize path separators for matching
              actionsMap.set(path.normalize(a.file_path), JSON.parse(a.reasons));
            } catch (e) {
              console.warn(`Failed to parse reasons for ${a.file_path}`);
            }
          }
        });
      }

      const allImages = files
        .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
        .map(f => {
          const fullPath = path.join(picsPath, f);
          const normalizedPath = path.normalize(fullPath);
          
          // Check for structured tags from DB first, then fallback to legacy reasoning history
          const tags = actionsMap.get(normalizedPath) || null;
          const legacyReasoning = reasoningHistory[fullPath] || null;
          
          return {
            path: fullPath,
            performer: performerName,
            label: label,
            tags: tags,
            reasoning: legacyReasoning
          };
        });

      // Sort: images with tags/reasoning come first
      allImages.sort((a, b) => {
        const aHasData = a.tags || a.reasoning;
        const bHasData = b.tags || b.reasoning;
        if (aHasData && !bHasData) return -1;
        if (!aHasData && bHasData) return 1;
        return 0;
      });

      // Sample
      return balanceAcrossPerformers && limit > 0
        ? allImages.slice(0, limit)
        : allImages;
    };

    // Collect keep images from after folder
    const keepImages = [];
    let afterPerformers = await fs.readdir(afterFolderPath);
    console.log(`Found ${afterPerformers.length} performers in after folder`);
    
    // Limit number of performers if specified
    if (maxKeepPerformers && maxKeepPerformers > 0) {
      afterPerformers = afterPerformers.slice(0, maxKeepPerformers);
      console.log(`Limited to ${afterPerformers.length} keep performers`);
    }

    for (const performerName of afterPerformers) {
      const performerPath = path.join(afterFolderPath, performerName);
      const stat = await fs.stat(performerPath);
      
      if (!stat.isDirectory()) continue;

      const picsPath = path.join(performerPath, 'pics');
      if (await fs.pathExists(picsPath)) {
        const files = await fs.readdir(picsPath);
        keepImages.push(...processImages(files, picsPath, performerName, keepImagesPerPerformer, 'KEEP'));
      }
    }

    // Collect delete images from deleted training folder
    const deleteImages = [];
    if (await fs.pathExists(deletedFolderPath)) {
      let deletedPerformers = await fs.readdir(deletedFolderPath);
      console.log(`Found ${deletedPerformers.length} performers in deleted training folder`);
      
      // Limit number of performers if specified
      if (maxDeletePerformers && maxDeletePerformers > 0) {
        deletedPerformers = deletedPerformers.slice(0, maxDeletePerformers);
        console.log(`Limited to ${deletedPerformers.length} delete performers`);
      }

      for (const performerName of deletedPerformers) {
        const performerPath = path.join(deletedFolderPath, performerName);
        const stat = await fs.stat(performerPath);
        
        if (!stat.isDirectory()) continue;

        const picsPath = path.join(performerPath, 'pics');
        if (await fs.pathExists(picsPath)) {
          const files = await fs.readdir(picsPath);
          deleteImages.push(...processImages(files, picsPath, performerName, deleteImagesPerPerformer, 'DELETE'));
        }
      }
    }

    // Create dataset
    const datasetId = uuidv4();
    const dataset = {
      id: datasetId,
      keepImages,
      deleteImages,
      createdAt: new Date().toISOString()
    };

    // Save dataset to disk
    await fs.ensureDir(DATASETS_DIR);
    const datasetPath = path.join(DATASETS_DIR, `${datasetId}.json`);
    await fs.writeFile(datasetPath, JSON.stringify(dataset, null, 2), 'utf8');

    // Get unique performer counts
    const keepPerformers = new Set(keepImages.map(img => img.performer)).size;
    const deletePerformers = new Set(deleteImages.map(img => img.performer)).size;

    console.log('Dataset generated:', {
      totalKeepImages: keepImages.length,
      totalDeleteImages: deleteImages.length,
      keepPerformers,
      deletePerformers
    });

    res.send({
      success: true,
      datasetId,
      totalKeepImages: keepImages.length,
      totalDeleteImages: deleteImages.length,
      keepPerformers,
      deletePerformers
    });

  } catch (error) {
    console.error('Error generating dataset:', error);
    console.error('Stack trace:', error.stack);
    res.status(500).send({ error: error.message, stack: error.stack });
  }
});

/**
 * Get full dataset content for review
 */
router.get('/dataset/:id/content', async (req, res) => {
  try {
    const { id } = req.params;
    const datasetPath = path.join(DATASETS_DIR, `${id}.json`);
    
    if (!await fs.pathExists(datasetPath)) {
      return res.status(404).send({ error: 'Dataset not found' });
    }

    const dataset = await fs.readJson(datasetPath);
    res.send({ success: true, dataset });
  } catch (error) {
    console.error('Error fetching dataset content:', error);
    res.status(500).send({ error: error.message });
  }
});

/**
 * Update reasoning for an image in a dataset and save to history
 */
router.post('/dataset/:id/reasoning', async (req, res) => {
  try {
    const { id } = req.params;
    const { imagePath, reasoning } = req.body;

    if (!imagePath) {
      return res.status(400).send({ error: 'imagePath is required' });
    }

    const datasetPath = path.join(DATASETS_DIR, `${id}.json`);
    if (!await fs.pathExists(datasetPath)) {
      return res.status(404).send({ error: 'Dataset not found' });
    }

    // Update dataset file
    const dataset = await fs.readJson(datasetPath);
    let found = false;

    // Check keep images
    const keepImg = dataset.keepImages.find(img => img.path === imagePath);
    if (keepImg) {
      keepImg.reasoning = reasoning;
      found = true;
    }

    // Check delete images
    if (!found) {
      const deleteImg = dataset.deleteImages.find(img => img.path === imagePath);
      if (deleteImg) {
        deleteImg.reasoning = reasoning;
        found = true;
      }
    }

    if (!found) {
      return res.status(404).send({ error: 'Image not found in dataset' });
    }

    await fs.writeJson(datasetPath, dataset, { spaces: 2 });

    // Update history
    await fs.ensureDir(DATASETS_DIR);
    let history = {};
    try {
      if (await fs.pathExists(REASONING_HISTORY_PATH)) {
        history = await fs.readJson(REASONING_HISTORY_PATH);
      }
    } catch (e) {
      // Ignore error, start fresh
    }

    if (reasoning) {
      history[imagePath] = reasoning;
    } else {
      delete history[imagePath];
    }

    await fs.writeJson(REASONING_HISTORY_PATH, history, { spaces: 2 });

    res.send({ success: true });

  } catch (error) {
    console.error('Error updating reasoning:', error);
    res.status(500).send({ error: error.message });
  }
});

/**
 * Start fine-tuning a vision model for quality filtering
 */
router.post('/train-quality-filter', async (req, res) => {
  try {
    const { model, epochs, learningRate, loraRank, datasetId } = req.body;

    // Load dataset
    const datasetPath = path.join(__dirname, '..', 'ml-datasets', `${datasetId}.json`);
    if (!await fs.pathExists(datasetPath)) {
      return res.status(404).send({ error: 'Dataset not found' });
    }

    const dataset = await fs.readJson(datasetPath);

    // Call vision-LLM service for training
    const axios = require('axios');
    const VISION_LLM_URL = process.env.VISION_LLM_URL || 'http://localhost:5002';
    
    try {
      const response = await axios.post(`${VISION_LLM_URL}/train`, {
        dataset_path: datasetPath,
        model: model || 'llava-1.5-7b',
        epochs: epochs || 3,
        learning_rate: learningRate || 2e-4,
        lora_rank: loraRank || 16,
        output_dir: path.join(__dirname, '..', 'fine-tuned-models')
      }, { timeout: 10000 });

      res.send({
        success: true,
        jobId: response.data.job_id,
        message: 'Training started',
        estimatedTimeHours: response.data.estimated_time_hours,
        datasetSize: dataset.keepImages.length + dataset.deleteImages.length
      });
    } catch (serviceError) {
      if (serviceError.code === 'ECONNREFUSED') {
        return res.status(503).send({ 
          error: 'Vision-LLM service not running. Please start vision-llm-service first.',
          hint: 'Run: cd vision-llm-service && start-vision-llm.bat'
        });
      }
      throw serviceError;
    }

  } catch (error) {
    console.error('Error starting training:', error);
    res.status(500).send({ error: error.message });
  }
});

/**
 * Load random test images from a performer in the before folder
 */
router.post('/load-test-images', async (req, res) => {
  try {
    const { performerId, performerName, basePath, sampleSize } = req.body;

    let performerPath;
    let name;

    if (performerId) {
      const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(performerId);
      if (!performer) {
        return res.status(404).send({ error: 'Performer not found' });
      }

      // Get base path from folder
      const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(performer.folder_id);
      if (!folder) {
        return res.status(404).send({ error: 'Folder not found' });
      }

      // Check if performer is in "after" or "before" folder
      if (performer.moved_to_after === 1) {
        performerPath = path.join(folder.path, 'after filter performer', performer.name);
      } else {
        performerPath = path.join(folder.path, 'before filter performer', performer.name);
      }
      name = performer.name;
    } else if (performerName && basePath) {
      // Fallback for manual name entry (assumes before folder as default for new scans)
      performerPath = path.join(basePath, 'before filter performer', performerName);
      name = performerName;
    } else {
      return res.status(400).send({ error: 'Either performerId or (performerName and basePath) is required' });
    }

    const picsPath = path.join(performerPath, 'pics');

    if (!await fs.pathExists(picsPath)) {
      return res.status(404).send({ error: 'Pics folder not found' });
    }

    const files = await fs.readdir(picsPath);
    const imageFiles = files.filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));

    // Randomly sample
    const shuffled = imageFiles.sort(() => 0.5 - Math.random());
    const sampled = shuffled.slice(0, sampleSize);

    const images = sampled.map(f => ({
      path: path.join(picsPath, f),
      filename: f
    }));

    res.send({
      success: true,
      images,
      performerName: name
    });

  } catch (error) {
    console.error('Error loading test images:', error);
    res.status(500).send({ error: error.message });
  }
});

/**
 * Get training job status
 */
router.get('/training-status/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    
    const axios = require('axios');
    const VISION_LLM_URL = process.env.VISION_LLM_URL || 'http://localhost:5002';
    
    try {
      const response = await axios.get(`${VISION_LLM_URL}/training-status/${jobId}`, { timeout: 5000 });
      
      res.send({
        success: true,
        job: response.data.job
      });
    } catch (serviceError) {
      if (serviceError.code === 'ECONNREFUSED') {
        return res.status(503).send({ 
          error: 'Vision-LLM service not running.',
          hint: 'Run: cd vision-llm-service && start-vision-llm.bat'
        });
      }
      if (serviceError.response && serviceError.response.status === 404) {
        return res.status(404).send({ error: 'Training job not found' });
      }
      throw serviceError;
    }
    
  } catch (error) {
    console.error('Error getting training status:', error);
    res.status(500).send({ error: error.message });
  }
});

/**
 * Predict quality for a single image
 */
router.post('/predict-quality', async (req, res) => {
  try {
    const { imagePath, detailed, remoteUrl } = req.body;

    if (!await fs.pathExists(imagePath)) {
      return res.status(404).send({ error: 'Image not found' });
    }

    // Call vision-LLM service for prediction
    const axios = require('axios');
    
    // Use remote URL if provided, otherwise fallback to env or localhost
    let VISION_LLM_URL = process.env.VISION_LLM_URL || 'http://localhost:5002';
    if (remoteUrl) {
      // Ensure protocol is present
      VISION_LLM_URL = remoteUrl.startsWith('http') ? remoteUrl : `http://${remoteUrl}`;
      // Remove trailing slash
      if (VISION_LLM_URL.endsWith('/')) {
        VISION_LLM_URL = VISION_LLM_URL.slice(0, -1);
      }
    }
    
    try {
      // If using remote, we need to send the image data, not the path
      // because the remote server won't have access to our local file system
      let payload = { detailed };
      
      if (remoteUrl) {
        const imageBuffer = await fs.readFile(imagePath);
        payload.image_base64 = imageBuffer.toString('base64');
      } else {
        payload.image_path = imagePath;
      }

      const response = await axios.post(`${VISION_LLM_URL}/predict`, payload, { timeout: 1800000 }); // 30 minute timeout for model inference

      res.send({
        success: true,
        decision: response.data.decision,
        confidence: response.data.confidence,
        reasoning: response.data.reasoning,
        rawResponse: response.data.raw_response
      });
    } catch (serviceError) {
      if (serviceError.code === 'ECONNREFUSED') {
        return res.status(503).send({ 
          error: `Vision-LLM service not reachable at ${VISION_LLM_URL}.`,
          hint: remoteUrl ? 'Check your Vast.ai IP and port.' : 'Run: cd vision-llm-service && start-vision-llm.bat'
        });
      }
      throw serviceError;
    }

  } catch (error) {
    console.error('Error predicting quality:', error);
    res.status(500).send({ error: error.message });
  }
});

/**
 * Predict quality for a batch of images
 */
router.post('/predict-quality-batch', async (req, res) => {
  try {
    const { items, detailed, remoteUrl } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).send({ error: 'No items provided' });
    }

    // Call vision-LLM service for prediction
    const axios = require('axios');
    
    // Use remote URL if provided, otherwise fallback to env or localhost
    let VISION_LLM_URL = process.env.VISION_LLM_URL || 'http://localhost:5002';
    if (remoteUrl) {
      // Ensure protocol is present
      VISION_LLM_URL = remoteUrl.startsWith('http') ? remoteUrl : `http://${remoteUrl}`;
      // Remove trailing slash
      if (VISION_LLM_URL.endsWith('/')) {
        VISION_LLM_URL = VISION_LLM_URL.slice(0, -1);
      }
    }
    
    try {
      // Prepare payload
      const payloadItems = [];
      
      for (const item of items) {
        if (remoteUrl) {
          // If remote, read file and send base64
          if (await fs.pathExists(item.path)) {
            const imageBuffer = await fs.readFile(item.path);
            payloadItems.push({
              image_base64: imageBuffer.toString('base64'),
              original_path: item.path
            });
          }
        } else {
          // If local, just send path
          payloadItems.push({
            image_path: item.path,
            original_path: item.path
          });
        }
      }

      if (payloadItems.length === 0) {
        return res.status(400).send({ error: 'No valid images found to process' });
      }

      const response = await axios.post(`${VISION_LLM_URL}/predict-batch`, {
        items: payloadItems,
        detailed
      }, { timeout: 1800000 }); // 30 minute timeout

      // Map results back to original paths
      const results = response.data.results.map((r, index) => ({
        ...r,
        path: payloadItems[r.index].original_path
      }));

      res.send({
        success: true,
        results
      });
    } catch (serviceError) {
      if (serviceError.code === 'ECONNREFUSED') {
        return res.status(503).send({ 
          error: `Vision-LLM service not reachable at ${VISION_LLM_URL}.`,
          hint: remoteUrl ? 'Check your Vast.ai IP and port.' : 'Run: cd vision-llm-service && start-vision-llm.bat'
        });
      }
      throw serviceError;
    }

  } catch (error) {
    console.error('Error predicting batch:', error);
    res.status(500).send({ error: error.message });
  }
});

module.exports = router;
