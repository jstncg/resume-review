import { NextResponse } from 'next/server';
import { upsertManifestLabel } from '@/lib/manifest';
import { emitResumeLabelUpdate } from '@/lib/resumeWatcher';
import { STATUS_USER_REVIEWED_PREFIX } from '@/lib/labels';

export const runtime = 'nodejs';

type ReviewRequest = { filename?: string; relPath?: string; review?: string };

export async function POST(req: Request) {
  let body: ReviewRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { filename, relPath, review: reviewRaw } = body;

  if (typeof filename !== 'string' || typeof relPath !== 'string') {
    return NextResponse.json({ error: 'filename and relPath required' }, { status: 400 });
  }

  if (typeof reviewRaw !== 'string') {
    return NextResponse.json({ error: 'review must be string' }, { status: 400 });
  }

  const review = reviewRaw.replace(/\r?\n/g, ' ').trim();
  if (!review) {
    return NextResponse.json({ error: 'Review required' }, { status: 400 });
  }

  if (review.length > 255) {
    return NextResponse.json({ error: 'Review must be ≤ 255 chars' }, { status: 400 });
  }

  const label = `${STATUS_USER_REVIEWED_PREFIX}${review}`;
  await upsertManifestLabel(filename, label);
  emitResumeLabelUpdate({ filename, relPath, label });

  return NextResponse.json({ ok: true, filename, relPath, label });
}
