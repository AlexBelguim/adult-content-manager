/**
 * The watchers: what Discover reads. { id, label, name (the site, as stored), adapter, kind: posts | profiles, url, watch,
 * flaresolverr }. watch: false only runs by hand (every Leakhaven creator takes hours); flaresolverr: its site is behind a
 * Cloudflare check, so a run warns when FlareSolverr isn't answering.
 */
const WATCHERS = [
  { id: 'leakshaven-new', label: 'Leakhaven new', name: 'leakshaven', adapter: 'leakshaven', kind: 'posts', url: 'https://leakshaven.com/', watch: true, sorting: 'NEWEST', pageSize: 30 },
  { id: 'leakshaven-models', label: 'Leakhaven models', name: 'leakshaven', adapter: 'leakshaven', kind: 'profiles', url: 'https://leakshaven.com/models', watch: false, profileSorting: 'hot' },
  { id: 'leakgallery-trending', label: 'Leakgallery trending', name: 'leakgallery', adapter: 'leakgallery', kind: 'profiles', url: 'https://leakgallery.com/trending-profiles/12-Hours', watch: true, period: '12-Hours' },
  { id: 'fapello-new', label: 'Fapello new', name: 'fapello', adapter: 'fapello', kind: 'posts', url: 'https://fapello.com/new/', watch: true, flaresolverr: true },
  { id: 'thothub-albums', label: 'Thothub albums', name: 'thothub', adapter: 'kvs-albums', kind: 'posts', url: 'https://thothub.vip/albums/', watch: true },
  { id: 'thothd-albums', label: 'ThotHD albums', name: 'thothd', adapter: 'kvs-albums', kind: 'posts', url: 'https://thothd.com/albums/', watch: true },
  { id: 'porn4fans-new', label: 'Porn4Fans new models', name: 'porn4fans', adapter: 'porn4fans', kind: 'posts', url: 'https://www.porn4fans.com/models/?p=date_of_first_video', watch: true },
  { id: 'pimpbunny-new', label: 'PimpBunny new creators', name: 'pimpbunny', adapter: 'pimpbunny', kind: 'posts', url: 'https://pimpbunny.com/onlyfans-creators/?sort_by=added_date', watch: true },
];

/** The rest of what a run goes by; threshold and the timer are settings of their own (discover_settings). */
const LIMITS = {
  requestsPerSecond: 1, userAgent: 'DarkroomKeepScanner/0.1 (personal test tool; 1 req/s)',
  maxPages: 10, maxPosts: 300, watchMaxPages: 200, picturesPerPost: 5, keepRejectedImages: true, watchMinutes: 20,
};

const flareSolverrUrl = () => process.env.FLARESOLVERR_URL || 'http://127.0.0.1:8191/v1';

module.exports = { WATCHERS, LIMITS, flareSolverrUrl };
