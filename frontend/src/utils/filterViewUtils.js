// Utility functions extracted from FilterView for reuse in phone components

export const fetchPerformers = async () => {
  try {
    const response = await fetch('/api/performers/filter');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  } catch (err) {
    console.error('Error loading performers for filter:', err);
    return [];
  }
};

export const handleChangeThumbnail = async (performerId) => {
  try {
    const response = await fetch(`/api/performers/${performerId}/random-thumbnail`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      return true;
    } else {
      console.error('Failed to change thumbnail');
      return false;
    }
  } catch (error) {
    console.error('Error changing thumbnail:', error);
    return false;
  }
};

export const handleDeletePerformer = async (performerId, deleteFromSystem = false) => {
  try {
    const response = await fetch(`/api/performers/${performerId}${deleteFromSystem ? '?deleteFromSystem=true' : ''}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      console.log('Performer deleted successfully');
      return true;
    } else {
      const errorData = await response.json();
      console.error('Failed to delete performer:', errorData.error);
      throw new Error(errorData.error || 'Failed to delete performer');
    }
  } catch (error) {
    console.error('Error deleting performer:', error);
    throw error;
  }
};

export const handleCompletePerformer = async (performerId) => {
  try {
    const response = await fetch(`/api/performers/${performerId}/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      const result = await response.json();
      return result;
    } else {
      console.error('Failed to complete performer');
      return null;
    }
  } catch (error) {
    console.error('Error completing performer:', error);
    return null;
  }
};

export const sortPerformers = (performers, sortType, searchTerm = '') => {
  return [...performers]
    .filter(performer => 
      searchTerm === '' || 
      performer.name.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a, b) => {
      if (sortType === 'size-desc') return (b.total_size_gb || 0) - (a.total_size_gb || 0);
      if (sortType === 'size-asc') return (a.total_size_gb || 0) - (b.total_size_gb || 0);
      if (sortType === 'name-asc') return (a.name || '').localeCompare(b.name || '');
      if (sortType === 'name-desc') return (b.name || '').localeCompare(a.name || '');
      if (sortType === 'date-desc') return new Date(b.import_date || 0) - new Date(a.import_date || 0);
      if (sortType === 'date-asc') return new Date(a.import_date || 0) - new Date(b.import_date || 0);
      if (sortType === 'funscript-desc') return (b.funscript_vids_count || 0) - (a.funscript_vids_count || 0);
      if (sortType === 'funscript-asc') return (a.funscript_vids_count || 0) - (b.funscript_vids_count || 0);
      return 0;
    });
};

export const getNextPerformer = (currentPerformerId, sortedPerformers) => {
  const currentIndex = sortedPerformers.findIndex(p => p.id === currentPerformerId);
  if (currentIndex !== -1 && currentIndex < sortedPerformers.length - 1) {
    return sortedPerformers[currentIndex + 1];
  }
  return null;
};
