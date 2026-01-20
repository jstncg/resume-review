import { NextResponse } from 'next/server';
import { clearBulkUploadsDir } from '@/lib/bulkManifest';

export const runtime = 'nodejs';

export async function POST() {
  try {
    const deleted = await clearBulkUploadsDir();
    
    return NextResponse.json({
      ok: true,
      deleted,
    });
  } catch (err) {
    console.error('[bulk-clear] Error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Clear failed' },
      { status: 500 }
    );
  }
}

export async function GET() {
  // Return count of files without deleting
  const { promises: fs } = await import('node:fs');
  const { getBulkUploadsDir } = await import('@/lib/bulkManifest');
  
  const dir = getBulkUploadsDir();
  let count = 0;
  
  try {
    const files = await fs.readdir(dir);
    count = files.filter(f => f.toLowerCase().endsWith('.pdf')).length;
  } catch {
    // Directory doesn't exist
  }
  
  return NextResponse.json({
    ok: true,
    count,
  });
}



