import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { isSafeFilename } from '@/lib/utils';

export const runtime = 'nodejs';

function resumesDir() {
  return path.resolve(process.cwd(), 'dataset', 'sentra_test_resumes');
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const filename = url.searchParams.get('filename') || '';
  const download = url.searchParams.get('download') === '1';

  if (!isSafeFilename(filename)) {
    return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
  }

  const absPath = path.join(resumesDir(), filename);

  let buf: Buffer;
  try {
    buf = await fs.readFile(absPath);
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  const body = new Uint8Array(buf);
  return new Response(body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${
        download ? 'attachment' : 'inline'
      }; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
