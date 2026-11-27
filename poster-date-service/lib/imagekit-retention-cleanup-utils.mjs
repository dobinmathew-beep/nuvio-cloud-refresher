export function planCurrentPlusOneHistorical(versions, currentVersionId) {
  if (!Array.isArray(versions) || !currentVersionId) {
    return { safe: false, reason: 'missing-version-list-or-current-id', keep: [], remove: [] };
  }
  const ids = versions.map(v => v?.versionInfo?.id).filter(Boolean);
  if (ids.length !== versions.length || new Set(ids).size !== ids.length) {
    return { safe: false, reason: 'missing-or-duplicate-version-id', keep: [], remove: [] };
  }
  const current = versions.filter(v => v.versionInfo.id === currentVersionId);
  if (current.length !== 1) {
    return { safe: false, reason: 'current-version-not-unique-in-version-list', keep: [], remove: [] };
  }
  const historical = versions.filter(v => v.versionInfo.id !== currentVersionId);
  if (historical.some(v => !Number.isFinite(Date.parse(v.createdAt || v.updatedAt || '')) ||
      !Number.isFinite(Number(v.size)) || Number(v.size) < 0)) {
    return { safe: false, reason: 'historical-version-has-unknown-date-or-size', keep: [], remove: [] };
  }
  historical.sort((a, b) => Date.parse(b.createdAt || b.updatedAt) - Date.parse(a.createdAt || a.updatedAt));
  return {
    safe: true,
    reason: 'current-plus-newest-valid-historical',
    keep: [current[0], ...(historical.length ? [historical[0]] : [])],
    remove: historical.slice(1)
  };
}

export function planTitlePosterAssetRetention(files, activePath) {
  if (!Array.isArray(files) || !activePath) {
    return { safe: false, reason: 'missing-assets-or-active-pointer', keep: [], remove: [] };
  }
  const active = files.filter(file => file.filePath === activePath);
  if (active.length !== 1) {
    return { safe: false, reason: 'active-pointer-target-not-unique', keep: [], remove: [] };
  }
  const historical = files.filter(file => file.filePath !== activePath);
  if (historical.some(file => !Number.isFinite(Date.parse(file.createdAt || file.updatedAt || '')) ||
      !file.fileId || !Number.isFinite(Number(file.size)) || Number(file.size) <= 0)) {
    return { safe: false, reason: 'historical-poster-has-unknown-identity-date-or-size', keep: [], remove: [] };
  }
  historical.sort((a, b) => Date.parse(b.createdAt || b.updatedAt) - Date.parse(a.createdAt || a.updatedAt));
  return {
    safe: true,
    reason: 'active-plus-newest-valid-historical-poster',
    keep: [active[0], ...(historical.length ? [historical[0]] : [])],
    remove: historical.slice(1)
  };
}

export function planCanonicalAndOneBackup(files, identity) {
  if (!Array.isArray(files) || !identity) {
    return { safe: false, reason: 'missing-poster-identity', keep: [], remove: [] };
  }
  const canonicalPath = '/posters/' + identity + '.jpg';
  const canonical = files.filter(file => file.filePath === canonicalPath && file.name?.toLowerCase() === identity + '.jpg');
  if (canonical.length !== 1) {
    return { safe: false, reason: 'canonical-public-poster-not-unique', keep: [], remove: [] };
  }
  const alternatives = files.filter(file => file.fileId !== canonical[0].fileId);
  if (alternatives.some(file => !file.fileId || !Number.isFinite(Date.parse(file.createdAt || file.updatedAt || '')) ||
      !Number.isFinite(Number(file.size)) || Number(file.size) <= 0)) {
    return { safe: false, reason: 'alternative-poster-has-unknown-identity-date-or-size', keep: [], remove: [] };
  }
  alternatives.sort((a, b) => Date.parse(b.createdAt || b.updatedAt) - Date.parse(a.createdAt || a.updatedAt));
  return {
    safe: true,
    reason: 'canonical-plus-newest-historical-poster-file',
    keep: [canonical[0], ...(alternatives.length ? [alternatives[0]] : [])],
    remove: alternatives.slice(1)
  };
}
