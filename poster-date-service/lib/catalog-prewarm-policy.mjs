export const VERIFIED_ASSET_RECHECK_TTL_MS = 6 * 60 * 60 * 1000;
export const SOURCE_UNAVAILABLE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export function imageKitVerificationUrl(endpoint, storageId, now = Date.now()) {
  const rawBase = String(endpoint || '');
  const base = rawBase.endsWith('/') ? rawBase.slice(0, -1) : rawBase;
  return base + '/posters/' + encodeURIComponent(storageId) + '.jpg?__poster_verify=' + encodeURIComponent(String(now));
}

export function isSourceUnavailableCoolingDown(record, fingerprint, now = Date.now()) {
  if (!record || record.status !== 'source-unavailable' || record.fingerprint !== fingerprint) return false;
  const retryAt = Date.parse(record.retryAfter || '');
  return Number.isFinite(retryAt) && retryAt > now;
}

export function isFreshVerifiedRecord(record, fingerprint, now = Date.now()) {
  if (!record || !['verified', 'cache-hit'].includes(record.status) || record.fingerprint !== fingerprint) return false;
  const verifiedAt = Date.parse(record.verifiedAt || record.updatedAt || '');
  return Number.isFinite(verifiedAt) && verifiedAt <= now && now - verifiedAt < VERIFIED_ASSET_RECHECK_TTL_MS;
}

export function classifyPrewarmResponse({ status, contentType = '', location = '', imageKitBase = '', storage = '', fallbackReason = '' }) {
  if (status >= 300 && status < 400) {
    return imageKitBase.length > 9 && location.startsWith(imageKitBase)
      ? { status: 'upload-pending', verificationTimeoutMs: 20000, reason: 'imagekit-redirect' }
      : { status: 'source-redirect', reason: 'source-provider-redirect' };
  }
  if ([500, 502, 503, 504].includes(status)) {
    if (status === 503 && /no poster provider returned a usable image|no poster source available|tmdb title has no poster image/i.test(String(fallbackReason))) {
      return { status: 'source-unavailable', cooldownMs: SOURCE_UNAVAILABLE_COOLDOWN_MS, reason: 'definitive-no-poster-source' };
    }
    return { status: 'upload-pending', verificationTimeoutMs: 20000, reason: 'uncertain-server-error' };
  }
  if ([408, 425, 429].includes(status)) {
    return { status: 'retry', reason: 'transient-request-rejected' };
  }
  if (status < 200 || status >= 300 || !String(contentType).toLowerCase().startsWith('image/')) {
    return { status: 'failed', reason: 'non-image-response' };
  }
  if (storage === 'pending') {
    return { status: 'upload-pending', verificationTimeoutMs: 90000, reason: 'imagekit-upload-pending' };
  }
  return { status: 'rendered', reason: 'image-response' };
}

export function needsResumeVerification(record, fingerprint, now = Date.now()) {
  if (!record || record.fingerprint !== fingerprint) return false;
  if (record.status === 'upload-pending') return true;
  const retryAt = Date.parse(record.retryAfter || '');
  return Number.isFinite(retryAt) && retryAt > now;
}
