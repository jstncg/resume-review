import { NextResponse } from 'next/server';
import { ashbyRpc, isAshbyConfigured } from '@/lib/ashbyClient';

export const runtime = 'nodejs';

type EmailTemplate = {
  id: string;
  name: string;
  subject?: string;
  body?: string;
};

/**
 * GET /api/ashby-email-templates
 * Lists available email templates from Ashby.
 * Requires API key with Email Templates Read permission.
 */
export async function GET() {
  if (!isAshbyConfigured()) {
    return NextResponse.json(
      { ok: false, configured: false, error: 'Ashby API key not configured' },
      { status: 503 }
    );
  }

  try {
    const result = await ashbyRpc<EmailTemplate[]>('emailTemplate.list', {});

    if (!result.success) {
      return NextResponse.json(
        {
          ok: false,
          configured: true,
          error: result.error || 'Failed to fetch email templates',
          hint: 'Ensure your API key has Email Templates Read permission',
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      configured: true,
      templates: result.results || [],
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        configured: true,
        error: err instanceof Error ? err.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}



