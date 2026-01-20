/**
 * Ashby API Client
 */

const BASE_URL = process.env.ASHBY_API_BASE || 'https://api.ashbyhq.com';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function getAshbyAuthHeader(): string {
  const apiKey = process.env.ASHBY_API_KEY;
  if (!apiKey) throw new Error('ASHBY_API_KEY not configured');
  return `Basic ${Buffer.from(`${apiKey}:`, 'utf8').toString('base64')}`;
}

export const isAshbyConfigured = (): boolean => Boolean(process.env.ASHBY_API_KEY);

type AshbyResponse<T> = { success: boolean; results?: T; error?: string; nextCursor?: string };

export async function ashbyRpc<T = unknown>(
  method: string,
  body: Record<string, unknown> = {},
  options: { maxRetries?: number } = {}
): Promise<AshbyResponse<T>> {
  const { maxRetries = 3 } = options;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}/${method}`, {
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

      // Rate limiting
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

// ============================================================================
// Typed API Methods
// ============================================================================

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
  candidate?: { id: string; name: string };
};

export type InterviewStage = {
  id: string;
  title: string;
  type: string;
  orderInInterviewPlan: number;
  interviewPlanId: string;
  interviewStageGroupId?: string;
};

export type ApplicationWithStage = AshbyApplication & {
  currentInterviewStage: InterviewStage | null;
};

export async function listJobs(): Promise<AshbyJob[]> {
  const result = await ashbyRpc<AshbyJob[]>('job.list');
  return result.success ? result.results || [] : [];
}

export async function listApplications(jobId: string, limit = 50): Promise<AshbyApplication[]> {
  const result = await ashbyRpc<AshbyApplication[]>('application.list', { jobId, limit });
  return result.success ? result.results || [] : [];
}

export async function getInterviewStagesForJob(jobId: string): Promise<InterviewStage[]> {
  const stagesMap = new Map<string, InterviewStage>();
  let cursor: string | null = null;

  for (let page = 0; page < 20; page++) {
    const body: Record<string, unknown> = { jobId, limit: 100 };
    if (cursor) body.cursor = cursor;

    const result = await ashbyRpc<ApplicationWithStage[]>('application.list', body);
    if (!result.success || !result.results) break;

    for (const app of result.results) {
      const stage = app.currentInterviewStage;
      if (stage && !stagesMap.has(stage.id)) {
        stagesMap.set(stage.id, stage);
      }
    }

    cursor = (result as { nextCursor?: string }).nextCursor || null;
    if (!cursor) break;
  }

  return [...stagesMap.values()].sort((a, b) => a.orderInInterviewPlan - b.orderInInterviewPlan);
}

export async function changeApplicationStage(
  applicationId: string,
  interviewStageId: string
): Promise<{ success: boolean; error?: string }> {
  const result = await ashbyRpc<{ application: ApplicationWithStage }>(
    'application.changeStage',
    { applicationId, interviewStageId }
  );

  return result.success ? { success: true } : { success: false, error: result.error || 'Failed' };
}

export async function canChangeStage(): Promise<boolean> {
  const result = await ashbyRpc<unknown>(
    'application.changeStage',
    { applicationId: 'test-invalid', interviewStageId: 'test-invalid' }
  );
  return !JSON.stringify(result).includes('missing_endpoint_permission');
}
