import React from 'react';

/**
 * Component to display country flag images using flagcdn.com
 * Handles cases where Windows doesn't render colored flag emojis properly
 */
function FlagEmoji({ countryCode, size = '1.3rem', style = {} }) {
  if (!countryCode) return null;

  // Extract 2-letter country code from emoji if needed
  let code = countryCode;
  
  // If it's an emoji (contains regional indicators), convert back to 2-letter code
  if (countryCode.length > 2) {
    const codePoints = [];
    for (let i = 0; i < countryCode.length; i++) {
      const cp = countryCode.codePointAt(i);
      if (cp >= 0x1F1E6 && cp <= 0x1F1FF) {
        // Convert regional indicator to letter: 0x1F1E6 = A
        const letter = String.fromCharCode(65 + (cp - 0x1F1E6));
        codePoints.push(letter);
      }
      if (cp > 0xFFFF) i++; // Skip surrogate pair
    }
    code = codePoints.join('');
  }

  // Normalize to uppercase 2-letter code
  code = code.toUpperCase().trim();
  
  if (code.length !== 2 || !/^[A-Z]{2}$/.test(code)) {
    return <span style={style}>{countryCode}</span>;
  }

  // Use flagcdn.com for reliable flag images
  const flagUrl = `https://flagcdn.com/${code.toLowerCase()}.svg`;

  return (
    <img 
      src={flagUrl}
      alt={`${code} flag`}
      title={code}
      style={{
        width: size,
        height: size,
        display: 'inline-block',
        verticalAlign: 'middle',
        objectFit: 'contain',
        ...style
      }}
      onError={(e) => {
        // Fallback to text if image fails to load
        e.target.style.display = 'none';
        const textNode = document.createTextNode(code);
        e.target.parentNode.insertBefore(textNode, e.target);
      }}
    />
  );
}

export default FlagEmoji;
