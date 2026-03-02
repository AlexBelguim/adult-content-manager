import React, { useState, useEffect } from 'react';
import { 
  Box, 
  Typography, 
  Chip, 
  Accordion, 
  AccordionSummary, 
  AccordionDetails,
  Grid,
  Button,
  Switch,
  FormControlLabel
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

const REASONING_CATEGORIES = {
  Face: ['Perfect', 'Cute', 'Sexy', 'Ugly', 'Old', 'Young', 'Makeup', 'Natural', 'Eyes', 'Lips'],
  'Facial Expression': ['Perfect', 'Sexual', 'Teasing', 'Hot', 'Sticking Out Tongue', 'Weird', 'Cute'],
  Hair: ['Perfect', 'Beautiful', 'Straight', 'Curly', 'Haircut', 'Blonde', 'Brunette', 'Redhead', 'Black', 'Dyed', 'Long', 'Short', 'Ponytail', 'Messy'],
  Body: ['Perfect', 'Skinny', 'Anorexic', 'Fit', 'Curvy', 'Chubby', 'Fat', 'Muscular', 'Tall', 'Petite'],
  Breasts: ['Perfect', 'Round', 'Small', 'Medium', 'Large', 'Huge', 'Fake', 'Natural', 'Perky', 'Droopy', 'Uneven'],
  Nipples: ['Perfect', 'Small', 'Large', 'Puffy', 'Inverted', 'Pierced', 'Dark', 'Pink'],
  Ass: ['Perfect', 'Small', 'Medium', 'Large', 'Huge', 'Round', 'Flat', 'Gaping'],
  Pussy: ['Perfect', 'Shaved', 'Trimmed', 'Hairy', 'Innie', 'Outie', 'Puffy', 'Wet', 'Gaping'],
  Skin: ['Perfect', 'Pale', 'Fair', 'Tan', 'Dark', 'Oil', 'Tattoos', 'Piercings', 'Freckles'],
  Pose: ['Perfect', 'Weird', 'Bad', 'Great', 'Sexual'],
  Action: ['Perfect', 'Solo', 'BJ', 'Fuck', 'Anal', 'DP', 'Group', 'Lesbian', 'Handjob', 'Titjob', 'Footjob', 'Riding', 'Cowgirl', 'Doggy', 'Missionary', 'Toy', 'Dildo', 'Masturbation', 'Cumshot', 'Creampie', 'Facial'],
  Camera: ['Perfect', 'Selfie', 'POV', 'Pro', 'Amateur', 'Webcam', 'Close-up', 'Wide'],
  Quality: ['Perfect', 'Good Lighting', 'Bad Lighting', 'Good Focus', 'Blurry', 'High Res', 'Low Res'],
  Angle: ['Perfect', 'Weird', 'Bad', 'Great', 'Sexual', 'Front', 'Back', 'Side', 'Top', 'Bottom']
};

const ReasoningSelector = ({ selectedReasons = {}, onChange }) => {
  const [expanded, setExpanded] = useState({});

  const handleToggleCategory = (category, isChecked) => {
    const newSelectedReasons = { ...selectedReasons };
    
    if (isChecked) {
      // If turning on, start with empty list (just the category selected)
      if (!newSelectedReasons[category]) {
        newSelectedReasons[category] = [];
      }
      // Expand
      setExpanded(prev => ({ ...prev, [category]: true }));
    } else {
      // If turning off, remove all tags for this category
      delete newSelectedReasons[category];
      // Collapse (optional, but feels right)
      // setExpanded(prev => ({ ...prev, [category]: false }));
    }

    onChange(newSelectedReasons);
  };

  const handleToggleReason = (category, reason) => {
    const currentCategoryReasons = selectedReasons[category] || [];
    let newCategoryReasons;

    if (currentCategoryReasons.includes(reason)) {
      newCategoryReasons = currentCategoryReasons.filter(r => r !== reason);
    } else {
      newCategoryReasons = [...currentCategoryReasons, reason];
    }

    const newSelectedReasons = {
      ...selectedReasons,
      [category]: newCategoryReasons
    };

    // Note: We do NOT remove the category if the list is empty, 
    // because the user might want to select just the category itself.
    
    onChange(newSelectedReasons);
  };

  const handleChange = (panel) => (event, isExpanded) => {
    setExpanded(prev => ({
      ...prev,
      [panel]: isExpanded
    }));
  };

  return (
    <Box sx={{ width: '100%', mt: 2 }}>
      <Typography variant="subtitle2" gutterBottom>
        Reasoning / Tags (Optional)
      </Typography>
      
      {Object.entries(REASONING_CATEGORIES).map(([category, reasons]) => (
        <Accordion 
          key={category} 
          expanded={!!expanded[category]} 
          onChange={handleChange(category)}
          disableGutters
          elevation={0}
          sx={{ 
            border: '1px solid rgba(0, 0, 0, 0.12)',
            '&:not(:last-child)': { borderBottom: 0 },
            '&:before': { display: 'none' },
          }}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', justifyContent: 'space-between', pr: 2 }}>
              <Box onClick={(e) => e.stopPropagation()}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={!!selectedReasons[category]}
                      onChange={(e) => handleToggleCategory(category, e.target.checked)}
                      size="small"
                    />
                  }
                  label={category}
                />
              </Box>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {(selectedReasons[category] || []).map((reason) => (
                  <Chip 
                    key={reason} 
                    label={reason} 
                    size="small" 
                    color="primary" 
                    variant="outlined" 
                  />
                ))}
              </Box>
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {reasons.map((reason) => (
                <Chip
                  key={reason}
                  label={reason}
                  onClick={() => handleToggleReason(category, reason)}
                  color={selectedReasons[category]?.includes(reason) ? "primary" : "default"}
                  variant={selectedReasons[category]?.includes(reason) ? "filled" : "outlined"}
                  clickable
                />
              ))}
            </Box>
          </AccordionDetails>
        </Accordion>
      ))}
    </Box>
  );
};

export default ReasoningSelector;
