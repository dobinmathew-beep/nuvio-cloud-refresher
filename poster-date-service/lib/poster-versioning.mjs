import { createHash } from 'node:crypto';

const SCHEMA_VERSION = 1;
const validImdbId = value => /^tt\\d{7,10}$/.test(String(value || ''));

export function posterFingerprint(bytes) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
    throw new TypeError('Poster bytes must be a Buffer or Uint8Array');
  }
  if (!bytes.length) throw new Error('Poster bytes are empty');
  return createHash('sha256').update(bytes).digest('hex');
}

export function versionedPosterPath(imdbId, fingerprint) {
  if (!validImdbId(imdbId)) throw new Error('Invalid IMDb ID for versioned poster');
  if (!/^[a-f0-9]{64}$/.test(String(fingerprint || ''))) throw new Error('Invalid poster fingerprint');
  return '/poster-versions/' + imdbId + '/' + fingerprint + '.jpg';
}

export function isValidPosterPointer(pointer, imdbId) {
  if (!pointer || typeof pointer !== 'object' || Array.isArray(pointer)) return false;
  if (pointer.version !== SCHEMA_VERSION || pointer.imdbId !== imdbId) return false;
  if (!/^[a-f0-9]{64}$/.test(String(pointer.fingerprint || ''))) return false;
  if (pointer.assetPath !== versionedPosterPath(imdbId, pointer.fingerprint)) return false;
  if (typeof pointer.assetUrl !== 'string' || !pointer.assetUrl.startsWith('https://')) return false;
  if (pointer.contentType !== 'image/jpeg' && pointer.contentType !== 'image/png' &&
      pointer.contentType !== 'image/webp' && pointer.contentType !== 'image/avif') return false;
  if (!Number.isSafeInteger(pointer.sizeBytes) || pointer.sizeBytes <= 0) return false;
  if (typeof pointer.uploadedAt !== 'string' || !Number.isFinite(Date.parse(pointer.uploadedAt))) return false;
  return true;
}

/**
 * Adapter-driven publication protocol. uploadImmutable MUST use a non-overwriting
 * path; verifyAsset MUST perform a CDN readback; writePointer must atomically
 * replace the small per-ID pointer only after verification succeeds.
 */
export async function publishVersionedPoster(imdbId, poster, adapter) {
  if (!validImdbId(imdbId)) throw new Error('Invalid IMDb ID for versioned poster');
  if (!adapter || typeof adapter.uploadImmutable !== 'function' ||
      typeof adapter.verifyAsset !== 'function' || typeof adapter.writePointer !== 'function') {
    throw new Error('Versioned poster storage adapter is incomplete');
  }
  const bytes = Buffer.isBuffer(poster?.bytes) ? poster.bytes : Buffer.from(poster?.bytes || []);
  const fingerprint = poster?.fingerprint || posterFingerprint(bytes);
  if (fingerprint !== posterFingerprint(bytes)) throw new Error('Poster fingerprint does not match uploaded bytes');
  const assetPath = versionedPosterPath(imdbId, fingerprint);
  const uploaded = await adapter.uploadImmutable({
    imdbId, fingerprint, assetPath, bytes,
    contentType: poster.contentType || 'image/jpeg'
  });
  if (!uploaded || typeof uploaded.url !== 'string' || !uploaded.fileId) {
    throw new Error('Immutable poster upload did not return a file URL and ID');
  }
  const verified = await adapter.verifyAsset({
    url: uploaded.url, fileId: uploaded.fileId, expectedBytes: bytes.length,
    expectedContentType: poster.contentType || 'image/jpeg', fingerprint
  });
  if (verified !== true && verified?.ok !== true) {
    throw new Error('Immutable poster CDN readback verification failed');
  }
  const pointer = {
    version: SCHEMA_VERSION, imdbId, fingerprint, assetPath,
    assetUrl: uploaded.url, fileId: uploaded.fileId,
    contentType: poster.contentType || 'image/jpeg',
    sizeBytes: bytes.length, uploadedAt: new Date().toISOString(),
    checksum: fingerprint
  };
  await adapter.writePointer(imdbId, pointer);
  return pointer;
}

/** Resolve a verified immutable pointer; otherwise preserve the legacy route. */
export async function resolvePosterAsset(imdbId, adapter) {
  if (!validImdbId(imdbId)) throw new Error('Invalid IMDb ID for poster resolution');
  const legacyUrl = adapter.legacyUrl(imdbId);
  try {
    const pointer = await adapter.readPointer(imdbId);
    if (!isValidPosterPointer(pointer, imdbId)) {
      return { url: legacyUrl, source: 'legacy-invalid-pointer' };
    }
    const verified = await adapter.verifyAsset({
      url: pointer.assetUrl, fileId: pointer.fileId,
      expectedBytes: pointer.sizeBytes, expectedContentType: pointer.contentType,
      fingerprint: pointer.fingerprint
    });
    if (verified !== true && verified?.ok !== true) {
      return { url: legacyUrl, source: 'legacy-unverified-pointer' };
    }
    return { url: pointer.assetUrl, source: 'versioned', pointer };
  } catch {
    return { url: legacyUrl, source: 'legacy-pointer-read-failed' };
  }
}
