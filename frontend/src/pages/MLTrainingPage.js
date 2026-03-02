import React, { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  TextField,
  Checkbox,
  FormControlLabel,
  Grid,
  Divider,
  Alert,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Collapse,
  Tooltip,
  InputAdornment
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import CloudIcon from '@mui/icons-material/Cloud';
import ComputerIcon from '@mui/icons-material/Computer';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ReasoningSelector from '../components/ReasoningSelector';

function MLTrainingPage({ basePath }) {
  // Training Data State
  const [keepImagesPerPerformer, setKeepImagesPerPerformer] = useState(200);
  const [deleteImagesPerPerformer, setDeleteImagesPerPerformer] = useState(200);
  const [maxKeepPerformers, setMaxKeepPerformers] = useState(50);
  const [maxDeletePerformers, setMaxDeletePerformers] = useState(50);
  const [balanceAcrossPerformers, setBalanceAcrossPerformers] = useState(true);
  const [datasetStats, setDatasetStats] = useState(null);
  const [generatingDataset, setGeneratingDataset] = useState(false);

  // Dataset Review State
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [reviewDataset, setReviewDataset] = useState(null);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [reviewTab, setReviewTab] = useState('KEEP');
  const [reviewReasoning, setReviewReasoning] = useState({});
  const [savingReasoning, setSavingReasoning] = useState(false);

  // Guide Toggle States
  const [showLocalGuide, setShowLocalGuide] = useState(false);
  const [showVastGuide, setShowVastGuide] = useState(false);
  const [showModelsLocation, setShowModelsLocation] = useState(false);
  
  // Vast.ai SSH Configuration
  const [vastSshHost, setVastSshHost] = useState('');
  const [vastSshPort, setVastSshPort] = useState('');
  const [copiedCommand, setCopiedCommand] = useState('');

  const parseReasoning = (data) => {
    if (!data) return {};
    if (typeof data === 'object' && !Array.isArray(data)) return data;
    return {};
  };

  const copyToClipboard = (text, commandId) => {
    navigator.clipboard.writeText(text);
    setCopiedCommand(commandId);
    setTimeout(() => setCopiedCommand(''), 2000);
  };

  // Helper component for copy button
  const CopyButton = ({ text, commandId }) => (
    <Tooltip title={copiedCommand === commandId ? "Copied!" : "Copy"}>
      <IconButton 
        size="small" 
        onClick={() => copyToClipboard(text, commandId)}
        sx={{ ml: 1 }}
      >
        {copiedCommand === commandId ? <CheckCircleIcon color="success" fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
      </IconButton>
    </Tooltip>
  );

  // Helper component for command boxes
  const CommandBox = ({ label, command, commandId }) => (
    <Box sx={{ mb: 2 }}>
      <Typography variant="subtitle2" color="text.secondary" gutterBottom>{label}</Typography>
      <Box sx={{ 
        display: 'flex', 
        alignItems: 'center', 
        bgcolor: 'grey.900', 
        borderRadius: 1, 
        p: 1.5,
        fontFamily: 'monospace',
        fontSize: '0.85rem',
        color: 'grey.100',
        overflowX: 'auto'
      }}>
        <code style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{command}</code>
        <CopyButton text={command} commandId={commandId} />
      </Box>
    </Box>
  );

  // Generate Vast.ai commands based on user input
  const getVastCommands = () => {
    const host = vastSshHost || 'your-instance.vast.ai';
    const port = vastSshPort || '22';
    const sshBase = `ssh -p ${port} root@${host}`;
    
    return {
      findSshKey: 'cat ~/.ssh/id_rsa.pub',
      findSshKeyWindows: 'type %USERPROFILE%\\.ssh\\id_rsa.pub',
      generateSshKey: 'ssh-keygen -t rsa -b 4096',
      sshConnect: sshBase,
      uploadDataset: `scp -P ${port} -r ./backend/ml-datasets root@${host}:/workspace/`,
      uploadFineTuned: `scp -P ${port} -r ./backend/fine-tuned-models/* root@${host}:/workspace/models/`,
      downloadModel: `scp -P ${port} -r root@${host}:/workspace/output/fine-tuned-model ./backend/fine-tuned-models/`,
      downloadAllModels: `scp -P ${port} -r root@${host}:/workspace/output/* ./backend/fine-tuned-models/`,
      vastInstallDeps: `${sshBase} "pip install torch transformers accelerate bitsandbytes peft"`,
      vastStartTraining: `${sshBase} "cd /workspace && python train.py --dataset ./ml-datasets --output ./output"`,
    };
  };

  const vastCommands = getVastCommands();

  // Get fine-tuned models location
  const getModelsPath = () => {
    return './backend/fine-tuned-models/';
  };

  const generateTrainingDataset = async () => {
    setGeneratingDataset(true);
    try {
      const response = await fetch('/api/ml-training/generate-dataset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          basePath,
          keepImagesPerPerformer,
          deleteImagesPerPerformer,
          maxKeepPerformers,
          maxDeletePerformers,
          balanceAcrossPerformers
        })
      });
      
      const data = await response.json();
      setDatasetStats(data);
    } catch (error) {
      console.error('Error generating dataset:', error);
      alert('Error generating training dataset');
    } finally {
      setGeneratingDataset(false);
    }
  };

  const openReviewModal = async () => {
    if (!datasetStats?.datasetId) return;
    
    try {
      const response = await fetch(`/api/ml-training/dataset/${datasetStats.datasetId}/content`);
      const data = await response.json();
      
      if (data.success) {
        setReviewDataset(data.dataset);
        setReviewModalOpen(true);
        setReviewIndex(0);
        setReviewTab('KEEP');
        // Initialize reasoning for first item
        const firstItem = data.dataset.keepImages[0];
        setReviewReasoning(parseReasoning(firstItem?.reasoning || ''));
      }
    } catch (error) {
      console.error('Error fetching dataset content:', error);
      alert('Error loading dataset for review');
    }
  };

  const handleSaveReasoning = async () => {
    if (!reviewDataset) return;
    
    const currentList = reviewTab === 'KEEP' ? reviewDataset.keepImages : reviewDataset.deleteImages;
    const currentItem = currentList[reviewIndex];
    
    if (!currentItem) return;
    
    setSavingReasoning(true);
    try {
      const response = await fetch(`/api/ml-training/dataset/${datasetStats.datasetId}/reasoning`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imagePath: currentItem.path,
          reasoning: reviewReasoning
        })
      });
      
      if (response.ok) {
        // Update local state
        const newDataset = { ...reviewDataset };
        const list = reviewTab === 'KEEP' ? newDataset.keepImages : newDataset.deleteImages;
        list[reviewIndex].reasoning = reviewReasoning;
        setReviewDataset(newDataset);
      } else {
        alert('Failed to save reasoning');
      }
    } catch (error) {
      console.error('Error saving reasoning:', error);
      alert('Error saving reasoning');
    } finally {
      setSavingReasoning(false);
    }
  };

  const handleReviewNavigate = (direction) => {
    const currentList = reviewTab === 'KEEP' ? reviewDataset.keepImages : reviewDataset.deleteImages;
    let newIndex = reviewIndex + direction;
    
    if (newIndex < 0) newIndex = 0;
    if (newIndex >= currentList.length) newIndex = currentList.length - 1;
    
    setReviewIndex(newIndex);
    setReviewReasoning(parseReasoning(currentList[newIndex]?.reasoning || ''));
  };

  const handleTabChange = (newTab) => {
    setReviewTab(newTab);
    setReviewIndex(0);
    const list = newTab === 'KEEP' ? reviewDataset.keepImages : reviewDataset.deleteImages;
    setReviewReasoning(parseReasoning(list[0]?.reasoning || ''));
  };

  return (
    <Box sx={{ p: 3, maxWidth: 1400, margin: '0 auto' }}>
      <Typography variant="h4" gutterBottom>
        ML Training - Quality Filter
      </Typography>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        Train a vision model to filter content based on visual quality (lighting, composition, clarity)
      </Typography>

      <Divider sx={{ my: 3 }} />

      {/* Training Data Selection */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Training Data Configuration
        </Typography>

        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <Typography variant="subtitle2" gutterBottom>
              Keep Examples (from after folder)
            </Typography>
            <TextField
              fullWidth
              type="number"
              label="Images per performer"
              value={keepImagesPerPerformer}
              onChange={(e) => setKeepImagesPerPerformer(parseInt(e.target.value))}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              type="number"
              label="Max performers (0 = all)"
              value={maxKeepPerformers}
              onChange={(e) => setMaxKeepPerformers(parseInt(e.target.value))}
              sx={{ mb: 2 }}
            />
            {datasetStats && (
              <Box>
                <Typography variant="body2">Performers: {datasetStats.keepPerformers}</Typography>
                <Typography variant="body2">Total images: {datasetStats.totalKeepImages}</Typography>
              </Box>
            )}
          </Grid>

          <Grid item xs={12} md={6}>
            <Typography variant="subtitle2" gutterBottom>
              Delete Examples (from training folder)
            </Typography>
            <TextField
              fullWidth
              type="number"
              label="Images per performer"
              value={deleteImagesPerPerformer}
              onChange={(e) => setDeleteImagesPerPerformer(parseInt(e.target.value))}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              type="number"
              label="Max performers (0 = all)"
              value={maxDeletePerformers}
              onChange={(e) => setMaxDeletePerformers(parseInt(e.target.value))}
              sx={{ mb: 2 }}
            />
            {datasetStats && (
              <Box>
                <Typography variant="body2">Performers: {datasetStats.deletePerformers}</Typography>
                <Typography variant="body2">Total images: {datasetStats.totalDeleteImages}</Typography>
              </Box>
            )}
          </Grid>

          <Grid item xs={12}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={balanceAcrossPerformers}
                  onChange={(e) => setBalanceAcrossPerformers(e.target.checked)}
                />
              }
              label="Balance across performers (prevents model from learning performer preferences)"
            />
          </Grid>

          <Grid item xs={12}>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <Button
                variant="contained"
                onClick={generateTrainingDataset}
                disabled={generatingDataset || !basePath}
              >
                {generatingDataset ? 'Generating...' : 'Generate Training Dataset'}
              </Button>
              <Button
                variant="outlined"
                onClick={openReviewModal}
                disabled={!datasetStats}
              >
                Review & Edit Reasoning
              </Button>
            </Box>
          </Grid>
        </Grid>

        {datasetStats && (
          <Alert severity="success" sx={{ mt: 2 }}>
            Dataset ready: {datasetStats.totalKeepImages + datasetStats.totalDeleteImages} total images
            ({datasetStats.totalKeepImages} keep, {datasetStats.totalDeleteImages} delete)
          </Alert>
        )}
      </Paper>

      {/* Review Modal */}
      <Dialog 
        open={reviewModalOpen} 
        onClose={() => setReviewModalOpen(false)}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle>
          Review Dataset & Add Reasoning
        </DialogTitle>
        <DialogContent>
          {reviewDataset && (
            <Box sx={{ height: '70vh', display: 'flex', flexDirection: 'column' }}>
              <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
                <Button 
                  onClick={() => handleTabChange('KEEP')}
                  sx={{ borderBottom: reviewTab === 'KEEP' ? 2 : 0, borderRadius: 0 }}
                >
                  Keep Images ({reviewDataset.keepImages.length})
                </Button>
                <Button 
                  onClick={() => handleTabChange('DELETE')}
                  sx={{ borderBottom: reviewTab === 'DELETE' ? 2 : 0, borderRadius: 0 }}
                >
                  Delete Images ({reviewDataset.deleteImages.length})
                </Button>
              </Box>

              <Box sx={{ display: 'flex', flexGrow: 1, overflow: 'hidden', gap: 2, mt: 2 }}>
                {/* Left Side - Image */}
                <Box sx={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <Box sx={{ flexGrow: 1, bgcolor: 'black', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 1 }}>
                    <img 
                      src={`/api/files/raw?path=${encodeURIComponent(
                        (reviewTab === 'KEEP' ? reviewDataset.keepImages : reviewDataset.deleteImages)[reviewIndex]?.path || ''
                      )}`}
                      alt="Review"
                      style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                    />
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 1 }}>
                    <Button onClick={() => handleReviewNavigate(-1)} disabled={reviewIndex === 0}>
                      Previous
                    </Button>
                    <Typography>
                      {reviewIndex + 1} / {(reviewTab === 'KEEP' ? reviewDataset.keepImages : reviewDataset.deleteImages).length}
                    </Typography>
                    <Button onClick={() => handleReviewNavigate(1)} disabled={reviewIndex === (reviewTab === 'KEEP' ? reviewDataset.keepImages : reviewDataset.deleteImages).length - 1}>
                      Next
                    </Button>
                  </Box>
                </Box>

                {/* Right Side - Input */}
                <Box sx={{ flex: '0 0 450px', display: 'flex', flexDirection: 'column', overflowY: 'auto', pl: 2, borderLeft: 1, borderColor: 'divider', pr: 1 }}>
                  <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold' }}>
                    Custom Reasoning
                  </Typography>
                  <Typography variant="caption" color="text.secondary" paragraph>
                    Explain why this image should be {reviewTab === 'KEEP' ? 'kept' : 'deleted'} based on the criteria.
                  </Typography>
                  
                  <ReasoningSelector 
                    selectedReasons={reviewReasoning} 
                    onChange={setReviewReasoning} 
                  />

                  <Button 
                    variant="contained" 
                    fullWidth 
                    sx={{ mt: 1, mb: 2 }}
                    onClick={handleSaveReasoning}
                    disabled={savingReasoning}
                  >
                    {savingReasoning ? 'Saving...' : 'Save Reasoning'}
                  </Button>
                  {/* Show if reasoning is already saved in dataset */}
                  {(reviewTab === 'KEEP' ? reviewDataset.keepImages : reviewDataset.deleteImages)[reviewIndex]?.reasoning && (
                    <Alert severity="success" sx={{ mb: 2 }}>
                      Reasoning saved!
                    </Alert>
                  )}
                </Box>
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReviewModalOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Fine-tuned Models Location */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Box 
          sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
          onClick={() => setShowModelsLocation(!showModelsLocation)}
        >
          <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <FolderOpenIcon />
            Fine-tuned Models Location
          </Typography>
          <IconButton size="small">
            <ExpandMoreIcon sx={{ transform: showModelsLocation ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.3s' }} />
          </IconButton>
        </Box>
        
        <Collapse in={showModelsLocation}>
          <Box sx={{ mt: 2 }}>
            <Alert severity="info" sx={{ mb: 2 }}>
              Place your fine-tuned model files in this directory for them to be detected by the ML service.
            </Alert>
            <CommandBox 
              label="Models Directory Path" 
              command={getModelsPath()} 
              commandId="modelsPath" 
            />
            <Typography variant="body2" color="text.secondary">
              Expected structure: <code>fine-tuned-models/your-model-name/</code> containing model weights and config files.
            </Typography>
          </Box>
        </Collapse>
      </Paper>

      {/* Local Training Guide */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Box 
          sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
          onClick={() => setShowLocalGuide(!showLocalGuide)}
        >
          <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ComputerIcon />
            Local Training & Inference Guide
          </Typography>
          <IconButton size="small">
            <ExpandMoreIcon sx={{ transform: showLocalGuide ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.3s' }} />
          </IconButton>
        </Box>
        
        <Collapse in={showLocalGuide}>
          <Box sx={{ mt: 2 }}>
            <Alert severity="warning" sx={{ mb: 2 }}>
              Local training requires a powerful GPU (16GB+ VRAM recommended). For inference, 8GB VRAM is usually sufficient.
            </Alert>
            
            <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold', mt: 2 }}>
              1. Install Dependencies
            </Typography>
            <CommandBox 
              label="Install PyTorch with CUDA" 
              command="pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121" 
              commandId="localPytorch" 
            />
            <CommandBox 
              label="Install training dependencies" 
              command="pip install transformers accelerate bitsandbytes peft datasets pillow" 
              commandId="localDeps" 
            />
            
            <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold', mt: 3 }}>
              2. Start the Vision LLM Service
            </Typography>
            <CommandBox 
              label="Windows" 
              command="cd vision-llm-service && start-vision-llm.bat" 
              commandId="localStartWin" 
            />
            <CommandBox 
              label="Linux/Mac" 
              command="cd vision-llm-service && ./start-vision-llm.sh" 
              commandId="localStartLinux" 
            />
            
            <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold', mt: 3 }}>
              3. Training (if you have sufficient VRAM)
            </Typography>
            <CommandBox 
              label="Start training script" 
              command="python vision-llm-service/train.py --dataset ./backend/ml-datasets --epochs 3 --output ./backend/fine-tuned-models" 
              commandId="localTrain" 
            />
            
            <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold', mt: 3 }}>
              4. Inference with Fine-tuned Model
            </Typography>
            <CommandBox 
              label="Start with custom model" 
              command="cd vision-llm-service && python app.py --model ../backend/fine-tuned-models/your-model-name" 
              commandId="localInference" 
            />
          </Box>
        </Collapse>
      </Paper>

      {/* Vast.ai Training Guide */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Box 
          sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
          onClick={() => setShowVastGuide(!showVastGuide)}
        >
          <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CloudIcon />
            Vast.ai Training & Inference Guide
          </Typography>
          <IconButton size="small">
            <ExpandMoreIcon sx={{ transform: showVastGuide ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.3s' }} />
          </IconButton>
        </Box>
        
        <Collapse in={showVastGuide}>
          <Box sx={{ mt: 2 }}>
            <Alert severity="info" sx={{ mb: 2 }}>
              Vast.ai offers affordable GPU rentals. Enter your SSH details below to generate copy-ready commands.
            </Alert>
            
            {/* SSH Configuration Inputs */}
            <Grid container spacing={2} sx={{ mb: 3 }}>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="SSH Host"
                  placeholder="e.g., ssh5.vast.ai"
                  value={vastSshHost}
                  onChange={(e) => setVastSshHost(e.target.value)}
                  helperText="From vast.ai instance details"
                  InputProps={{
                    startAdornment: <InputAdornment position="start">root@</InputAdornment>,
                  }}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="SSH Port"
                  placeholder="e.g., 42022"
                  value={vastSshPort}
                  onChange={(e) => setVastSshPort(e.target.value)}
                  helperText="Usually a 5-digit number"
                  InputProps={{
                    startAdornment: <InputAdornment position="start">-p</InputAdornment>,
                  }}
                />
              </Grid>
            </Grid>

            <Divider sx={{ my: 2 }} />
            
            <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold' }}>
              1. Find or Generate SSH Key
            </Typography>
            <CommandBox 
              label="Find existing SSH key (Linux/Mac)" 
              command={vastCommands.findSshKey} 
              commandId="vastFindSsh" 
            />
            <CommandBox 
              label="Find existing SSH key (Windows PowerShell)" 
              command={vastCommands.findSshKeyWindows} 
              commandId="vastFindSshWin" 
            />
            <CommandBox 
              label="Generate new SSH key (if none exists)" 
              command={vastCommands.generateSshKey} 
              commandId="vastGenSsh" 
            />
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Copy the public key content and paste it into your Vast.ai account settings → SSH Keys.
            </Typography>
            
            <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold', mt: 3 }}>
              2. Connect to Your Instance
            </Typography>
            <CommandBox 
              label="SSH into vast.ai instance" 
              command={vastCommands.sshConnect} 
              commandId="vastConnect" 
            />
            
            <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold', mt: 3 }}>
              3. Upload Training Data
            </Typography>
            <CommandBox 
              label="Upload dataset folder" 
              command={vastCommands.uploadDataset} 
              commandId="vastUploadDataset" 
            />
            <CommandBox 
              label="Upload existing fine-tuned models" 
              command={vastCommands.uploadFineTuned} 
              commandId="vastUploadModels" 
            />
            
            <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold', mt: 3 }}>
              4. Install Dependencies on Instance
            </Typography>
            <CommandBox 
              label="Install via SSH" 
              command={vastCommands.vastInstallDeps} 
              commandId="vastInstall" 
            />
            
            <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold', mt: 3 }}>
              5. Start Training on Instance
            </Typography>
            <CommandBox 
              label="Run training script" 
              command={vastCommands.vastStartTraining} 
              commandId="vastTrain" 
            />
            
            <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold', mt: 3 }}>
              6. Download Trained Model
            </Typography>
            <CommandBox 
              label="Download specific model" 
              command={vastCommands.downloadModel} 
              commandId="vastDownload" 
            />
            <CommandBox 
              label="Download all output models" 
              command={vastCommands.downloadAllModels} 
              commandId="vastDownloadAll" 
            />
            
            <Alert severity="success" sx={{ mt: 2 }}>
              <Typography variant="body2">
                <strong>Tip:</strong> Use <code>screen</code> or <code>tmux</code> on the instance so training continues even if you disconnect:
                <br />
                <code>screen -S training</code> → run commands → <code>Ctrl+A D</code> to detach → <code>screen -r training</code> to reattach
              </Typography>
            </Alert>
          </Box>
        </Collapse>
      </Paper>
    </Box>
  );
}

export default MLTrainingPage;
