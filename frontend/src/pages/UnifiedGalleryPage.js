import React, { useEffect } from 'react';
import UnifiedGallery from '../components/UnifiedGallery';

const UnifiedGalleryPage = ({ handyIntegration, handyCode, handyConnected }) => {
  useEffect(() => {
    console.log('🔍 UnifiedGalleryPage props:', { 
      handyConnected, 
      handyCode, 
      handyIntegration: !!handyIntegration 
    });
  }, [handyConnected, handyCode, handyIntegration]);

  return (
    <UnifiedGallery 
      handyIntegration={handyIntegration}
      handyCode={handyCode}
      handyConnected={handyConnected}
    />
  );
};

export default UnifiedGalleryPage;
