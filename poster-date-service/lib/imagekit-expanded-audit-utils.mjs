export function categoryFor(path) {
  const p = String(path || '/').toLowerCase();
  if (p.startsWith('/posters/')) return 'posters';
  if (p.startsWith('/poster-versions/')) return 'poster-versions';
  if (p.startsWith('/catalog-state/')) return 'catalog-state';
  if (p.startsWith('/backdrops/')) return 'backdrops';
  if (p.startsWith('/hero/') || p.startsWith('/reels/')) return 'hero-reels';
  if (p.startsWith('/epg/')) return 'epg';
  return 'other';
}
export function summarizeVersions(versions, currentVersionId, now = Date.now(), retentionMs = 30 * 86400000) {
  const historical = (Array.isArray(versions) ? versions : [])
    .filter(v => v.versionInfo?.id && v.versionInfo.id !== currentVersionId);
  const old = historical.filter(v => {
    const timestamp = Date.parse(v.createdAt || v.updatedAt || '');
    return Number.isFinite(timestamp) && now - timestamp >= retentionMs;
  });
  return {
    historicalVersionCount: historical.length,
    historicalVersionBytes: historical.reduce((sum, v) => sum + Math.max(0, Number(v.size) || 0), 0),
    historicalVersionsOlderThan30Days: old.map(v => ({
      versionId: v.versionInfo.id,
      bytes: Math.max(0, Number(v.size) || 0),
      createdAt: v.createdAt || v.updatedAt || null
    }))
  };
}
