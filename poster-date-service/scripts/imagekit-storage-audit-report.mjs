import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildImageKitDeletionReport } from '../lib/imagekit-storage.mjs';

// This CLI uses only read/list/readback operations; the report builder never deletes assets.
const outputPath = resolve(process.env.IMAGEKIT_AUDIT_REPORT_PATH || '../reports/imagekit-storage-deletion-report-live.json');
const report = await buildImageKitDeletionReport();
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log('[imagekit-live-audit-complete]', JSON.stringify({
  outputPath,
  accountBytes: report.accountBytes,
  accountBytesSource: report.accountBytesSource,
  candidateCount: report.candidateCount,
  candidateBytes: report.candidateBytes,
  deletionEnabled: report.deletionEnabled
}));
