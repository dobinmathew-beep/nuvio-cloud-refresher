import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';

const endpoint = String(process.env.IMAGEKIT_URL_ENDPOINT || '').replace(/\/+$/, '');
const privateKey = process.env.IMAGEKIT_PRIVATE_KEY || '';
if (!endpoint || !privateKey) throw new Error('IMAGEKIT_URL_ENDPOINT and IMAGEKIT_PRIVATE_KEY are required');
const parsed = new URL(endpoint);
if (parsed.protocol !== 'https:' || parsed.hostname !== 'ik.imagekit.io') throw new Error('Unexpected ImageKit endpoint');
const auth = 'Basic ' + Buffer.from(privateKey + ':').toString('base64');
const marker = 'great-indian-integration-' + randomUUID();
const fileName = marker + '.json';
const folder = '/catalog-state/integration-tests';
const payload = { marker, createdAt: new Date().toISOString(), purpose: 'ephemeral-live-integration-test' };
let fileId = null;
let filePath = null;
async function api(url, init = {}) {
  const response = await fetch(url, {
    ...init, headers: { Authorization: auth, ...(init.headers || {}) },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error('ImageKit API request failed: HTTP ' + response.status);
  return response;
}
try {
  const form = new FormData();
  form.set('file', new Blob([JSON.stringify(payload)], { type: 'application/json' }), fileName);
  form.set('fileName', fileName);
  form.set('folder', folder);
  form.set('useUniqueFileName', 'false');
  form.set('overwriteFile', 'false');
  form.set('isPrivateFile', 'false');
  const uploaded = await (await api('https://upload.imagekit.io/api/v1/files/upload', { method: 'POST', body: form })).json();
  fileId = uploaded.fileId;
  filePath = uploaded.filePath;
  if (!fileId || filePath !== folder + '/' + fileName) throw new Error('ImageKit upload response did not identify the unique test asset');
  const cdnUrl = endpoint + filePath;
  let verified = false;
  for (let attempt = 0; attempt < 12; attempt++) {
    const response = await fetch(cdnUrl + '?integration=' + randomUUID(), {
      cache: 'no-store', signal: AbortSignal.timeout(10000)
    });
    if (response.ok) {
      const actual = await response.json();
      if (actual.marker !== marker) throw new Error('CDN read-back returned unexpected content');
      verified = true;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(1000 + attempt * 1000, 8000)));
  }
  if (!verified) throw new Error('Uploaded ImageKit object did not become CDN-readable within the test window');
  // A separate uncached read proves persisted state is retrievable after a new
  // request context; it is not a literal Render process restart test.
  const secondRead = await fetch(cdnUrl + '?recovery=' + randomUUID(), {
    cache: 'no-store', signal: AbortSignal.timeout(10000)
  });
  if (!secondRead.ok || (await secondRead.json()).marker !== marker) throw new Error('Independent recovery read failed');
  console.log(JSON.stringify({ status: 'passed', filePath, authenticatedUpload: true, cdnReadBack: true, independentRecoveryRead: true }));
} finally {
  if (fileId) {
    const response = await fetch('https://api.imagekit.io/v1/files/' + encodeURIComponent(fileId), {
      method: 'DELETE', headers: { Authorization: auth }, signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw new Error('Test asset cleanup failed: HTTP ' + response.status);
    console.log('Ephemeral integration-test asset deleted.');
  }
}
