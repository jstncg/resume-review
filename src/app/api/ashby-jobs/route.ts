import { NextResponse } from 'next/server';
import { isAshbyConfigured, listJobs } from '@/lib/ashbyClient';

export const runtime = 'nodejs';

/**
 * GET /api/ashby-jobs
 * Returns a list of all jobs from Ashby.
 */
export async function GET() {
  // Check if Ashby is configured
  if (!isAshbyConfigured()) {
    return NextResponse.json({
      ok: false,
      configured: false,
      error: 'Ashby API key not configured. Add ASHBY_API_KEY to .env.local',
      jobs: [],
    });
  }

  try {
    const rawJobs = await listJobs();

    // Format for UI
    const jobs = rawJobs.map((job) => ({
      id: job.id,
      title: job.title,
      status: job.status || 'Unknown',
      location: job.location?.name || null,
      department: job.department?.name || null,
    }));

    // Sort: Open jobs first, then by title
    jobs.sort((a, b) => {
      if (a.status === 'Open' && b.status !== 'Open') return -1;
      if (a.status !== 'Open' && b.status === 'Open') return 1;
      return a.title.localeCompare(b.title);
    });

    return NextResponse.json({
      ok: true,
      configured: true,
      jobs,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      {
        ok: false,
        configured: true,
        error: message,
        jobs: [],
      },
      { status: 500 }
    );
  }
}



