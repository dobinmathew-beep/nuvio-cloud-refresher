// Suppress repeated poster downloads and OCR when ImageKit rejects uploads.
// The circuit is process-local and automatically closes after the cooldown.
export function createImageKitQuotaCircuit({ cooldownMs = 6 * 60 * 60 * 1000, now = () => Date.now() } = {}) {
  if (!Number.isFinite(cooldownMs) || cooldownMs < 0) throw new TypeError('cooldownMs must be a non-negative number');
  let openUntil = 0;
  return {
    cooldownMs,
    isOpen() {
      return Number(now()) < openUntil;
    },
    recordFailure(error) {
      const message = String(error?.message || error || '');
      const uploadForbidden = /upload failed.*403|upload HTTP 403/i.test(message);
      const quotaExceeded = /upload limit exceeded/i.test(message);
      if (!uploadForbidden && !quotaExceeded) return false;
      openUntil = Math.max(openUntil, Number(now()) + cooldownMs);
      return true;
    },
    reset() {
      openUntil = 0;
    }
  };
}

// Shared by poster generation and OCR-cache persistence so the first quota
// rejection stops subsequent image uploads and expensive background builds.
export const imageKitUploadQuotaCircuit = createImageKitQuotaCircuit({ cooldownMs: 6 * 60 * 60 * 1000 });
