import React, { useMemo, useState } from 'react';
import { ensureFlag } from '../../utils/countryFlags';
import FlagEmoji from '../FlagEmoji';

const parseScrapedTags = (raw) => {
  if (!raw) return [];
  try {
    const tags = JSON.parse(raw);
    return Array.isArray(tags) ? tags.filter(Boolean) : [];
  } catch (e) {
    return [];
  }
};

const initials = (name = '') => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
};

/**
 * Gallery header: avatar, name, one-line facts, count chips and the
 * collapsible performer details (Personal / Physical / Appearance / Tags).
 */
const GalleryHero = ({ name, isPerformer, performer, age, counts }) => {
  const [open, setOpen] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);

  const p = isPerformer ? performer : null;
  const flag = p ? ensureFlag(p.country_flag) : null;

  const birthplace = p?.birthplace ? (
    <span className="flag">
      {flag && <FlagEmoji countryCode={flag} size="1rem" />}
      {p.birthplace}
    </span>
  ) : null;

  const groups = useMemo(() => {
    if (!p) return [];
    const rows = (list) => list.filter(([, value]) => value);
    return [
      ['Personal info', rows([
        ['Age', p.age ? `${age} years old` : null],
        ['Born', p.born],
        ['Birthplace', p.birthplace ? 'birthplace' : null],
        ['Sexuality', p.orientation],
      ])],
      ['Physical attributes', rows([
        ['Height', p.height],
        ['Weight', p.weight],
        ['Measurements', p.measurements],
        ['Cup size', p.measurements_cup],
        ['Body type', p.body_type],
        ['Grooming', p.pubic_hair],
      ])],
      ['Appearance', rows([
        ['Hair', p.hair_color],
        ['Eyes', p.eye_color],
        ['Ethnicity', p.ethnicity],
        ['Tattoos', p.tattoos],
        ['Piercings', p.piercings],
      ])],
    ].filter(([, list]) => list.length > 0);
  }, [p, age]);

  const scrapedTags = useMemo(() => parseScrapedTags(p?.scraped_tags), [p]);
  const hasInfo = groups.length > 0 || scrapedTags.length > 0;

  const facts = p ? [
    p.age ? <span key="age">{age} yrs</span> : null,
    birthplace ? <React.Fragment key="bp">{birthplace}</React.Fragment> : null,
    p.height ? <span key="h">{p.height}</span> : null,
    p.hair_color ? <span key="hair">{p.hair_color}</span> : null,
    p.eye_color ? <span key="eyes">{p.eye_color} eyes</span> : null,
  ].filter(Boolean) : [];

  const showAvatarImage = p?.thumbnail && !avatarFailed;

  return (
    <>
      <header className="ug-hero">
        <div className="ug-ava" aria-hidden="true">
          {showAvatarImage ? (
            <img
              src={`/api/files/preview?path=${encodeURIComponent(p.thumbnail)}`}
              alt=""
              decoding="async"
              onError={() => setAvatarFailed(true)}
            />
          ) : (isPerformer ? initials(name) : '#')}
        </div>
        <div className="ug-hero-main">
          <h2>{name}</h2>
          {facts.length > 0 && (
            <p className="ug-facts">
              {facts.map((fact, i) => (
                <React.Fragment key={fact.key}>
                  {i > 0 && <span className="sep">·</span>}
                  {fact}
                </React.Fragment>
              ))}
            </p>
          )}
          <div className="ug-cnt">
            <span>{counts.pics} pics</span>
            <span>{counts.vids} videos</span>
            <span>{counts.funscripts} funscripts</span>
          </div>
        </div>
        {hasInfo && (
          <button
            type="button"
            className={`ug-btn${open ? ' on' : ''}`}
            aria-expanded={open}
            onClick={() => setOpen(prev => !prev)}
          >
            {open ? 'Less ▴' : 'More details ▾'}
          </button>
        )}
      </header>

      {open && hasInfo && (
        <div className="ug-panel">
          <div className="ug-info">
            {groups.map(([heading, rows]) => (
              <div key={heading}>
                <h4>{heading}</h4>
                <dl>
                  {rows.map(([label, value]) => (
                    <React.Fragment key={label}>
                      <dt>{label}</dt>
                      <dd>{label === 'Birthplace' ? birthplace : value}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              </div>
            ))}
            {scrapedTags.length > 0 && (
              <div className="ug-stags">
                <h4>Tags</h4>
                <div>{scrapedTags.map((tag, i) => <span key={`${tag}-${i}`}>{String(tag)}</span>)}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default GalleryHero;
