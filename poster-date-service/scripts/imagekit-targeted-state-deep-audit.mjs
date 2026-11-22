import { Buffer } from 'node:buffer';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { imageKitConfig } from '../lib/imagekit-storage.mjs';
import { analyzeTargetVersions, summarizeCurrentContent, TARGET_FILES } from '../lib/imagekit-targeted-state-audit-utils.mjs';

const API = 'https://api.imagekit.io/v1';
const auth = config => ({ Authorization: 'Basic ' + Buffer.from(config.privateKey + ':').toString('base64'), Accept: 'application/json' });
async function getJson(config, url) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(url, { method: 'GET', headers: auth(config), signal: AbortSignal.timeout(20000) });
    if ((response.status === 429 || response.status >= 500) && attempt < 4) {
      const wait = Math.min(30000, Math.max(1000, Number(response.headers.get('retry-after')) * 1000 || 1500 * (attempt + 1)));
      await response.text();
      await new Promise(resolve => setTimeout(resolve, wait));
      continue;
    }
    if (!response.ok) throw new Error('ImageKit GET ' + response.status + ': ' + (await response.text()).slice(0, 300));
    return response.json();
  }
  throw new Error('ImageKit GET retry limit exceeded');
}
async function readCurrentFile(config, target) {
  const details = await getJson(config, API + '/files/' + encodeURIComponent(target.fileId) + '/details');
  if (details.filePath !== target.path) throw new Error('File path mismatch for ' + target.fileId + ': ' + details.filePath);
  const currentVersionId = details.versionInfo?.id;
  if (!currentVersionId) throw new Error('Current version ID missing for ' + target.path);
  const url = new URL(details.url || '');
  if (url.protocol !== 'https:' || !url.hostname.endsWith('ik.imagekit.io')) throw new Error('Unexpected current file URL host for ' + target.path);
  const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(30000), cache: 'no-store' });
  if (!response.ok) throw new Error('Current file content readback failed for ' + target.path + ' (HTTP ' + response.status + ')');
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length > 20 * 1024 * 1024) throw new Error('Current JSON exceeds 20 MiB safety bound for ' + target.path);
  const content = summarizeCurrentContent(body);
  if (!content.validJson) throw new Error('Current file is not valid JSON: ' + target.path);
  return {
    fileId: details.fileId,
    currentVersionId,
    currentSizeBytes: Number(details.size),
    currentUpdatedAt: details.updatedAt || details.createdAt || null,
    currentContent: content,
  };
}

const config = imageKitConfig();
if (!config) throw new Error('ImageKit credentials are not configured');
const inputPath = resolve(process.env.IMAGEKIT_RECONCILIATION_INPUT || '../reports/imagekit-storage-reconciliation-live.json');
const reconciliation = JSON.parse(await readFile(inputPath, 'utf8'));
if (reconciliation.deletionEnabled !== false || reconciliation.destructiveRequestsIssued !== 0 || reconciliation.mutationMethodsUsed?.length) {
  throw new Error('Refusing to use a reconciliation input that is not explicitly read-only');
}
const fileDetailsByPath = {};
for (const target of TARGET_FILES) {
  const matches = reconciliation.versionInventory?.historicalVersionRecords?.filter(row => row.path === target.path) || [];
  const fileIds = [...new Set(matches.map(row => row.fileId))];
  if (fileIds.length !== 1) throw new Error('Expected exactly one historical fileId for ' + target.path + '; found ' + fileIds.length);
  const current = await readCurrentFile(config, { ...target, fileId: fileIds[0] });
  fileDetailsByPath[target.path] = current;
}
const generatedAt = new Date().toISOString();
const { targets, proposal } = analyzeTargetVersions({ reconciliation, fileDetailsByPath, generatedAt });
const report = {
  generatedAt,
  mode: 'targeted-read-only-deep-investigation',
  deletionEnabled: false,
  destructiveRequestsIssued: 0,
  mutationMethodsUsed: [],
  sourceReconciliationGeneratedAt: reconciliation.generatedAt,
  targetCount: targets.length,
  targets,
  proposalSummary: {
    approvalStatus: proposal.approvalStatus,
    historicalVersionCount: proposal.totalProposedHistoricalVersions,
    proposedHistoricalBytes: proposal.totalProposedHistoricalBytes,
    separateProposalFile: 'imagekit-targeted-storage-recovery-proposal.json',
  },
  interpretation: {
    currentContentValuesRedacted: true,
    currentContentHashesAreForReadbackIdentityOnly: true,
    proposedBytesAreTheSumOfHistoricalVersionSizesNotAguaranteeOfImmediateBillingReclaim: true,
    noVersionWasDeletedOrRestored: true,
  },
};
const reportPath = resolve(process.env.IMAGEKIT_TARGETED_AUDIT_REPORT_PATH || '../reports/imagekit-targeted-state-deep-audit.json');
const proposalPath = resolve(process.env.IMAGEKIT_TARGETED_PROPOSAL_PATH || '../reports/imagekit-targeted-storage-recovery-proposal.json');
await mkdir(dirname(reportPath), { recursive: true });
await mkdir(dirname(proposalPath), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
await writeFile(proposalPath, JSON.stringify(proposal, null, 2) + '\n');
console.log('[imagekit-targeted-state-audit-complete]', JSON.stringify({
  reportPath, proposalPath, targets: targets.map(t => ({ path: t.path, fileId: t.fileId, currentVersionId: t.currentVersionId, historicalVersions: t.historicalVersionCount, historicalBytes: t.historicalBytes })),
  proposedHistoricalVersions: proposal.totalProposedHistoricalVersions,
  proposedHistoricalBytes: proposal.totalProposedHistoricalBytes,
  deletionEnabled: false, destructiveRequestsIssued: 0,
}));
