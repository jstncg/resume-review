import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getBulkUploadsDir } from '@/lib/bulkManifest';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const filename = searchParams.get('filename');
  const download = searchParams.get('download') === '1';

  if (!filename) {
    return NextResponse.json(
      { ok: false, error: 'filename is required' },
      { status: 400 }
    );
  }

  // Sanitize filename to prevent path traversal
  const sanitizedFilename = path.basename(filename);
  const uploadsDir = getBulkUploadsDir();
  const filePath = path.join(uploadsDir, sanitizedFilename);

  // Ensure the resolved path is within the uploads directory
  const resolvedPath = path.resolve(filePath);
  const resolvedDir = path.resolve(uploadsDir);
  if (!resolvedPath.startsWith(resolvedDir)) {
    return NextResponse.json(
      { ok: false, error: 'Invalid filename' },
      { status: 400 }
    );
  }

  try {
    const fileBuffer = await fs.readFile(resolvedPath);
    
    const headers: HeadersInit = {
      'Content-Type': 'application/pdf',
    };
    
    if (download) {
      headers['Content-Disposition'] = `attachment; filename="${encodeURIComponent(sanitizedFilename)}"`;
    } else {
      headers['Content-Disposition'] = `inline; filename="${encodeURIComponent(sanitizedFilename)}"`;
    }

    return new NextResponse(fileBuffer, { headers });
  } catch (err) {
    console.error('[bulk-pdf] Error reading file:', err);
    return NextResponse.json(
      { ok: false, error: 'File not found' },
      { status: 404 }
    );
  }
}



