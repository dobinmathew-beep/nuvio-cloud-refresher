import { randomInt } from 'node:crypto';
import { Buffer } from 'node:buffer';
import {
  createImageKitPosterAdapter,
  publishImageKitVersionedPoster,
  resolveImageKitPoster
} from '../lib/imagekit-versioned-storage.mjs';

const endpoint = String(process.env.IMAGEKIT_URL_ENDPOINT || '').replace(/\\/+$/, '');
const privateKey = process.env.IMAGEKIT_PRIVATE_KEY || '';
if (!endpoint || !privateKey) throw new Error('IMAGEKIT_URL_ENDPOINT and IMAGEKIT_PRIVATE_KEY are required');
const parsed = new URL(endpoint);
if (parsed.protocol !== 'https:' || parsed.hostname !== 'ik.imagekit.io') throw new Error('Unexpected ImageKit endpoint');

const config = { endpoint, privateKey };
const uploadedFiles = new Map();
const options = {
  config,
  canStore: () => true,
  recordUpload: (path, fileId) => uploadedFiles.set(fileId, path)
};
const adapter = createImageKitPosterAdapter(options);
// A valid-shaped, random test ID is used only after confirming that no
// existing version pointer occupies it. The test never touches /posters.
let imdbId = null;
for (let attempt = 0; attempt < 8; attempt++) {
  const candidate = 'tt' + String(randomInt(1_000_000, 9_999_999));
  if (!(await adapter.readPointer(candidate))) {
    imdbId = candidate;
    break;
  }
}
if (!imdbId) throw new Error('Could not reserve a collision-free temporary IMDb-shaped test ID');

const jpeg = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAAB//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EAf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EAf/2Q==',
  'base64'
);

let published = false;
try {
  const pointer = await publishImageKitVersionedPoster(imdbId, { bytes: jpeg, type: 'image/jpeg' }, options);
  const resolved = await resolveImageKitPoster(imdbId, options);
  if (resolved.source !== 'versioned' || resolved.url !== pointer.assetUrl) {
    throw new Error('Public pointer resolution did not return the newly published immutable asset');
  }
  published = true;
  console.log(JSON.stringify({
    status: 'passed',
    imdbId,
    assetPath: pointer.assetPath,
    immutableUpload: true,
    cdnChecksumReadback: true,
    pointerWriteReadback: true,
    independentPointerResolution: true
  }));
} finally {
  const failures = [];
  for (const fileId of uploadedFiles.keys()) {
    try {
      const response = await fetch('https://api.imagekit.io/v1/files/' + encodeURIComponent(fileId), {
        method: 'DELETE',
        headers: { Authorization: 'Basic ' + Buffer.from(privateKey + ':').toString('base64') },
        signal: AbortSignal.timeout(20000)
      });
      if (!response.ok) failures.push(fileId + ': HTTP ' + response.status);
    } catch (error) {
      failures.push(fileId + ': ' + (error?.message || 'delete failed'));
    }
  }
  if (failures.length) throw new Error('Temporary ImageKit cleanup failed: ' + failures.join('; '));
  console.log(JSON.stringify({ cleanup: 'passed', deletedTemporaryFiles: uploadedFiles.size, published }));
}
