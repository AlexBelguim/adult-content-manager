// Shared modal styles for consistent appearance across settings modals

export const modalContainerStyle = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: { xs: '90%', sm: '80%', md: '60%' },
  maxWidth: 600,
  maxHeight: '90vh',
  overflow: 'auto',
  bgcolor: '#ffffff',
  borderRadius: 3,
  boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
  border: '1px solid #e0e0e0',
  p: 0
};

export const modalHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  p: 3,
  pb: 2,
  borderBottom: '2px solid #e0e0e0',
  bgcolor: '#f8f9fa'
};

export const modalTitleStyle = {
  fontWeight: 'bold',
  mb: 0.5,
  color: '#1a1a1a'
};

export const modalSubtitleStyle = {
  color: '#666666',
  fontWeight: 'medium'
};

export const modalCloseButtonStyle = {
  color: '#666666',
  '&:hover': { bgcolor: '#e0e0e0' }
};

export const modalContentStyle = {
  p: 3
};

export const modalSectionStyle = {
  mb: 4
};

export const modalSectionTitleStyle = {
  fontWeight: 'bold',
  mb: 2,
  color: '#1a1a1a'
};

export const modalButtonGroupStyle = {
  display: 'flex',
  gap: 2,
  flexWrap: 'wrap',
  mb: 2,
  alignItems: 'center',
  justifyContent: 'flex-start'
};

export const modalFormGroupStyle = {
  gap: 2
};

export const modalTextStyle = {
  color: '#1a1a1a',
  fontWeight: 'medium'
};

export const modalActionsStyle = {
  p: 3,
  pt: 0,
  borderTop: '1px solid #e0e0e0',
  bgcolor: '#f8f9fa',
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 2
};

export const modalActionButtonsStyle = {
  display: 'flex',
  gap: 2,
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'flex-start'
};

export const modalButtonStyle = {
  fontWeight: 'bold',
  px: 3,
  py: 1.5,
  minWidth: 140,
  textTransform: 'none'
};
