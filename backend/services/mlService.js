const axios = require('axios');
const path = require('path');
const fs = require('fs-extra');
const db = require('../db');
const crypto = require('crypto');

// ML Python service configuration
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:5001';
const ML_SERVICE_TIMEOUT = 300000; // 5 minutes

// Job tracking
const trainingJobs = new Map();

/**
 * Get models folder path for a base path
 */
function getModelsPath(basePath) {
  return path.join(basePath, 'models');
}

/**
 * Ensure models folder exists
 */
async function ensureModelsFolder(basePath) {
  const modelsPath = getModelsPath(basePath);
  await fs.ensureDir(modelsPath);
  return modelsPath;
}

/**
 * Get training data statistics
 */
function getTrainingDataStats(includedPerformerIds = []) {
  // If no performers are included, return zero stats
  if (includedPerformerIds.length === 0) {
    return {
      total: 0,
      deleted: 0,
      kept: 0,
      performers: 0,
      balance: 0
    };
  }
  
  const includeClause = `AND ci.performer_id IN (${includedPerformerIds.join(',')})`;
  
  const stats = db.prepare(`
    SELECT 
      COUNT(DISTINCT ci.id) as total_samples,
      SUM(CASE WHEN fa.action = 'delete' THEN 1 ELSE 0 END) as deleted_samples,
      SUM(CASE WHEN fa.action = 'keep' THEN 1 ELSE 0 END) as kept_samples,
      COUNT(DISTINCT ci.performer_id) as num_performers,
      COUNT(DISTINCT CASE WHEN cce.clip_embedding IS NOT NULL THEN ci.id END) as files_with_clip,
      COUNT(DISTINCT CASE WHEN ci.file_type = 'image' AND cce.clip_embedding IS NOT NULL THEN ci.id END) as image_samples,
      SUM(CASE WHEN ci.file_type = 'image' AND fa.action = 'delete' THEN 1 ELSE 0 END) as image_deleted,
      SUM(CASE WHEN ci.file_type = 'image' AND fa.action = 'keep' THEN 1 ELSE 0 END) as image_kept,
      COUNT(DISTINCT CASE WHEN ci.file_type = 'video' AND cce.clip_embedding IS NOT NULL THEN ci.id END) as video_samples,
      SUM(CASE WHEN ci.file_type = 'video' AND fa.action = 'delete' THEN 1 ELSE 0 END) as video_deleted,
      SUM(CASE WHEN ci.file_type = 'video' AND fa.action = 'keep' THEN 1 ELSE 0 END) as video_kept
    FROM content_items ci
    LEFT JOIN content_clip_embeddings cce ON ci.id = cce.content_item_id
    LEFT JOIN filter_actions fa ON ci.file_path = fa.file_path
    WHERE fa.action IS NOT NULL ${includeClause}
  `).get();
  
  const imageBalance = stats.image_samples > 0 ? (stats.image_deleted / stats.image_samples * 100).toFixed(1) : 0;
  const videoBalance = stats.video_samples > 0 ? (stats.video_deleted / stats.video_samples * 100).toFixed(1) : 0;
  const totalBalance = stats.total_samples > 0 ? (stats.deleted_samples / stats.total_samples * 100).toFixed(1) : 0;
  
  return {
    total: stats.total_samples || 0,
    deleted: stats.deleted_samples || 0,
    kept: stats.kept_samples || 0,
    performers: stats.num_performers || 0,
    files_with_clip: stats.files_with_clip || 0,
    balance: totalBalance,
    image_samples: stats.image_samples || 0,
    image_deleted: stats.image_deleted || 0,
    image_kept: stats.image_kept || 0,
    image_balance: imageBalance,
    video_samples: stats.video_samples || 0,
    video_deleted: stats.video_deleted || 0,
    video_kept: stats.video_kept || 0,
    video_balance: videoBalance
  };
}

/**
 * Export training data for ML service
 */
function exportTrainingData(includedPerformerIds = []) {
  // If no performers are included, return empty array
  if (includedPerformerIds.length === 0) {
    return [];
  }
  
  const includeClause = `AND ci.performer_id IN (${includedPerformerIds.join(',')})`;
  
  const rows = db.prepare(`
    SELECT 
      ci.id,
      ci.performer_id,
      ci.file_path,
      ci.file_type,
      cce.clip_embedding,
      ci.file_size,
      CASE WHEN fa.action = 'delete' THEN 1 ELSE 0 END as label,
      p.name as performer_name
    FROM content_items ci
    JOIN content_clip_embeddings cce ON ci.id = cce.content_item_id
    JOIN filter_actions fa ON ci.file_path = fa.file_path
    JOIN performers p ON ci.performer_id = p.id
    WHERE cce.clip_embedding IS NOT NULL ${includeClause}
  `).all();
  
  return rows;
}

/**
 * Get all ML models
 */
function getAllModels() {
  return db.prepare(`
    SELECT * FROM ml_models 
    ORDER BY created_at DESC
  `).all();
}

/**
 * Get active model
 */
function getActiveModel() {
  return db.prepare(`
    SELECT * FROM ml_models 
    WHERE is_active = 1 
    LIMIT 1
  `).get();
}

/**
 * Set active model
 */
function setActiveModel(modelId) {
  const updateTx = db.transaction(() => {
    // Deactivate all models
    db.prepare('UPDATE ml_models SET is_active = 0').run();
    
    // Check if this is a dual-model system or legacy single model
    const baseId = modelId.replace(/_image$/, '').replace(/_video$/, '');
    const imageModelId = `${baseId}_image`;
    const videoModelId = `${baseId}_video`;
    
    // Try to activate both variants (for dual-model system)
    const imageExists = db.prepare('SELECT id FROM ml_models WHERE id = ?').get(imageModelId);
    const videoExists = db.prepare('SELECT id FROM ml_models WHERE id = ?').get(videoModelId);
    
    if (imageExists || videoExists) {
      // Dual-model system: activate both image and video models
      db.prepare('UPDATE ml_models SET is_active = 1 WHERE id = ? OR id = ?').run(imageModelId, videoModelId);
    } else {
      // Legacy single model: activate just this model
      db.prepare('UPDATE ml_models SET is_active = 1 WHERE id = ?').run(modelId);
    }
  });
  
  updateTx();
  return getActiveModel();
}

/**
 * Create a new ML model entry
 */
function createModelEntry(basePath, includedPerformerIds = []) {
  const modelId = `model_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const modelsPath = getModelsPath(basePath);
  const modelFilePath = path.join(modelsPath, `${modelId}.pkl`);
  const metadataFilePath = path.join(modelsPath, `${modelId}.json`);
  
  db.prepare(`
    INSERT INTO ml_models (
      id, name, model_file_path, metadata_file_path, 
      excluded_performers, status
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    modelId,
    `Model ${new Date().toISOString().split('T')[0]}`,
    modelFilePath,
    metadataFilePath,
    JSON.stringify(includedPerformerIds),
    'training'
  );
  
  return modelId;
}

/**
 * Update model after training completion
 */
function updateModelAfterTraining(modelId, metrics, duration) {
  db.prepare(`
    UPDATE ml_models 
    SET 
      training_duration_seconds = ?,
      training_samples = ?,
      training_deleted_samples = ?,
      training_kept_samples = ?,
      accuracy = ?,
      precision_score = ?,
      recall_score = ?,
      f1_score = ?,
      status = 'completed'
    WHERE id = ?
  `).run(
    duration,
    metrics.total_samples || 0,
    metrics.deleted_samples || 0,
    metrics.kept_samples || 0,
    metrics.accuracy || 0,
    metrics.precision || 0,
    metrics.recall || 0,
    metrics.f1 || 0,
    modelId
  );
}

/**
 * Start training job
 */
async function startTraining(basePath, includedPerformerIds = []) {
  const jobId = crypto.randomBytes(16).toString('hex');
  
  // Create model entry
  const modelId = createModelEntry(basePath, includedPerformerIds);
  await ensureModelsFolder(basePath);
  
  // Create job entry
  db.prepare(`
    INSERT INTO ml_training_jobs (job_id, model_id, status, started_at)
    VALUES (?, ?, 'running', ?)
  `).run(jobId, modelId, Math.floor(Date.now() / 1000));
  
  // Initialize job tracking
  const job = {
    jobId,
    modelId,
    status: 'running',
    progress: 0,
    startTime: Date.now(),
    error: null
  };
  trainingJobs.set(jobId, job);
  
  // Start training in background
  (async () => {
    try {
      // Export training data
      job.progress = 5;
      const trainingData = exportTrainingData(includedPerformerIds);
      
      if (trainingData.length < 10) {
        throw new Error('Insufficient training data. Need at least 10 samples.');
      }
      
      job.progress = 10;
      
      // Call Python ML service
      const model = db.prepare('SELECT * FROM ml_models WHERE id = ?').get(modelId);
      
      console.log('Calling Python training service...');
      const response = await axios.post(
        `${ML_SERVICE_URL}/train`,
        {
          data: trainingData.map(row => ({
            ...row,
            file_type: row.file_type  // Include file_type for separate model training
          })),
          model_id: modelId
        },
        { timeout: ML_SERVICE_TIMEOUT }
      );
      
      console.log('Python service response status:', response.status);
      console.log('Python service response keys:', Object.keys(response.data));
      
      job.progress = 90;
      
      console.log('Training response:', JSON.stringify(response.data, null, 2));
      
      // Update model with training results
      const duration = Math.floor((Date.now() - job.startTime) / 1000);
      
      // Handle dual-model response (new format: models.image and models.video as objects)
      if (response.data.models && typeof response.data.models === 'object' && !Array.isArray(response.data.models)) {
        const modelsPath = getModelsPath(basePath);
        
        // Process image model
        if (response.data.models.image) {
          const modelData = response.data.models.image;
          const specificModelId = `${modelId}_image`;
          const modelFilePath = path.join(modelsPath, `model_image_${modelId}.pkl`);
          const metadataFilePath = path.join(modelsPath, `metadata_image_${modelId}.json`);
          
          const existingModel = db.prepare('SELECT id FROM ml_models WHERE id = ?').get(specificModelId);
          
          if (!existingModel) {
            console.log(`Creating image model: ${specificModelId}`);
            db.prepare(`
              INSERT INTO ml_models (
                id, created_at, status, is_active,
                training_duration_seconds, training_samples, 
                training_deleted_samples, training_kept_samples,
                accuracy, precision_score, recall_score, f1_score,
                name, model_file_path, metadata_file_path,
                excluded_performers
              ) VALUES (?, ?, 'completed', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              specificModelId,
              Math.floor(Date.now() / 1000),
              duration,
              modelData.samples || 0,
              modelData.deleted_samples || 0,
              modelData.kept_samples || 0,
              modelData.accuracy || 0,
              modelData.precision || 0,
              modelData.recall || 0,
              modelData.f1_score || 0,
              `Model ${new Date().toISOString().split('T')[0]} (Image)`,
              modelFilePath,
              metadataFilePath,
              model.excluded_performers || '[]'
            );
          }
        }
        
        // Process video model
        if (response.data.models.video) {
          const modelData = response.data.models.video;
          const specificModelId = `${modelId}_video`;
          const modelFilePath = path.join(modelsPath, `model_video_${modelId}.pkl`);
          const metadataFilePath = path.join(modelsPath, `metadata_video_${modelId}.json`);
          
          const existingModel = db.prepare('SELECT id FROM ml_models WHERE id = ?').get(specificModelId);
          
          if (!existingModel) {
            console.log(`Creating video model: ${specificModelId}`);
            db.prepare(`
              INSERT INTO ml_models (
                id, created_at, status, is_active,
                training_duration_seconds, training_samples, 
                training_deleted_samples, training_kept_samples,
                accuracy, precision_score, recall_score, f1_score,
                name, model_file_path, metadata_file_path,
                excluded_performers
              ) VALUES (?, ?, 'completed', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              specificModelId,
              Math.floor(Date.now() / 1000),
              duration,
              modelData.samples || 0,
              modelData.deleted_samples || 0,
              modelData.kept_samples || 0,
              modelData.accuracy || 0,
              modelData.precision || 0,
              modelData.recall || 0,
              modelData.f1_score || 0,
              `Model ${new Date().toISOString().split('T')[0]} (Video)`,
              modelFilePath,
              metadataFilePath,
              model.excluded_performers || '[]'
            );
          }
        }
        
        // Update base model to completed status
        db.prepare('UPDATE ml_models SET status = ? WHERE id = ?').run('completed', modelId);
      } else if (response.data.models && Array.isArray(response.data.models)) {
        const modelsPath = getModelsPath(basePath);
        
        response.data.models.forEach(modelData => {
          const modelType = modelData.model_id.endsWith('_image') ? 'image' : 'video';
          const specificModelId = modelData.model_id;
          const modelFilePath = path.join(modelsPath, `${specificModelId}.pkl`);
          const metadataFilePath = path.join(modelsPath, `${specificModelId}.json`);
          
          // Create/update model entry for each type
          const existingModel = db.prepare('SELECT id FROM ml_models WHERE id = ?').get(specificModelId);
          
          if (!existingModel) {
            // Create new model entry
            db.prepare(`
              INSERT INTO ml_models (
                id, created_at, status, is_active,
                training_duration_seconds, training_samples, 
                training_deleted_samples, training_kept_samples,
                accuracy, precision_score, recall_score, f1_score,
                name, model_file_path, metadata_file_path,
                excluded_performers
              ) VALUES (?, ?, 'completed', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              specificModelId,
              Math.floor(Date.now() / 1000),
              duration,
              modelData.metrics.total_samples || 0,
              modelData.metrics.deleted_samples || 0,
              modelData.metrics.kept_samples || 0,
              modelData.metrics.accuracy || 0,
              modelData.metrics.precision || 0,
              modelData.metrics.recall || 0,
              modelData.metrics.f1 || 0,
              `Model ${new Date().toISOString().split('T')[0]} (${modelType === 'image' ? 'Image' : 'Video'})`,
              modelFilePath,
              metadataFilePath,
              model.excluded_performers || '[]'
            );
          } else {
            // Update existing model
            updateModelAfterTraining(specificModelId, modelData.metrics, duration);
          }
        });
        
        // Delete or update the base model entry (without _image/_video suffix)
        // since we now have separate models
        const baseModel = db.prepare('SELECT id FROM ml_models WHERE id = ?').get(modelId);
        if (baseModel) {
          db.prepare('UPDATE ml_models SET status = ? WHERE id = ?').run('completed', modelId);
        }
      } else if (response.data.metrics) {
        // Fallback for old single-model response
        updateModelAfterTraining(modelId, response.data.metrics, duration);
      }
      
      job.progress = 100;
      job.status = 'completed';
      
      // Update job status
      db.prepare(`
        UPDATE ml_training_jobs 
        SET status = 'completed', progress = 100, completed_at = ?
        WHERE job_id = ?
      `).run(Math.floor(Date.now() / 1000), jobId);
      
    } catch (error) {
      console.error('Training error:', error);
      job.status = 'failed';
      job.error = error.message;
      
      // Update job and model status
      db.prepare(`
        UPDATE ml_training_jobs 
        SET status = 'failed', error = ?
        WHERE job_id = ?
      `).run(error.message, jobId);
      
      db.prepare(`
        UPDATE ml_models 
        SET status = 'failed'
        WHERE id = ?
      `).run(modelId);
    }
  })();
  
  return { jobId, modelId };
}

/**
 * Get training job status
 */
function getJobStatus(jobId) {
  const job = trainingJobs.get(jobId);
  if (!job) {
    // Check database
    const dbJob = db.prepare('SELECT * FROM ml_training_jobs WHERE job_id = ?').get(jobId);
    return dbJob || null;
  }
  return job;
}

/**
 * Get predictions for a performer
 */
async function getPredictions(performerId, modelId = null) {
  // Use active model if not specified
  if (!modelId) {
    const activeModel = getActiveModel();
    if (!activeModel) {
      throw new Error('No active model found');
    }
    modelId = activeModel.id;
  }
  
  // Get cached predictions
  const predictions = db.prepare(`
    SELECT 
      p.*,
      ci.file_path,
      ci.file_size
    FROM ml_predictions p
    JOIN content_items ci ON p.content_item_id = ci.id
    WHERE ci.performer_id = ? AND p.model_id = ?
  `).all(performerId, modelId);
  
  return predictions;
}

/**
 * Generate predictions for a performer
 */
async function generatePredictions(performerId, modelId = null) {
  console.log('generatePredictions called for performer:', performerId, 'modelId:', modelId);
  
  // Use active model if not specified
  if (!modelId) {
    const activeModel = getActiveModel();
    if (!activeModel) {
      throw new Error('No active model found');
    }
    modelId = activeModel.id;
  }
  
  console.log('Using modelId:', modelId);
  
  // Check if this is a dual-model system
  const baseId = modelId.replace(/_image$/, '').replace(/_video$/, '');
  const imageModelId = `${baseId}_image`;
  const videoModelId = `${baseId}_video`;
  
  console.log('Looking for models:', imageModelId, videoModelId);
  
  const imageModel = db.prepare('SELECT * FROM ml_models WHERE id = ?').get(imageModelId);
  const videoModel = db.prepare('SELECT * FROM ml_models WHERE id = ?').get(videoModelId);
  
  console.log('Image model found:', !!imageModel, 'Video model found:', !!videoModel);
  
  if (!imageModel && !videoModel) {
    throw new Error('No models found for prediction');
  }
  
  // Get all files for this performer with CLIP embeddings
  const files = db.prepare(`
    SELECT 
      ci.id,
      ci.file_path,
      ci.file_type,
      ci.file_size,
      cce.clip_embedding
    FROM content_items ci
    JOIN content_clip_embeddings cce ON ci.id = cce.content_item_id
    WHERE ci.performer_id = ?
  `).all(performerId);
  
  console.log('Files with CLIP embeddings:', files.length);
  
  if (files.length === 0) {
    return [];
  }
  
  const predictions = [];
  
  // Predict with image model if it exists
  if (imageModel) {
    const imageFiles = files.filter(f => f.file_type === 'image');
    console.log('Image files to predict:', imageFiles.length);
    if (imageFiles.length > 0) {
      const response = await axios.post(
        `${ML_SERVICE_URL}/predict`,
        {
          model_id: baseId,  // Use base ID, not the full ID with _image suffix
          data: imageFiles.map(f => ({
            id: f.id,
            file_type: f.file_type,
            clip_embedding: f.clip_embedding
          }))
        },
        { timeout: 60000 }
      );
      console.log('Image predictions received:', response.data.predictions?.length || 0);
      predictions.push(...response.data.predictions);
    }
  }
  
  // Predict with video model if it exists
  if (videoModel) {
    const videoFiles = files.filter(f => f.file_type === 'video');
    console.log('Video files to predict:', videoFiles.length);
    if (videoFiles.length > 0) {
      const response = await axios.post(
        `${ML_SERVICE_URL}/predict`,
        {
          model_id: baseId,  // Use base ID, not the full ID with _video suffix
          data: videoFiles.map(f => ({
            id: f.id,
            file_type: f.file_type,
            clip_embedding: f.clip_embedding
          }))
        },
        { timeout: 60000 }
      );
      console.log('Video predictions received:', response.data.predictions?.length || 0);
      predictions.push(...response.data.predictions);
    }
  }
  
  console.log('Total predictions:', predictions.length);
  
  if (predictions.length === 0) {
    return [];
  }
  
  // Store predictions in database
  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO ml_predictions 
    (model_id, content_item_id, prediction, confidence)
    VALUES (?, ?, ?, ?)
  `);
  
  const storeTx = db.transaction((preds) => {
    for (const pred of preds) {
      // Store with the appropriate model ID based on file type
      const file = files.find(f => f.id === pred.id);
      const usedModelId = file.file_type === 'image' ? imageModelId : videoModelId;
      insertStmt.run(usedModelId, pred.id, pred.prediction, pred.confidence);
    }
  });
  
  storeTx(predictions);
  
  console.log('Predictions stored in database');
  
  // Return predictions with file information
  const fullPredictions = db.prepare(`
    SELECT 
      p.prediction,
      p.confidence,
      ci.id as content_item_id,
      ci.file_path,
      ci.file_type,
      ci.file_size
    FROM ml_predictions p
    JOIN content_items ci ON p.content_item_id = ci.id
    WHERE ci.performer_id = ? AND (p.model_id = ? OR p.model_id = ?)
  `).all(performerId, imageModelId, videoModelId);
  
  console.log('Returning', fullPredictions.length, 'predictions');
  
  // Add file_name extracted from file_path
  return fullPredictions.map(pred => ({
    ...pred,
    file_name: path.basename(pred.file_path)
  }));
}

/**
 * Delete a model (deletes both image and video models)
 */
async function deleteModel(modelId) {
  const baseId = modelId.replace(/_image$/, '').replace(/_video$/, '');
  const imageModelId = `${baseId}_image`;
  const videoModelId = `${baseId}_video`;
  
  // Always try to delete both models plus the base (placeholder) model
  const modelsToDelete = [
    db.prepare('SELECT * FROM ml_models WHERE id = ?').get(imageModelId),
    db.prepare('SELECT * FROM ml_models WHERE id = ?').get(videoModelId),
    db.prepare('SELECT * FROM ml_models WHERE id = ?').get(baseId)
  ].filter(Boolean);
  
  for (const model of modelsToDelete) {
    // Delete predictions first (in case cascade doesn't work)
    try {
      db.prepare('DELETE FROM ml_predictions WHERE model_id = ?').run(model.id);
    } catch (err) {
      console.error('Error deleting predictions:', err);
    }
    
    // Delete files
    try {
      if (model.model_file_path && await fs.pathExists(model.model_file_path)) {
        await fs.remove(model.model_file_path);
      }
      if (model.metadata_file_path && await fs.pathExists(model.metadata_file_path)) {
        await fs.remove(model.metadata_file_path);
      }
    } catch (err) {
      console.error('Error deleting model files:', err);
    }
    
    // Delete from database
    db.prepare('DELETE FROM ml_models WHERE id = ?').run(model.id);
  }
  
  return { success: true };
}

module.exports = {
  getModelsPath,
  ensureModelsFolder,
  getTrainingDataStats,
  exportTrainingData,
  getAllModels,
  getActiveModel,
  setActiveModel,
  startTraining,
  getJobStatus,
  getPredictions,
  generatePredictions,
  deleteModel
};
