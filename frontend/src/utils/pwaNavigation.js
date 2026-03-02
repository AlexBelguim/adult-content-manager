/**
 * Utility to detect if app is running as an installed PWA
 */
export const isPWA = () => {
    // Check if running in standalone mode (installed PWA)
    if (window.matchMedia('(display-mode: standalone)').matches) {
        return true;
    }
    // Check for iOS PWA
    if (window.navigator.standalone === true) {
        return true;
    }
    return false;
};

/**
 * Smart navigation function that:
 * - In PWA mode: navigates in same window
 * - In browser mode: opens new tab
 * 
 * @param {string} url - URL to navigate to
 * @param {function} navigate - React Router navigate function (optional, for internal routes)
 */
export const openLink = (url, navigate) => {
    // If it's an external URL, always open in new tab (if possible)
    const isExternal = url.startsWith('http://') || url.startsWith('https://');

    if (isExternal) {
        window.open(url, '_blank');
        return;
    }

    // For internal URLs
    if (isPWA()) {
        // In PWA mode: navigate in same window
        if (navigate && url.startsWith('/')) {
            // Use React Router for SPA navigation
            navigate(url);
        } else {
            // Use regular navigation for non-SPA routes
            window.location.href = url;
        }
    } else {
        // In browser mode: open new tab
        window.open(url, '_blank');
    }
};

/**
 * Smart window.open replacement
 * Use this instead of window.open() for better PWA support
 * 
 * @param {string} url - URL to open
 * @param {string} target - Target window name
 * @param {string} features - Window features
 * @returns {Window|null} - Opened window or null
 */
export const smartOpen = (url, target = '_blank', features) => {
    const isExternal = url.startsWith('http://') || url.startsWith('https://');

    if (isPWA() && !isExternal && target === '_blank') {
        // In PWA mode for internal links: navigate in same window
        window.location.href = url;
        return null;
    } else {
        // Normal window.open behavior
        return window.open(url, target, features);
    }
};
