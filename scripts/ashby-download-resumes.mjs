import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

/**
 * Ashby → local PDF downloader
 *
 * Design goals:
 * - Idempotent: safe to rerun; won't re-download already-downloaded resumes.
 * - Accurate: store candidate/application metadata alongside each PDF.
 * - Low breakage: minimal coupling; just drops PDFs into the watched folder.
 *
 * IMPORTANT:
 * - This script intentionally supports a couple of possible Ashby RPC shapes because
 *   Ashby is an RPC-style API and different orgs/features may return slightly different
 *   response fields. If the default method names don't work, set env overrides below.
 */

function mustGetEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function getEnv(name, fallback) {
  const v = process.env[name];
  return v == null || v === '' ? fallback : v;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function isTtyInteractive() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function toBasicAuthHeader(apiKey) {
  // Ashby: Basic base64(apiKey + ":")
  const token = Buffer.from(`${apiKey}:`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

function sanitizeFilePart(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[^\w\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function fileExists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load the rejected candidates tracking file.
 * Returns a Set of candidateIds that should be skipped.
 */
async function loadRejectedCandidateIds(datasetDir) {
  const rejectedPath = path.join(datasetDir, 'rejected_candidates.json');
  try {
    const raw = await fs.readFile(rejectedPath, 'utf8');
    const data = JSON.parse(raw);
    const ids = Object.keys(data.candidates || {});
    return new Set(ids);
  } catch {
    // File doesn't exist or is invalid - no rejected candidates
    return new Set();
  }
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function writeFileAtomic(targetPath, buf) {
  const dir = path.dirname(targetPath);
  const base = path.basename(targetPath);
  const tmp = path.join(dir, `.${base}.${Date.now()}.tmp`);
  await fs.writeFile(tmp, buf);
  await fs.rename(tmp, targetPath);
}

async function appendJsonl(filePath, obj) {
  const line = JSON.stringify(obj) + '\n';
  await fs.appendFile(filePath, line, 'utf8');
}

/**
 * A very small concurrency limiter (no deps).
 */
async function mapLimit(items, limit, fn) {
  const results = [];
  let i = 0;
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Ashby RPC client with light retry/backoff.
 *
 * Env:
 * - ASHBY_API_BASE: default https://api.ashbyhq.com
 * - ASHBY_RPC_PREFIX: default "" (some setups may require "/")
 */
function createAshbyClient({ apiKey }) {
  const base = getEnv('ASHBY_API_BASE', 'https://api.ashbyhq.com').replace(/\/+$/, '');
  const prefix = getEnv('ASHBY_RPC_PREFIX', '').replace(/\/+$/, '');
  const auth = toBasicAuthHeader(apiKey);

  async function rpc(method, body, { maxRetries = 5 } = {}) {
    const url = `${base}${prefix}/${method}`.replace(/([^:]\/)\/+/g, '$1');
    let attempt = 0;
    while (true) {
      attempt++;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: auth,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body ?? {}),
      }).catch((e) => {
        throw new Error(`Network error calling ${method}: ${e?.message || String(e)}`);
      });

      const text = await res.text();
      const isJson = (res.headers.get('content-type') || '').includes('application/json');
      const payload = isJson ? safeJsonParse(text) : null;

      if (res.ok) return payload ?? text;

      // Retry 429/5xx with backoff.
      const retriable = res.status === 429 || (res.status >= 500 && res.status <= 599);
      if (retriable && attempt <= maxRetries) {
        const ra = Number.parseInt(res.headers.get('retry-after') || '', 10);
        const backoffMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 250 * 2 ** (attempt - 1);
        await sleep(Math.min(backoffMs, 8000));
        continue;
      }

      const details = payload || text;
      throw new Error(
        `Ashby RPC ${method} failed: HTTP ${res.status}\n` +
          truncate(String(typeof details === 'string' ? details : JSON.stringify(details)), 2000)
      );
    }
  }

  return { rpc };
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function truncate(s, n) {
  if (s.length <= n) return s;
  return s.slice(0, n) + '\n...[truncated]';
}

function pickFirstArray(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const candidates = ['results', 'items', 'data', 'applications', 'candidates', 'records'];
  for (const k of candidates) {
    if (Array.isArray(obj[k])) return obj[k];
  }
  // fallback: first array-valued prop
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) return v;
  }
  return null;
}

function pickJobFields(job) {
  if (!job || typeof job !== 'object') return { id: null, title: null };
  const id = job.id || job.jobId || job.jobID || null;
  const title = job.title || job.name || job.requisitionTitle || null;
  return { id, title };
}

function pickNextCursor(obj) {
  if (!obj || typeof obj !== 'object') return null;
  return (
    obj.nextCursor ??
    obj.cursor ??
    obj.next ??
    obj.pagination?.nextCursor ??
    obj.pageInfo?.endCursor ??
    null
  );
}

/**
 * Attempts to extract:
 * - candidateId, applicationId, candidateName
 * - resume URL (best) OR resume fileHandle (needs second call)
 */
function extractCandidateAndResume(item) {
  const candidate =
    item?.candidate ||
    item?.candidateInfo ||
    item?.profile ||
    (item?.candidateId ? { id: item.candidateId } : null);

  const candidateId = candidate?.id || item?.candidateId || item?.candidateID || null;
  const applicationId = item?.id || item?.applicationId || item?.applicationID || null;
  const candidateName =
    candidate?.name ||
    [candidate?.firstName, candidate?.lastName].filter(Boolean).join(' ') ||
    item?.name ||
    null;

  // Try to find a direct URL
  const resumeUrl =
    item?.resume?.url ||
    item?.resumeUrl ||
    item?.resumeURL ||
    candidate?.resume?.url ||
    candidate?.resumeUrl ||
    null;

  // Try to find a file handle token
  const resumeFileHandle =
    item?.resume?.fileHandle ||
    item?.resumeFileHandle ||
    item?.resume_handle ||
    candidate?.resume?.fileHandle ||
    null;

  return {
    candidateId,
    applicationId,
    candidateName,
    resumeUrl,
    resumeFileHandle,
    // pass-through fields that are useful for filtering
    status: item?.status ?? null,
    currentInterviewStage: item?.currentInterviewStage ?? null,
    // createdAt for sorting (oldest first)
    createdAt: item?.createdAt ?? null,
    raw: item,
  };
}

async function downloadBinary(url, { headers = {}, maxRetries = 5 } = {}) {
  let attempt = 0;
  while (true) {
    attempt++;
    const res = await fetch(url, { headers });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      return { buf, contentType: res.headers.get('content-type') || '' };
    }

    const retriable = res.status === 429 || (res.status >= 500 && res.status <= 599);
    if (retriable && attempt <= maxRetries) {
      const ra = Number.parseInt(res.headers.get('retry-after') || '', 10);
      const backoffMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 250 * 2 ** (attempt - 1);
      await sleep(Math.min(backoffMs, 8000));
      continue;
    }

    const text = await res.text().catch(() => '');
    throw new Error(`Download failed HTTP ${res.status}: ${truncate(text || '(no body)', 800)}`);
  }
}

function looksLikePdf(buf) {
  if (!buf || buf.length < 5) return false;
  return buf.slice(0, 5).toString('utf8') === '%PDF-';
}

async function main() {
  const args = parseArgs(process.argv);

  const apiKey = mustGetEnv('ASHBY_API_KEY');
  const client = createAshbyClient({ apiKey });

  const outputDir = path.resolve(
    process.cwd(),
    String(args.outputDir || getEnv('ASHBY_OUTPUT_DIR', path.join('dataset', 'sentra_test_resumes')))
  );
  const metadataDir = path.resolve(
    process.cwd(),
    String(args.metadataDir || getEnv('ASHBY_METADATA_DIR', path.join('dataset', 'ashby_metadata')))
  );
  const ledgerPath = path.resolve(
    process.cwd(),
    String(args.ledger || getEnv('ASHBY_LEDGER_PATH', path.join('dataset', 'ashby_downloads.jsonl')))
  );

  const dryRun = Boolean(args['dry-run'] || args.dryRun);
  const limit = Number.parseInt(String(args.limit || getEnv('ASHBY_LIMIT', '50')), 10) || 50;
  const concurrency =
    Number.parseInt(String(args.concurrency || getEnv('ASHBY_CONCURRENCY', '3')), 10) || 3;
  const onlyStatus = String(args.onlyStatus || getEnv('ASHBY_ONLY_STATUS', '') || '');
  const stageTitleIncludes = String(
    args.stageTitleIncludes || getEnv('ASHBY_STAGE_TITLE_INCLUDES', '') || ''
  );
  const stageType = String(args.stageType || getEnv('ASHBY_STAGE_TYPE', '') || '');

  const jobListMethod = String(args.jobListMethod || getEnv('ASHBY_JOB_LIST_METHOD', 'job.list'));

  async function listJobs() {
    // Best-effort: different tenants may accept different filters; start empty.
    const payload = await client.rpc(jobListMethod, {});
    const jobs = pickFirstArray(payload) || [];
    return jobs
      .map((j) => ({ ...pickJobFields(j), raw: j }))
      .filter((j) => j.id);
  }

  if (args.listJobs) {
    const jobs = await listJobs();
    if (jobs.length === 0) {
      console.log('[ashby] no jobs returned from job list call');
      return;
    }
    console.log(`[ashby] jobs (${jobs.length}):`);
    for (const j of jobs.slice(0, 200)) {
      console.log(`- ${j.id}${j.title ? `  |  ${j.title}` : ''}`);
    }
    if (jobs.length > 200) console.log(`... (${jobs.length - 200} more)`);
    return;
  }

  // Job selection: prefer explicit jobId, else match by title substring, else interactive pick.
  let jobId = String(args.jobId || getEnv('ASHBY_JOB_ID', '') || '');
  const jobNameIncludes = String(args.jobNameIncludes || getEnv('ASHBY_JOB_NAME_INCLUDES', '') || '');

  if (!jobId && jobNameIncludes) {
    const jobs = await listJobs();
    const needle = jobNameIncludes.toLowerCase();
    const match = jobs.find((j) => (j.title || '').toLowerCase().includes(needle));
    if (!match) {
      throw new Error(
        `No job matched ASHBY_JOB_NAME_INCLUDES=${jobNameIncludes}. Try: node scripts/ashby-download-resumes.mjs --listJobs`
      );
    }
    jobId = String(match.id);
    console.log(`[ashby] selected jobId=${jobId} by title match (${match.title || 'unknown'})`);
  }

  if (!jobId && isTtyInteractive()) {
    const jobs = await listJobs();
    if (jobs.length === 0) {
      throw new Error('No jobs returned; cannot select interactively.');
    }
    console.log('[ashby] choose a job:');
    jobs.slice(0, 30).forEach((j, idx) => {
      console.log(`${idx + 1}. ${j.title || '(no title)'}  (${j.id})`);
    });
    if (jobs.length > 30) console.log(`... (${jobs.length - 30} more not shown)`);

    const rl = readline.createInterface({ input, output });
    const answer = await rl.question('Enter number (or paste a jobId): ');
    rl.close();
    const n = Number.parseInt(answer.trim(), 10);
    if (Number.isFinite(n) && n >= 1 && n <= Math.min(30, jobs.length)) {
      jobId = String(jobs[n - 1].id);
    } else if (answer.trim()) {
      jobId = answer.trim();
    }
  }

  if (!jobId) {
    throw new Error(
      'Missing jobId. Provide --jobId <JOB_ID>, set ASHBY_JOB_ID, set ASHBY_JOB_NAME_INCLUDES, or run with --listJobs (interactive selection works in a TTY).'
    );
  }

  const listMethod = String(
    args.listMethod || getEnv('ASHBY_APPLICATION_LIST_METHOD', 'application.list')
  );

  // Two common request body shapes; you can override by setting ASHBY_APPLICATION_LIST_BODY_JSON.
  const defaultBodyA = { jobId, limit };
  const defaultBodyB = { filter: { jobId }, limit };
  const bodyOverride = getEnv('ASHBY_APPLICATION_LIST_BODY_JSON', '');

  const bodiesToTry = bodyOverride
    ? [safeJsonParse(bodyOverride)]
    : [defaultBodyA, defaultBodyB].filter(Boolean);

  await ensureDir(outputDir);
  await ensureDir(metadataDir);

  // Load rejected IDs EARLY so we can skip them during pagination
  const datasetDir = path.resolve(process.cwd(), 'dataset');
  const rejectedIds = await loadRejectedCandidateIds(datasetDir);
  console.log(`[ashby] ${rejectedIds.size} candidates in rejected tracking list`);

  // Helper function to check if a candidate passes filters
  const passesFilters = (e) => {
    if (onlyStatus && String(e.status || '').toLowerCase() !== onlyStatus.toLowerCase())
      return false;
    const title = String(e.currentInterviewStage?.title || '');
    const type = String(e.currentInterviewStage?.type || '');
    if (stageType && type.toLowerCase() !== stageType.toLowerCase()) return false;
    if (stageTitleIncludes && !title.toLowerCase().includes(stageTitleIncludes.toLowerCase()))
      return false;
    return true;
  };

  // 1) Fetch applications/candidates list (with pagination)
  // We need to fetch until we have `limit` candidates that:
  //   a) pass filters AND
  //   b) aren't in rejected list AND
  //   c) don't already exist on disk
  let all = [];
  let downloadableCount = 0;
  let cursor = null;

  for (let page = 0; page < 200; page++) {
    let lastErr = null;
    let payload = null;

    for (const baseBody of bodiesToTry) {
      if (!baseBody) continue;
      const body = { ...baseBody };
      if (cursor) body.cursor = cursor;

      try {
        payload = await client.rpc(listMethod, body);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
      }
    }

    if (!payload) throw lastErr || new Error('Failed to fetch applications list');

    const items = pickFirstArray(payload) || [];
    
    // Extract and filter in real-time to count towards limit
    for (const item of items) {
      const extracted = extractCandidateAndResume(item);
      if (!extracted.candidateId && !extracted.applicationId) continue;
      
      // Check if this candidate passes filters AND isn't rejected
      if (passesFilters(extracted) && !rejectedIds.has(extracted.candidateId)) {
        // Also check if file already exists (idempotency)
        const namePart = sanitizeFilePart(extracted.candidateName || 'candidate');
        const fileName = `${namePart}__${sanitizeFilePart(extracted.candidateId)}__${sanitizeFilePart(extracted.applicationId)}.pdf`;
        const pdfPath = path.join(outputDir, fileName);
        const alreadyExists = await fileExists(pdfPath);
        
        if (!alreadyExists) {
          downloadableCount++;
        }
      }
      all.push(item);
    }

    cursor = pickNextCursor(payload);
    if (!cursor) break;
    // Stop when we have enough DOWNLOADABLE candidates
    if (downloadableCount >= limit) break;
  }

  console.log(
    `[ashby] fetched ${all.length} records via ${listMethod} (jobId=${jobId}, dryRun=${dryRun})`
  );
  console.log(`[ashby] Found ${downloadableCount} downloadable candidates (target: ${limit})`);

  // 2) Extract candidate+resume pointers
  const extracted = all
    .map((x) => extractCandidateAndResume(x))
    .filter((x) => x.candidateId || x.applicationId);

  // Optional client-side filters (low breakage; avoids needing perfect RPC filters).
  let filtered = extracted.filter((e) => {
    if (onlyStatus && String(e.status || '').toLowerCase() !== onlyStatus.toLowerCase())
      return false;

    const title = String(e.currentInterviewStage?.title || '');
    const type = String(e.currentInterviewStage?.type || '');

    if (stageType && type.toLowerCase() !== stageType.toLowerCase()) return false;
    if (stageTitleIncludes && !title.toLowerCase().includes(stageTitleIncludes.toLowerCase()))
      return false;
    return true;
  });

  // Sort by createdAt (oldest first) so we process the earliest applicants first
  filtered.sort((a, b) => {
    const dateA = a.createdAt ? new Date(a.createdAt).getTime() : Infinity;
    const dateB = b.createdAt ? new Date(b.createdAt).getTime() : Infinity;
    return dateA - dateB; // Ascending = oldest first
  });

  console.log(`[ashby] Sorted ${filtered.length} candidates by application date (oldest first)`);

  // Filter out previously rejected candidates (already loaded early for pagination)
  const notRejected = filtered.filter((e) => {
    if (rejectedIds.has(e.candidateId)) {
      console.log(`[ashby] Skipping previously rejected candidate: ${e.candidateName || e.candidateId}`);
      return false;
    }
    return true;
  });

  const skippedRejected = filtered.length - notRejected.length;
  if (skippedRejected > 0) {
    console.log(`[ashby] Skipped ${skippedRejected} previously rejected candidate(s)`);
  }

  // Apply limit and replace filtered with notRejected for subsequent steps
  // Slice to the requested limit (we may have over-fetched to find enough matching candidates)
  const finalFiltered = notRejected.slice(0, limit);
  
  if (notRejected.length > limit) {
    console.log(`[ashby] Limiting to ${limit} candidates (${notRejected.length - limit} more available)`);
  }

  // 3) Resolve resume URLs (direct URL or via file-handle resolution)
  const fileResolveMethod = String(
    args.fileResolveMethod || getEnv('ASHBY_FILE_RESOLVE_METHOD', 'file.info')
  );

  async function resolveResumeUrl(e) {
    if (e.resumeUrl) return { ...e, resolvedResumeUrl: e.resumeUrl };

    // If application.list doesn't include resume handle, fetch candidate.info (best-effort).
    let resumeHandle = e.resumeFileHandle;
    if (!resumeHandle && e.candidateId) {
      try {
        const ci = await client.rpc('candidate.info', { id: e.candidateId });
        // candidate.info -> { success, results: { resumeFileHandle: { handle }, fileHandles: [...] } }
        const handleFromResume = ci?.results?.resumeFileHandle?.handle ?? null;
        const handleFromFiles = ci?.results?.fileHandles?.[0]?.handle ?? null;
        resumeHandle = handleFromResume || handleFromFiles || null;
      } catch (err) {
        return {
          ...e,
          resolvedResumeUrl: null,
          candidateInfoError: String(err?.message || err),
        };
      }
    }

    if (!resumeHandle) return { ...e, resolvedResumeUrl: null };

    // Coerce possible object shapes to a handle string
    if (typeof resumeHandle === 'object' && resumeHandle) {
      resumeHandle = resumeHandle.handle || resumeHandle.fileHandle || resumeHandle.id || null;
    }

    if (typeof resumeHandle !== 'string' || resumeHandle.length === 0) {
      return { ...e, resolvedResumeUrl: null };
    }

    try {
      const resp = await client.rpc(fileResolveMethod, { fileHandle: resumeHandle });
      const url =
        resp?.url ||
        resp?.downloadUrl ||
        resp?.downloadURL ||
        resp?.signedUrl ||
        resp?.signedURL ||
        resp?.results?.url ||
        null;
      return { ...e, resolvedResumeUrl: url, fileResolveResp: resp };
    } catch (err) {
      return { ...e, resolvedResumeUrl: null, fileResolveError: String(err?.message || err) };
    }
  }

  const resolved = await mapLimit(
    finalFiltered,
    Math.max(1, Math.min(concurrency, 6)),
    resolveResumeUrl
  );

  // 4) Download + write PDFs
  const withUrls = resolved.filter((r) => typeof r.resolvedResumeUrl === 'string' && r.resolvedResumeUrl);

  console.log(`[ashby] ${withUrls.length}/${resolved.length} records have a downloadable resume URL`);

  if (dryRun) {
    // Write a debug snapshot to help adjust parsing without downloading any PDFs.
    const debugPath = path.resolve(
      process.cwd(),
      String(args.debugOut || getEnv('ASHBY_DEBUG_OUT', path.join('dataset', 'ashby_debug.json')))
    );
    await ensureDir(path.dirname(debugPath));
    await writeFileAtomic(
      debugPath,
      Buffer.from(
        JSON.stringify(
          {
            jobId,
            listMethod,
            fileResolveMethod,
            fetched: all.length,
            resolved: resolved.slice(0, 5),
            hint:
              'If resolvedResumeUrl is null, you likely need to set ASHBY_APPLICATION_LIST_METHOD / ASHBY_FILE_RESOLVE_METHOD based on your Ashby API docs.',
          },
          null,
          2
        ),
        'utf8'
      )
    );
    console.log(`[ashby] dry-run complete. wrote debug file: ${debugPath}`);
    return;
  }

  async function downloadOne(r) {
    const candidateId = r.candidateId || 'unknown_candidate';
    const applicationId = r.applicationId || 'unknown_app';
    const namePart = sanitizeFilePart(r.candidateName || 'candidate');
    const fileName = `${namePart}__${sanitizeFilePart(candidateId)}__${sanitizeFilePart(applicationId)}.pdf`;
    const pdfPath = path.join(outputDir, fileName);
    const metaPath = path.join(metadataDir, `${sanitizeFilePart(candidateId)}.json`);

    // Idempotency: if PDF already exists, skip
    if (await fileExists(pdfPath)) {
      await appendJsonl(ledgerPath, {
        ts: Date.now(),
        status: 'skipped_exists',
        pdfPath,
        candidateId,
        applicationId,
      });
      return { status: 'skipped_exists', pdfPath };
    }

    const { buf, contentType } = await downloadBinary(r.resolvedResumeUrl);
    const hash = sha256(buf);

    if (!looksLikePdf(buf)) {
      await appendJsonl(ledgerPath, {
        ts: Date.now(),
        status: 'failed_not_pdf',
        candidateId,
        applicationId,
        pdfPath,
        contentType,
        size: buf.length,
      });
      throw new Error(`Downloaded content does not look like a PDF (candidateId=${candidateId})`);
    }

    await writeFileAtomic(pdfPath, buf);

    const metadata = {
      source: 'ashby',
      jobId,
      candidate: {
        id: candidateId,
        name: r.candidateName || null,
      },
      application: {
        id: applicationId,
      },
      resume: {
        url: r.resolvedResumeUrl,
        contentType,
        sha256: hash,
        downloadedAt: new Date().toISOString(),
      },
      local: {
        pdfPath,
        fileName,
      },
      // Keep raw record for debugging (you can remove this later if you want).
      raw: r.raw,
    };

    await writeFileAtomic(metaPath, Buffer.from(JSON.stringify(metadata, null, 2), 'utf8'));
    await appendJsonl(ledgerPath, {
      ts: Date.now(),
      status: 'downloaded',
      pdfPath,
      metaPath,
      candidateId,
      applicationId,
      sha256: hash,
    });

    return { status: 'downloaded', pdfPath };
  }

  const results = await mapLimit(withUrls, Math.max(1, Math.min(concurrency, 4)), async (r) => {
    try {
      return await downloadOne(r);
    } catch (e) {
      console.error(`[ashby] download failed: candidateId=${r.candidateId} err=${e?.message || e}`);
      await appendJsonl(ledgerPath, {
        ts: Date.now(),
        status: 'failed',
        candidateId: r.candidateId || null,
        applicationId: r.applicationId || null,
        error: String(e?.message || e),
      });
      return { status: 'failed' };
    }
  });

  const ok = results.filter((r) => r?.status === 'downloaded').length;
  const skipped = results.filter((r) => r?.status === 'skipped_exists').length;
  const failed = results.filter((r) => r?.status === 'failed').length;
  console.log(`[ashby] done. downloaded=${ok} skipped=${skipped} failed=${failed}`);
  console.log(`[ashby] resumes saved to: ${outputDir}`);
  console.log(`[ashby] metadata saved to: ${metadataDir}`);
  console.log(`[ashby] ledger: ${ledgerPath}`);
}

main().catch((e) => {
  console.error(e?.stack || e?.message || e);
  process.exitCode = 1;
});


