import { NextResponse } from 'next/server';
import { upsertManifestLabel } from '@/lib/manifest';
import { emitResumeLabelUpdate } from '@/lib/resumeWatcher';
import { STATUS_USER_REVIEWED_PREFIX } from '@/lib/labels';

export const runtime = 'nodejs';

function sanitizeReview(input: string) {
  // Keep it single-line for CSV friendliness and UI rendering.
  return input.replace(/\r?\n/g, ' ').trim();
}

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const filename = body?.filename;
  const relPath = body?.relPath;
  const reviewRaw = body?.review;

  if (typeof filename !== 'string' || typeof relPath !== 'string') {
    return NextResponse.json(
      {
        error: 'Expected { filename: string, relPath: string, review: string }',
      },
      { status: 400 }
    );
  }

  if (typeof reviewRaw !== 'string') {
    return NextResponse.json(
      { error: 'Review must be a string' },
      { status: 400 }
    );
  }

  const review = sanitizeReview(reviewRaw);
  if (review.length === 0) {
    return NextResponse.json({ error: 'Review is required' }, { status: 400 });
  }

  if (review.length > 256) {
    return NextResponse.json(
      { error: 'Review must be <= 256 characters' },
      { status: 400 }
    );
  }

  const label = `${STATUS_USER_REVIEWED_PREFIX}${review}`;
  await upsertManifestLabel(filename, label);

  // Push live update to connected clients
  emitResumeLabelUpdate({ filename, relPath, label });

  return NextResponse.json({ ok: true, filename, relPath, label });
}
