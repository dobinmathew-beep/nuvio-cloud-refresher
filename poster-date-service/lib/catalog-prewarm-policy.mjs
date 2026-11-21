export const VERIFIED_ASSET_RECHECK_TTL_MS = 6 * 60 * 60 * 1000;

export function isFreshVerifiedRecord(record, fingerprint, now = Date.now()) {
  if (!record || !['verified', 'cache-hit'].includes(record.status) || record.fingerprint !== fingerprint) return false;
  const verifiedAt = Date.parse(record.verifiedAt || record.updatedAt || '');
  return Number.isFinite(verifiedAt) && verifiedAt <= now && now - verifiedAt < VERIFIED_ASSET_RECHECK_TTL_MS;
}

export function classifyPrewarmResponse({ status, contentType = '', location = '', imageKitBase = '', storage = '' }) {
  if (status >= 300 && status < 400) {
    return imageKitBase.length > 9 && location.startsWith(imageKitBase)
      ? { status: 'upload-pending', verificationTimeoutMs: 20000, reason: 'imagekit-redirect' }
      : { status: 'source-redirect', reason: 'source-provider-redirect' };
  }
  if ([500, 502, 503, 504].includes(status)) {
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
