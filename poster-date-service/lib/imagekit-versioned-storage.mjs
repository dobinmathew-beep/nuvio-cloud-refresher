import { createHash } from 'node:crypto';
import { publishVersionedPoster, resolvePosterAsset } from './poster-versioning.mjs';

const UPLOAD_API = 'https://upload.imagekit.io/api/v1/files/upload';
const API = 'https://api.imagekit.io/v1';
const validId = value => /^tt\\d{7,10}$/.test(String(value || ''));

function auth(config) {
  return 'Basic ' + Buffer.from(config.privateKey + ':').toString('base64');
}
function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
function publicAssetUrl(endpoint, path) {
  return endpoint.replace(/\\/$/, '') + path;
}

export function createImageKitPosterAdapter({
  config, fetchImpl = fetch, recordUpload = () => {}, canStore = () => true
}) {
  if (!config?.endpoint || !config?.privateKey) throw new Error('ImageKit adapter requires valid credentials');
  const legacyUrl = imdbId => publicAssetUrl(config.endpoint, '/posters/' + encodeURIComponent(imdbId) + '.jpg');

  async function verifyAsset({ url, expectedBytes, expectedContentType, fingerprint }) {
    const response = await fetchImpl(url + (url.includes('?') ? '&' : '?') + 'poster-verify=' + Date.now(), {
      cache: 'no-store', signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) return false;
    const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (expectedContentType && type !== expectedContentType) return false;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || (expectedBytes > 0 && bytes.length !== expectedBytes)) return false;
    return digest(bytes) === fingerprint;
  }

  async function findExistingImmutable(assetPath, fingerprint) {
    const folder = assetPath.slice(0, assetPath.lastIndexOf('/'));
    const name = assetPath.slice(assetPath.lastIndexOf('/') + 1);
    const url = new URL(API + '/files');
    url.searchParams.set('type', 'file');
    url.searchParams.set('path', folder);
    url.searchParams.set('limit', '1000');
    url.searchParams.set('skip', '0');
    const response = await fetchImpl(url, {
      headers: { Authorization: auth(config), Accept: 'application/json' },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error('ImageKit immutable asset lookup failed (' + response.status + ')');
    const files = await response.json();
    const file = Array.isArray(files) ? files.find(item => item.name === name && item.filePath === assetPath) : null;
    if (!file?.fileId) return null;
    const assetUrl = publicAssetUrl(config.endpoint, assetPath);
    const verified = await verifyAsset({
      url: assetUrl, expectedBytes: Number(file.size) || 0,
      expectedContentType: file.mime || undefined, fingerprint
    });
    if (!verified) throw new Error('Existing immutable ImageKit object failed checksum verification');
    return { url: assetUrl, fileId: file.fileId };
  }

  async function readPointer(imdbId) {
    if (!validId(imdbId)) return null;
    const url = publicAssetUrl(config.endpoint, '/catalog-state/poster-pointers/' + encodeURIComponent(imdbId) + '.json');
    const response = await fetchImpl(url + '?v=' + Date.now(), {
      cache: 'no-store', signal: AbortSignal.timeout(5000)
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('ImageKit poster pointer read failed (' + response.status + ')');
    const value = await response.json();
    return value && value.imdbId === imdbId ? value : null;
  }

  return {
    legacyUrl,
    async uploadImmutable({ imdbId, assetPath, bytes, contentType, fingerprint }) {
      if (!validId(imdbId) || assetPath.split('/')[2] !== imdbId || digest(bytes) !== fingerprint) {
        throw new Error('Invalid immutable poster identity or fingerprint');
      }
      if (!canStore(bytes.length)) throw new Error('ImageKit storage safety ceiling reached');
      const existing = await findExistingImmutable(assetPath, fingerprint);
      if (existing) return existing;
      const fileName = assetPath.slice(assetPath.lastIndexOf('/') + 1);
      const folder = assetPath.slice(0, assetPath.lastIndexOf('/'));
      const form = new FormData();
      form.set('file', new Blob([bytes], { type: contentType }), fileName);
      form.set('fileName', fileName);
      form.set('folder', folder);
      form.set('useUniqueFileName', 'false');
      form.set('overwriteFile', 'false');
      form.set('isPrivateFile', 'false');
      const response = await fetchImpl(UPLOAD_API, {
        method: 'POST', headers: { Authorization: auth(config) }, body: form,
        signal: AbortSignal.timeout(20000)
      });
      if (!response.ok) {
        if ([400, 409, 422].includes(response.status)) {
          const raced = await findExistingImmutable(assetPath, fingerprint);
          if (raced) return raced;
        }
        throw new Error('ImageKit immutable poster upload failed (' + response.status + ')');
      }
      const uploaded = await response.json();
      if (!uploaded.url || !uploaded.fileId) throw new Error('ImageKit immutable upload omitted file identity');
      recordUpload(assetPath, uploaded.fileId, bytes.length);
      return { url: uploaded.url, fileId: uploaded.fileId };
    },
    verifyAsset,
    async writePointer(imdbId, pointer) {
      const name = imdbId + '.json';
      const bytes = Buffer.from(JSON.stringify(pointer));
      const form = new FormData();
      form.set('file', new Blob([bytes], { type: 'application/json' }), name);
      form.set('fileName', name);
      form.set('folder', '/catalog-state/poster-pointers');
      form.set('useUniqueFileName', 'false');
      form.set('overwriteFile', 'true');
      form.set('isPrivateFile', 'false');
      const response = await fetchImpl(UPLOAD_API, {
        method: 'POST', headers: { Authorization: auth(config) }, body: form,
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) throw new Error('ImageKit poster pointer upload failed (' + response.status + ')');
      const uploaded = await response.json();
      if (!uploaded.fileId) throw new Error('ImageKit poster pointer upload omitted file ID');
      recordUpload('/catalog-state/poster-pointers/' + name, uploaded.fileId, bytes.length);
      const check = await readPointer(imdbId);
      if (!check || check.fingerprint !== pointer.fingerprint || check.assetUrl !== pointer.assetUrl) {
        throw new Error('ImageKit poster pointer readback did not match published pointer');
      }
      return true;
    },
    readPointer
  };
}

export async function publishImageKitVersionedPoster(imdbId, poster, options) {
  const adapter = createImageKitPosterAdapter(options);
  return publishVersionedPoster(imdbId, {
    bytes: poster.bytes, contentType: poster.type || 'image/jpeg'
  }, adapter);
}

export async function resolveImageKitPoster(imdbId, options) {
  const adapter = createImageKitPosterAdapter(options);
  return resolvePosterAsset(imdbId, adapter);
}
