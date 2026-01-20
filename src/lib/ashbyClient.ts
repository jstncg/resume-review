/**
 * Ashby API Client
 * 
 * Server-side client for Ashby ATS operations with retry logic
 * and typed methods for common operations.
 */

const ASHBY_API_BASE = process.env.ASHBY_API_BASE || 'https://api.ashbyhq.com';

export function getAshbyAuthHeader(): string {
  const apiKey = process.env.ASHBY_API_KEY;
  if (!apiKey) throw new Error('ASHBY_API_KEY not configured');
  return `Basic ${Buffer.from(`${apiKey}:`, 'utf8').toString('base64')}`;
}

export function isAshbyConfigured(): boolean {
  return Boolean(process.env.ASHBY_API_KEY);
}

type AshbyResponse<T> = { success: boolean; results?: T; error?: string; nextCursor?: string };

/**
 * Generic Ashby RPC call with retry logic and rate limit handling.
 */
export async function ashbyRpc<T = unknown>(
  method: string,
  body: Record<string, unknown> = {},
  options: { maxRetries?: number } = {}
): Promise<AshbyResponse<T>> {
  const { maxRetries = 3 } = options;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(`${ASHBY_API_BASE}/${method}`, {
        method: 'POST',
        headers: {
          Authorization: getAshbyAuthHeader(),
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      });

      const text = await res.text();
      let data: AshbyResponse<T>;
      
      try {
        data = JSON.parse(text);
      } catch {
        return { success: false, error: `Invalid JSON: ${text.slice(0, 200)}` };
      }

      // Handle rate limiting with exponential backoff
      if (res.status === 429 && attempt < maxRetries) {
        const retryAfter = parseInt(res.headers.get('retry-after') || '1', 10);
        await sleep(retryAfter * 1000);
        continue;
      }

      return data;
    } catch (err) {
      lastError = err as Error;
      if (attempt < maxRetries) {
        await sleep(500 * attempt);
      }
    }
  }

  return { success: false, error: lastError?.message || 'Unknown error' };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────────────
// Typed API methods
// ─────────────────────────────────────────────────────────────────────────────

export type AshbyJob = {
  id: string;
  title: string;
  status: string;
  location?: { name: string } | null;
  department?: { name: string } | null;
};

export type AshbyApplication = {
  id: string;
  candidateId: string;
  status: string;
  candidate?: {
    id: string;
    name: string;
  };
};

/**
 * List all jobs from Ashby.
 */
export async function listJobs(): Promise<AshbyJob[]> {
  const result = await ashbyRpc<AshbyJob[]>('job.list');
  return result.success ? result.results || [] : [];
}

/**
 * List applications for a specific job.
 */
export async function listApplications(
  jobId: string,
  limit: number = 50
): Promise<AshbyApplication[]> {
  const result = await ashbyRpc<AshbyApplication[]>('application.list', {
    jobId,
    limit,
  });
  return result.success ? result.results || [] : [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Interview Stage Types & Methods
// ─────────────────────────────────────────────────────────────────────────────

export type InterviewStage = {
  id: string;
  title: string;
  type: string;  // "PreInterviewScreen", "Active", "Archived", etc.
  orderInInterviewPlan: number;
  interviewPlanId: string;
  interviewStageGroupId?: string;
};

export type ApplicationWithStage = {
  id: string;
  candidateId: string;
  status: string;
  currentInterviewStage: InterviewStage | null;
  candidate?: {
    id: string;
    name: string;
  };
};

/**
 * Get all unique interview stages for a job by fetching applications.
 * This works even without interviewStage.list permission.
 */
export async function getInterviewStagesForJob(jobId: string): Promise<InterviewStage[]> {
  const stagesMap = new Map<string, InterviewStage>();
  let cursor: string | null = null;
  
  // Fetch applications to extract stages
  for (let page = 0; page < 20; page++) {
    const body: Record<string, unknown> = { jobId, limit: 100 };
    if (cursor) body.cursor = cursor;
    
    const result = await ashbyRpc<ApplicationWithStage[]>('application.list', body);
    if (!result.success || !result.results) break;
    
    for (const app of result.results) {
      const stage = app.currentInterviewStage;
      if (stage && !stagesMap.has(stage.id)) {
        stagesMap.set(stage.id, {
          id: stage.id,
          title: stage.title,
          type: stage.type,
          orderInInterviewPlan: stage.orderInInterviewPlan,
          interviewPlanId: stage.interviewPlanId,
          interviewStageGroupId: stage.interviewStageGroupId,
        });
      }
    }
    
    // Check for pagination (nextCursor in response)
    const rawResult = result as { nextCursor?: string };
    cursor = rawResult.nextCursor || null;
    if (!cursor) break;
  }
  
  // Sort by order in interview plan
  return [...stagesMap.values()].sort(
    (a, b) => a.orderInInterviewPlan - b.orderInInterviewPlan
  );
}

/**
 * Move an application to a different interview stage.
 * Requires "Candidates: Write" or "Applications: Write" permission.
 */
export async function changeApplicationStage(
  applicationId: string,
  interviewStageId: string
): Promise<{ success: boolean; error?: string }> {
  const result = await ashbyRpc<{ application: ApplicationWithStage }>(
    'application.changeStage',
    { applicationId, interviewStageId }
  );
  
  if (!result.success) {
    return { 
      success: false, 
      error: result.error || 'Failed to change stage' 
    };
  }
  
  return { success: true };
}

/**
 * Check if the changeStage API is available (has permission).
 */
export async function canChangeStage(): Promise<boolean> {
  // Try with invalid IDs - if we get "missing_endpoint_permission" we don't have access
  // If we get "invalid_input" or similar, we have access but wrong params
  const result = await ashbyRpc<unknown>(
    'application.changeStage',
    { applicationId: 'test-invalid', interviewStageId: 'test-invalid' }
  );
  
  // If error contains "missing_endpoint_permission", we don't have access
  const errorStr = JSON.stringify(result);
  return !errorStr.includes('missing_endpoint_permission');
}

