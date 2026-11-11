import React, { useMemo } from 'react';
import { Box } from '@mui/material';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import EmojiEventsOutlinedIcon from '@mui/icons-material/EmojiEventsOutlined';
import { ensureFlag } from '../../utils/countryFlags';
import FlagEmoji from '../FlagEmoji';
import { SideGroup, SideFacts, SideNote, SideMain, SIDE } from '../layout';

const parseScrapedTags = (raw) => {
  if (!raw) return [];
  try {
    const tags = JSON.parse(raw);
    return Array.isArray(tags) ? tags.filter(Boolean) : [];
  } catch (e) {
    return [];
  }
};

/**
 * The sidebar's Performer section of her gallery (it replaced the header above the grid): her scraped facts, only
 * those she has, her scraped tags on one line, and the page's main action, Rank images (Pictures only).
 */
const GalleryHero = ({ performer, age, onRank, rankEnabled }) => {
  const p = performer;
  const flag = p ? ensureFlag(p.country_flag) : null;

  const rows = useMemo(() => {
    if (!p) return [];
    const birthplace = p.birthplace ? (
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
        {flag && <FlagEmoji countryCode={flag} size="1rem" />}
        {p.birthplace}
      </Box>
    ) : null;
    return [
      p.age ? { label: 'Age', value: `${age}` } : null,
      p.born ? { label: 'Born', value: p.born } : null,
      birthplace ? { label: 'Birthplace', value: birthplace } : null,
      p.orientation ? { label: 'Sexuality', value: p.orientation } : null,
      p.height ? { label: 'Height', value: p.height } : null,
      p.weight ? { label: 'Weight', value: p.weight } : null,
      p.measurements ? { label: 'Measurements', value: p.measurements } : null,
      p.measurements_cup ? { label: 'Cup', value: p.measurements_cup } : null,
      p.body_type ? { label: 'Body', value: p.body_type } : null,
      p.pubic_hair ? { label: 'Grooming', value: p.pubic_hair } : null,
      p.hair_color ? { label: 'Hair', value: p.hair_color } : null,
      p.eye_color ? { label: 'Eyes', value: p.eye_color } : null,
      p.ethnicity ? { label: 'Ethnicity', value: p.ethnicity } : null,
      p.tattoos ? { label: 'Tattoos', value: p.tattoos } : null,
      p.piercings ? { label: 'Piercings', value: p.piercings } : null
    ];
  }, [p, age, flag]);

  const tags = useMemo(() => parseScrapedTags(p?.scraped_tags).map(String), [p]);
  const known = rows.filter(Boolean).length;

  return (
    <SideGroup
      id="performer"
      title="Performer"
      icon={<PersonOutlineIcon />}
      summary={p ? `${known} ${known === 1 ? 'fact' : 'facts'}` : 'loading'}
      order={SIDE.page}
    >
      <SideMain
        label="Rank images"
        icon={<EmojiEventsOutlinedIcon />}
        onClick={onRank}
        disabled={!rankEnabled}
        tip={rankEnabled ? 'Rank this performer\'s pictures against each other' : 'Available on the Pictures tab'}
      />
      <SideFacts rows={rows} />
      {p && known === 0 && <SideNote>No scraped facts for her yet.</SideNote>}
      {tags.length > 0 && <SideNote>{tags.join(' · ')}</SideNote>}
    </SideGroup>
  );
};

export default GalleryHero;
