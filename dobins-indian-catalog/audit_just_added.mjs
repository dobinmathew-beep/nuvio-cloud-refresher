import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const PAGE_SIZE = 100;
const MAX_PAGES = 500;
const TARGET_IDS = ['tt1375789', 'tt0073707', 'tt5959980'];
const TARGET_NAMES = [
  { id: 'tt1375789', name: 'Race 2', key: 'race2' },
  { id: 'tt0073707', name: 'Sholay', key: 'sholay' },
  { id: 'tt5959980', name: 'Vada Chennai', key: 'vadachennai' }
];
const SOURCES = [
  ['CATALOG_MANIFEST_MIDNIGHTIGNITE_URL', 'AIOMetadata MidnightIgnite'],
  ['CATALOG_MANIFEST_ELFHOSTED_URL', 'AIOMetadata ElfHosted'],
  ['CATALOG_MANIFEST_XPERIENCE_URL', 'Xperience']
];

function omanDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Muscat', calendar: 'gregory', numberingSystem: 'latn',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const values = Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  return values.year + '-' + values.month + '-' + values.day;
}

function validDate(value) {
  const date = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const stamp = Date.parse(date + 'T00:00:00Z');
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === date ? date : null;
}

export function earliestDigitalDate(item) {
  const dates = [];
  for (const row of Array.isArray(item?.availability) ? item.availability : []) {
    if (row && typeof row === 'object' && String(row.kind || '').toLowerCase() === 'digital') {
      const date = validDate(row.date);
      if (date) dates.push(date);
    }
  }
  if (String(item?.releaseKind || '').toLowerCase() === 'digital') {
    const date = validDate(item?.ottDate);
    if (date) dates.push(date);
  }
  return dates.length ? dates.sort()[0] : null;
}

export function hasJustAddedBadge(item) {
  if (item?.justAdded === true || String(item?.badge || '').toLowerCase() === 'just-added') return true;
  try {
    const poster = new URL(String(item?.poster || ''));
    return String(poster.searchParams.get('badge') || '').toLowerCase() === 'just-added';
  } catch {
    return false;
  }
}

function ageInDays(date, today) {
  return (Date.parse(today + 'T00:00:00Z') - Date.parse(date + 'T00:00:00Z')) / 86400000;
}

export function classifyTitle(item, now = new Date()) {
  const badge = hasJustAddedBadge(item);
  const type = String(item?.type || '').toLowerCase();
  const today = omanDate(now);
  let expected = null;
  let basis = null;
  let evidenceDate = null;
  if (type === 'movie') {
    evidenceDate = earliestDigitalDate(item);
    basis = 'first-verified-digital-arrival';
    if (evidenceDate) {
      const age = ageInDays(evidenceDate, today);
      expected = age >= 0 && age <= 14;
    }
  } else if (type === 'series') {
    basis = 'first-catalogue-seen';
    const timestamp = Date.parse(String(item?.catalogAddedAt || ''));
    if (Number.isFinite(timestamp)) {
      const age = now.getTime() - timestamp;
      expected = age >= 0 && age <= 14 * 86400000;
      evidenceDate = new Date(timestamp).toISOString();
    }
  }
  const status = badge
    ? expected === false ? 'stale-badge' : expected === null ? 'unverifiable-badge' : 'badge-eligible'
    : expected === true ? 'missing-badge' : expected === null ? 'eligibility-unverifiable' : 'no-badge-expected';
  return {
    badge,
    expected,
    status,
    basis,
    evidenceDate,
    releaseInfo: String(item?.releaseInfo || ''),
    title: String(item?.name || item?.title || item?.id || 'Untitled'),
    type,
    id: String(item?.id || ''),
    imdbId: String(item?.imdbId || item?.imdb_id || item?.externalIds?.imdb || ''),
    catalogAddedAt: item?.catalogAddedAt || null
  };
}

async function fetchJson(url, label) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': 'GreatIndianJustAddedReadOnlyAudit/1.0' },
        signal: AbortSignal.timeout(20000)
      });
      if (!response.ok) {
        const retryAfter = Number(response.headers.get('retry-after') || 0);
        throw Object.assign(new Error(label + ' HTTP ' + response.status), {
          retryAfter: Number.isFinite(retryAfter) ? retryAfter : 0
        });
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        const delay = Math.max(error.retryAfter || 0, 1 + attempt * 2);
        await new Promise(resolve => setTimeout(resolve, delay * 1000));
      }
    }
  }
  throw lastError;
}

function manifestBase(manifestUrl) {
  const url = new URL(manifestUrl);
  url.pathname = url.pathname.replace(/\/manifest\.json$/i, '').replace(/\/$/, '');
  return url;
}

function catalogueUrl(base, catalog, skip) {
  const url = new URL(base.toString());
  url.pathname = url.pathname.replace(/\/$/, '') + '/catalog/' + encodeURIComponent(catalog.type) + '/' + encodeURIComponent(catalog.id) + '.json';
  if (skip) url.searchParams.set('skip', String(skip));
  for (const requirement of catalog.required || []) {
    const name = typeof requirement === 'string' ? requirement : String(requirement?.name || '');
    if (!name || name === 'skip') continue;
    const descriptor = (catalog.extra || []).find(item => item && typeof item === 'object' && item.name === name);
    const options = Array.isArray(descriptor?.options) ? descriptor.options
      : Array.isArray(requirement?.options) ? requirement.options : [];
    if (options.length) url.searchParams.set(name, String(options[0]));
  }
  return url;
}

function unresolvedRequired(catalog) {
  return (catalog.required || []).map(item => typeof item === 'string' ? item : String(item?.name || ''))
    .filter(name => name && name !== 'skip')
    .filter(name => {
      const descriptor = (catalog.extra || []).find(item => item && typeof item === 'object' && item.name === name);
      const requirement = (catalog.required || []).find(item => (typeof item === 'string' ? item : item?.name) === name);
      const options = Array.isArray(descriptor?.options) ? descriptor.options
        : Array.isArray(requirement?.options) ? requirement.options : [];
      return options.length === 0;
    });
}

function normalizedTitle(value) {\n  return String(value || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '');\n}\n\nfunction targetByName(value) {\n  const key = normalizedTitle(value);\n  return TARGET_NAMES.find(target => key === target.key || key.startsWith(target.key)) || null;\n}\n\nfunction imdbId(item) {
  for (const value of [item?.imdbId, item?.imdb_id, item?.externalIds?.imdb, item?.externals?.imdb, item?.id]) {
    if (typeof value === 'string' && /^tt\d{7,10}$/.test(value)) return value;
  }
  return null;
}

async function scanCatalog(base, catalog, sourceName, now) {
  const skipped = unresolvedRequired(catalog);
  if (skipped.length) return { catalog: catalog.id, type: catalog.type, name: catalog.name, skipped: true, reason: 'required-extra-options-unavailable: ' + skipped.join(', '), records: 0, findings: [] };
  const seen = new Set();
  const findings = [];
  const targets = [];
  let records = 0;
  let pages = 0;
  let truncated = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const skip = page * PAGE_SIZE;
    const url = catalogueUrl(base, catalog, skip);
    const payload = await fetchJson(url, sourceName + ' ' + catalog.id + ' page ' + page);
    const metas = Array.isArray(payload?.metas) ? payload.metas
      : Array.isArray(payload?.items) ? payload.items : [];
    pages++;
    if (!metas.length) break;
    let fresh = 0;
    for (const item of metas) {
      const id = String(item?.id || '');
      const key = String(item?.type || catalog.type) + '|' + id;
      if (id && seen.has(key)) continue;
      if (id) seen.add(key);
      fresh++;
      records++;
      const resolvedImdb = imdbId(item);
      const classified = classifyTitle({ ...item, type: item?.type || catalog.type }, now);
      const nameMatch = targetByName(classified.title);
      const target = (resolvedImdb && TARGET_IDS.includes(resolvedImdb)) || nameMatch;
      if (target) targets.push({
        ...classified,
        imdbId: resolvedImdb || nameMatch?.id || '',
        targetName: nameMatch?.name || classified.title,
        source: sourceName,
        catalog: catalog.id,
        catalogName: catalog.name
      });
      if (classified.status === 'stale-badge' || classified.status === 'unverifiable-badge' || classified.status === 'missing-badge') {
        findings.push({ ...classified, source: sourceName, catalog: catalog.id, catalogName: catalog.name, resolvedImdbId: resolvedImdb });
      }
    }
    if (!fresh || metas.length < PAGE_SIZE) break;
    if (page === MAX_PAGES - 1) truncated = true;
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  return { catalog: catalog.id, type: catalog.type, name: catalog.name, records, pages, truncated, findings, targets };
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      try { results[index] = await mapper(items[index], index); }
      catch (error) { results[index] = { error: error?.message || String(error), catalog: items[index]?.id, name: items[index]?.name }; }
    }
  }));
  return results;
}

function markdownReport(report) {
  const lines = [
    '# Just Added read-only catalogue audit',
    '',
    '- Generated: ' + report.generatedAt,
    '- Policy: movie badge eligibility uses the earliest verified digital arrival (14 days); series use first-catalogue-seen (14 days).',
    '- Scope: manifest/catalog GET requests only. No poster URLs were fetched and no storage or catalogue state was changed.',
    ''
  ];
  for (const source of report.sources) {
    lines.push('## ' + source.name);
    lines.push('');
    lines.push('- Catalogues: ' + source.catalogs);
    lines.push('- Records scanned: ' + source.records);
    lines.push('- Pages scanned: ' + source.pages);
    lines.push('- Scan errors: ' + source.errors + ' · Expected dynamic skips: ' + source.skipped);
    lines.push('- Badge findings: ' + source.findings);
    lines.push('');
  }
  lines.push('## Reference titles');
  lines.push('');
  lines.push('| Title | IMDb ID | Source | Catalogue | Badge | Expected | Evidence |');
  lines.push('|---|---|---|---|---:|---:|---|');
  for (const target of report.targets) {
    lines.push('| ' + [target.title, target.imdbId, target.source, target.catalogName, target.badge, target.expected, target.evidenceDate || 'unknown'].map(x => String(x ?? '').replace(/\|/g, '/')).join(' | ') + ' |');
  }
  if (!report.targets.length) lines.push('| No reference titles found | | | | | | |');
  lines.push('');
  lines.push('## Flagged records');
  lines.push('');
  lines.push('| Title | IMDb ID | Source | Catalogue | Status | First digital/first seen | Release info |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const row of report.findings.slice(0, 500)) {
    lines.push('| ' + [row.title, row.resolvedImdbId || row.imdbId || row.id, row.source, row.catalogName, row.status, row.evidenceDate || 'unknown', row.releaseInfo].map(x => String(x ?? '').replace(/\|/g, '/')).join(' | ') + ' |');
  }
  if (!report.findings.length) lines.push('| No badge inconsistencies detected | | | | | | |');
  lines.push('');
  return lines.join('\n');
}

export async function runAudit(env = process.env, now = new Date()) {
  const configured = SOURCES.map(([key, name]) => ({ key, name, url: String(env[key] || '').trim() }));
  const missing = configured.filter(source => !source.url);
  if (missing.length) throw new Error('Missing required manifest secrets: ' + missing.map(source => source.key).join(', '));
  const all = [];
  for (const source of configured) {
    try {
      const manifest = await fetchJson(source.url, source.name + ' manifest');
      if (!Array.isArray(manifest.catalogs)) throw new Error('manifest has no catalogs array');
      const base = manifestBase(source.url);
      const catalogueResults = await mapLimit(manifest.catalogs.filter(c => c && c.type && c.id), 3,
        catalog => scanCatalog(base, {
          type: String(catalog.type), id: String(catalog.id), name: String(catalog.name || catalog.id),
          extra: Array.isArray(catalog.extra) ? catalog.extra : [],
          required: Array.isArray(catalog.extraRequired) ? catalog.extraRequired : []
        }, source.name, now));
      const failures = catalogueResults.filter(x => x.error || x.truncated);
      const skipped = catalogueResults.filter(x => x.skipped);
      const findings = catalogueResults.flatMap(x => x.findings || []);
      const targets = catalogueResults.flatMap(x => x.targets || []);
      all.push({
        name: source.name,
        configured: true,
        catalogs: catalogueResults.length,
        records: catalogueResults.reduce((sum, x) => sum + (x.records || 0), 0),
        pages: catalogueResults.reduce((sum, x) => sum + (x.pages || 0), 0),
        errors: failures.length,
        skipped: skipped.length,
        findings: findings.length,
        targets,
        catalogueResults,
        findingRows: findings
      });
    } catch (error) {
      all.push({ name: source.name, configured: true, catalogs: 0, records: 0, pages: 0, errors: 1, findings: 0, error: error?.message || String(error), targets: [], catalogueResults: [], findingRows: [] });
    }
  }
  const report = {
    generatedAt: now.toISOString(),
    evaluationDate: omanDate(now),
    policy: 'first-verified-digital-arrival-v1',
    scope: 'read-only manifest and catalogue GET requests; no poster fetches or storage writes',
    sources: all.map(source => ({
      name: source.name, catalogs: source.catalogs, records: source.records, pages: source.pages,
      errors: source.errors, skipped: source.skipped || 0, findings: source.findings, error: source.error || null
    })),
    targets: all.flatMap(source => source.targets),
    targetCoverage: all.map(source => {
      const found = new Set((source.targets || []).map(target => target.targetName));
      return { source: source.name, found: [...found], missing: TARGET_NAMES.filter(target => !found.has(target.name)).map(target => target.name) };
    }),
    findings: all.flatMap(source => source.findingRows),
    catalogues: all.map(source => ({ name: source.name, error: source.error || null, results: source.catalogueResults }))
  };
  const outputDir = process.env.AUDIT_OUTPUT_DIR || 'artifacts';
  await mkdir(outputDir, { recursive: true });
  await writeFile(outputDir + '/just-added-audit.json', JSON.stringify(report, null, 2));
  await writeFile(outputDir + '/just-added-audit.md', markdownReport(report));
  console.log(JSON.stringify({
    generatedAt: report.generatedAt,
    evaluationDate: report.evaluationDate,
    sources: report.sources,
    targetMatches: report.targets.length,
    targetCoverage: report.targetCoverage,
    flaggedRecords: report.findings.length,
    outputDir
  }, null, 2));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAudit().then(report => {
    if (report.sources.some(source => source.errors > 0)) process.exitCode = 1;
  }).catch(error => {
    console.error('[just-added-audit-failed]', error?.message || String(error));
    process.exitCode = 1;
  });
}