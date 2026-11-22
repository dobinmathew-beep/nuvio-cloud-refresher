import { mkdir, writeFile } from 'node:fs/promises';

const SOURCES = [
  ['CATALOG_MANIFEST_MIDNIGHTIGNITE_URL', 'AIOMetadata MidnightIgnite'],
  ['CATALOG_MANIFEST_ELFHOSTED_URL', 'AIOMetadata ElfHosted'],
  ['CATALOG_MANIFEST_XPERIENCE_URL', 'Xperience']
];
const PAGE_SIZE = 100;
const MAX_PAGES_PER_CATALOG = 200;
const DAY_MS = 24 * 60 * 60 * 1000;
const now = new Date();
const today = now.toISOString().slice(0, 10);
const ADDED_INDEX_URL = 'https://raw.githubusercontent.com/dobinmathew-beep/nuvio-cloud-refresher/dobins-catalog/dobins-indian-catalog/data/catalog-added.json';

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'GreatIndianReadOnlyBadgeAudit/1.0' },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error('HTTP ' + response.status + ' reading ' + new URL(url).host);
  return response.json();
}
function manifestBase(value) {
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/manifest\.json$/i, '');
  url.search = '';
  url.hash = '';
  return url.origin + url.pathname.replace(/\/$/, '');
}
function requiredExtrasUnavailable(catalog) {
  return (Array.isArray(catalog.extraRequired) ? catalog.extraRequired : []).some(required => {
    const name = typeof required === 'string' ? required : String(required?.name || '');
    if (!name || name === 'skip') return false;
    const descriptor = (catalog.extra || []).find(item => item && typeof item === 'object' && item.name === name);
    const options = Array.isArray(descriptor?.options) ? descriptor.options
      : Array.isArray(required?.options) ? required.options : [];
    return options.length === 0;
  });
}
function catalogueUrl(base, catalog, skip, extraValues = {}) {
  const url = new URL(base + '/catalog/' + encodeURIComponent(catalog.type) + '/' +
    encodeURIComponent(catalog.id) + '.json');
  if (skip) url.searchParams.set('skip', String(skip));
  for (const required of (Array.isArray(catalog.extraRequired) ? catalog.extraRequired : [])) {
    const name = typeof required === 'string' ? required : String(required?.name || '');
    if (!name || name === 'skip') continue;
    const descriptor = (catalog.extra || []).find(item => item && typeof item === 'object' && item.name === name);
    const options = Array.isArray(descriptor?.options) ? descriptor.options
      : Array.isArray(required?.options) ? required.options : [];
    if (options.length) url.searchParams.set(name, String(options[0]));
  }
  for (const [name, value] of Object.entries(extraValues || {})) {
    if (name && value !== undefined && value !== null) url.searchParams.set(name, String(value));
  }
  return url;
}
function canonicalId(meta) {
  const raw = String(meta?.id || '').trim();
  if (/^tt\d{7,10}$/i.test(raw)) return raw.toLowerCase();
  const tmdb = raw.match(/^(?:tmdb:|tmdb\/)(\d{1,12})$/i);
  if (tmdb) return 'tmdb:' + tmdb[1];
  const imdb = String(meta?.imdb_id || meta?.imdbId || '').trim();
  return /^tt\d{7,10}$/i.test(imdb) ? imdb.toLowerCase() : raw;
}
function releaseYear(meta) {
  const values = [meta?.year, meta?.releaseInfo, meta?.releaseInfo?.year, meta?.released];
  for (const value of values) {
    const match = String(value || '').match(/\b(?:19|20)\d{2}\b/);
    if (match) return Number(match[0]);
  }
  return null;
}
function digitalDates(meta) {
  const dates = [];
  for (const value of [meta?.digitalReleaseDate, meta?.ott?.date]) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || '').slice(0, 10))) dates.push(String(value).slice(0, 10));
  }
  if (meta?.releaseKind === 'digital' && /^\d{4}-\d{2}-\d{2}$/.test(String(meta?.releaseDate || ''))) {
    dates.push(String(meta.releaseDate));
  }
  for (const item of (Array.isArray(meta?.availability) ? meta.availability : [])) {
    if (item?.kind === 'digital' && /^\d{4}-\d{2}-\d{2}$/.test(String(item.date || '').slice(0, 10))) dates.push(String(item.date).slice(0, 10));
  }
  return [...new Set(dates)].sort();
}
function posterHasJustAdded(meta) {
  const poster = String(meta?.poster || '');
  try {
    const url = new URL(poster);
    return url.searchParams.get('badge') === 'just-added';
  } catch {
    return /(?:[?&]|%3F)badge(?:=|%3D)just-added/i.test(poster);
  }
}
function posterHost(meta) {
  try { return new URL(String(meta?.poster || '')).host; }
  catch { return ''; }
}
function inspect(meta, source, catalog, recentMovieIndex, report) {
  const id = canonicalId(meta);
  if (!id) return null;
  const type = String(meta?.type || catalog.type || '').toLowerCase();
  if (!type.includes('movie')) return null;
  const posterBadge = posterHasJustAdded(meta);
  const indexTimestamp = recentMovieIndex.get(id) || null;
  const isReference = Object.hasOwn(report.referenceTitles, id);
  if (!posterBadge && !indexTimestamp && !isReference) return null;
  const year = releaseYear(meta);
  const dates = digitalDates(meta);
  const latestDigital = dates.length ? dates[dates.length - 1] : null;
  const ageDays = latestDigital ? Math.floor((Date.parse(today + 'T00:00:00Z') - Date.parse(latestDigital + 'T00:00:00Z')) / DAY_MS) : null;
  let finding = 'not-in-recent-index-no-poster-query-flag';
  if (latestDigital && ageDays >= 0 && ageDays <= 14) finding = 'recent-digital-release-eligible';
  else if (latestDigital && ageDays > 14) finding = 'stale-just-added';
  else if (indexTimestamp && year && year < now.getUTCFullYear()) finding = 'old-movie-recent-index-entry';
  else if (posterBadge && !indexTimestamp) finding = 'poster-query-badge-without-recent-index-entry';
  else if (indexTimestamp) finding = 'recent-index-entry-needs-release-date-check';
  else if (year && year < now.getUTCFullYear()) finding = 'old-movie-without-digital-date';
  return {
    source, catalogId: catalog.id, catalogName: catalog.name || catalog.id,
    id, title: String(meta?.name || meta?.title || report.referenceTitles[id] || ''), year,
    releaseInfo: String(meta?.releaseInfo || ''), digitalReleaseDates: dates,
    latestDigitalReleaseDate: latestDigital, digitalAgeDays: ageDays,
    recentMovieIndexTimestamp: indexTimestamp, posterQueryBadge: posterBadge,
    posterHost: posterHost(meta), finding
  };
}

const missing = SOURCES.filter(([key]) => !String(process.env[key] || '').trim()).map(([key]) => key);
if (missing.length) throw new Error('Missing manifest secrets: ' + missing.join(', '));
const addedIndex = await fetchJson('https://raw.githubusercontent.com/dobinmathew-beep/nuvio-cloud-refresher/dobins-catalog/dobins-indian-catalog/data/catalog-added.json');
const recentMovieIndex = new Map();
for (const [key, timestamp] of Object.entries(addedIndex || {})) {
  const split = key.lastIndexOf('|');
  const catalogKey = split >= 0 ? key.slice(0, split) : '';
  if (!catalogKey.endsWith('_movie')) continue;
  const id = split >= 0 ? key.slice(split + 1) : '';
  const addedAt = Date.parse(timestamp);
  const age = now.getTime() - addedAt;
  if (id && Number.isFinite(addedAt) && age >= 0 && age <= 14 * DAY_MS) {
    recentMovieIndex.set(id, String(timestamp));
  }
}

const report = {
  generatedAt: now.toISOString(),
  mode: 'read-only; no catalogue writes, no ImageKit writes, no poster-service requests',
  sources: [],
  totals: { catalogueDefinitions: 0, cataloguesScanned: 0, dynamicCataloguesSkipped: 0, pagesFetched: 0, recordsFetched: 0, movieRecordAppearances: 0, candidateMovieAppearances: 0, staleJustAdded: 0, oldMovieWithoutDigitalDate: 0 },
  findings: [],
  referenceTitles: {
    tt1375789: 'Race 2',
    tt0073707: 'Sholay',
    tt5959980: 'Vada Chennai'
  },
  referenceMatches: []
};

for (const [key, fallbackName] of SOURCES) {
  const manifestUrl = String(process.env[key]).trim();
  const manifest = await fetchJson(manifestUrl);
  if (!Array.isArray(manifest.catalogs) || !manifest.catalogs.length) throw new Error(key + ' has no catalogue definitions');
  const source = String(manifest.name || fallbackName).replace(/\s*\|\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const base = manifestBase(manifestUrl);
  const sourceResult = { source, catalogueDefinitions: manifest.catalogs.length, cataloguesScanned: 0, dynamicCataloguesSkipped: 0, dynamicCatalogues: [], pagesFetched: 0, recordsFetched: 0, candidateMovieTitles: 0, recentIndexMovieTitles: 0, posterQueryBadgeTitles: 0, staleJustAdded: 0, oldMovieWithoutDigitalDate: 0 };
  report.totals.catalogueDefinitions += manifest.catalogs.length;

  for (const catalog of manifest.catalogs) {
    if (!catalog?.type || !catalog?.id) continue;
    if (requiredExtrasUnavailable(catalog)) {
      sourceResult.dynamicCataloguesSkipped++;
      report.totals.dynamicCataloguesSkipped++;
      sourceResult.dynamicCatalogues.push({
        id: catalog.id,
        name: catalog.name || catalog.id,
        requiredExtras: catalog.extraRequired || []
      });
      const requiredNames = (Array.isArray(catalog.extraRequired) ? catalog.extraRequired : [])
        .map(item => typeof item === 'string' ? item : String(item?.name || ''))
        .filter(Boolean);
      if (requiredNames.length === 1 && requiredNames[0] === 'search') {
        for (const [referenceId, referenceTitle] of Object.entries(report.referenceTitles)) {
          const data = await fetchJson(catalogueUrl(base, catalog, 0, { search: referenceTitle }));
          const matches = (Array.isArray(data.metas) ? data.metas : []).filter(meta => {
            const id = canonicalId(meta);
            const title = String(meta?.name || meta?.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const expectedTitle = referenceTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
            return id === referenceId || title === expectedTitle;
          });
          report.dynamicReferenceSearches.push({
            source, catalogId: catalog.id, query: referenceTitle,
            resultCount: (Array.isArray(data.metas) ? data.metas : []).length,
            matchingTitles: matches.map(meta => ({
              id: canonicalId(meta), title: String(meta?.name || meta?.title || '')
            }))
          });
          for (const meta of matches) {
            const finding = inspect(meta, source, catalog, recentMovieIndex, report);
            if (finding) report.dynamicReferenceMatches.push({ ...finding, referenceTitle, query: referenceTitle });
          }
        }
      }
      continue;
    }
    sourceResult.cataloguesScanned++;
    report.totals.cataloguesScanned++;
    const seen = new Set();
    for (let page = 0; page < MAX_PAGES_PER_CATALOG; page++) {
      const data = await fetchJson(catalogueUrl(base, catalog, page * PAGE_SIZE));
      const metas = Array.isArray(data.metas) ? data.metas : [];
      sourceResult.pagesFetched++;
      report.totals.pagesFetched++;
      sourceResult.recordsFetched += metas.length;
      report.totals.recordsFetched += metas.length;
      let newIds = 0;
      for (const meta of metas) {
        const id = canonicalId(meta);
        if (id && !seen.has(id)) { seen.add(id); newIds++; }
        if (String(meta?.type || catalog.type).toLowerCase().includes('movie')) {
          report.totals.movieRecordAppearances++;
        }
        const finding = inspect(meta, source, catalog, recentMovieIndex, report);
        if (!finding) continue;
        report.findings.push(finding);
        sourceResult.candidateMovieTitles++;
        report.totals.candidateMovieAppearances++;
        if (finding.recentMovieIndexTimestamp) sourceResult.recentIndexMovieTitles++;
        if (finding.posterQueryBadge) sourceResult.posterQueryBadgeTitles++;
        if (finding.finding === 'stale-just-added') {
          sourceResult.staleJustAdded++;
          report.totals.staleJustAdded++;
        }
        if (finding.finding === 'old-movie-without-digital-date' || finding.finding === 'old-movie-recent-index-entry') {
          sourceResult.oldMovieWithoutDigitalDate++;
          report.totals.oldMovieWithoutDigitalDate++;
        }
        if (Object.hasOwn(report.referenceTitles, finding.id)) {
          report.referenceMatches.push({ ...finding, referenceTitle: report.referenceTitles[finding.id] });
        }
      }
      if (metas.length < PAGE_SIZE || newIds === 0) break;
      if (page + 1 === MAX_PAGES_PER_CATALOG) {
        throw new Error('Page safety limit reached for ' + source + ' / ' + catalog.id + '; audit is incomplete');
      }
    }
  }
  report.sources.push(sourceResult);
}

report.referenceMatches.push(...report.dynamicReferenceMatches);
report.findings.sort((a, b) => a.source.localeCompare(b.source) || a.title.localeCompare(b.title));
report.totals.uniqueCandidateMovieIds = new Set(report.findings.map(item => item.id)).size;
report.totals.uniqueOldMovieIds = new Set(
  report.findings.filter(item => item.finding === 'old-movie-recent-index-entry').map(item => item.id)
).size;
report.referenceMatches.sort((a, b) => a.referenceTitle.localeCompare(b.referenceTitle));
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/just-added-badge-audit.json', JSON.stringify(report, null, 2) + '\n');
const summary = [
  '# Just Added badge audit',
  '',
  'Read-only audit. No catalogue data, ImageKit assets, or poster endpoints were changed or requested.',
  '',
  '| Source | Catalogues scanned | Pages | Records | Candidate appearances | Recent index | Poster query badge | Stale (>14d) | Old year, no digital date |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...report.sources.map(item => '| ' + [item.source, item.cataloguesScanned, item.pagesFetched, item.recordsFetched, item.candidateMovieTitles, item.recentIndexMovieTitles, item.posterQueryBadgeTitles, item.staleJustAdded, item.oldMovieWithoutDigitalDate].join(' | ') + ' |'),
  '',
  '## Reference titles',
  '',
  ...Object.entries(report.referenceTitles).map(([id, title]) => {
    const matches = report.referenceMatches.filter(item => item.id === id);
    return '- **' + title + '** (' + id + '): ' + (matches.length ? matches.map(item => item.source + ' — ' + item.finding + ', year ' + (item.year ?? 'unknown') + ', digital date ' + (item.latestDigitalReleaseDate || 'unknown')).join('; ') : 'not found in the scanned catalogue pages');
  }),
  '',
  '## Dynamic search probes',
  '',
  ...report.dynamicReferenceSearches.map(item => '- ' + item.source + ' / ' + item.catalogId + ' — query "' + item.query + '": ' + item.resultCount + ' results; matches: ' + (item.matchingTitles.length ? item.matchingTitles.map(match => match.title + ' (' + match.id + ')').join(', ') : 'none')),
  '',
  '## Totals',
  '',
  '- Movie record appearances (catalogue/page rows): ' + report.totals.movieRecordAppearances,
  '- Candidate movie appearances (recent index or poster flag, plus references): ' + report.totals.candidateMovieAppearances,
  '- Unique candidate movie IDs: ' + report.totals.uniqueCandidateMovieIds,
  '- Unique old-movie IDs with recent index timestamps: ' + report.totals.uniqueOldMovieIds,
  '- Dynamic catalogues skipped (required extra values unavailable): ' + report.totals.dynamicCataloguesSkipped,
  '- Stale Just Added (>14 days since digital release): ' + report.totals.staleJustAdded,
  '- Old movie with no digital date (requires review): ' + report.totals.oldMovieWithoutDigitalDate,
  ''
].join('\n');
await writeFile('artifacts/just-added-badge-audit.md', summary);
console.log(JSON.stringify({ status: 'passed', ...report.totals, sources: report.sources, referenceMatches: report.referenceMatches, artifact: 'artifacts/just-added-badge-audit.json' }));
