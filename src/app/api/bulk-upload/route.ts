import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getBulkUploadsDir, appendBulkPendingIfMissing } from '@/lib/bulkManifest';

export const runtime = 'nodejs';

// Max file size: 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;
// Max files per request (increased to 1000 for bulk processing)
const MAX_FILES_PER_REQUEST = 1000;

function sanitizeFilename(filename: string): string {
  // Remove path traversal attempts and invalid characters
  const sanitized = filename
    .replace(/[\/\\:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  
  // Ensure it ends with .pdf
  if (!sanitized.toLowerCase().endsWith('.pdf')) {
    return sanitized + '.pdf';
  }
  return sanitized;
}

async function ensureUniqueFilename(dir: string, baseFilename: string): Promise<string> {
  const ext = path.extname(baseFilename);
  const name = path.basename(baseFilename, ext);
  
  let filename = baseFilename;
  let counter = 1;
  
  while (true) {
    try {
      await fs.access(path.join(dir, filename));
      // File exists, try next number
      filename = `${name}_${counter}${ext}`;
      counter++;
    } catch {
      // File doesn't exist, use this name
      break;
    }
  }
  
  return filename;
}

export async function POST(request: NextRequest) {
  try {
    const uploadsDir = getBulkUploadsDir();
    
    // Ensure directory exists
    await fs.mkdir(uploadsDir, { recursive: true });
    
    const formData = await request.formData();
    const files = formData.getAll('files') as File[];
    
    if (!files || files.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'No files provided' },
        { status: 400 }
      );
    }
    
    if (files.length > MAX_FILES_PER_REQUEST) {
      return NextResponse.json(
        { ok: false, error: `Maximum ${MAX_FILES_PER_REQUEST} files allowed per upload` },
        { status: 400 }
      );
    }
    
    const results: { filename: string; originalName: string; status: 'success' | 'error'; error?: string }[] = [];
    
    for (const file of files) {
      const originalName = file.name;
      
      // Validate file type
      if (!originalName.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
        results.push({
          filename: originalName,
          originalName,
          status: 'error',
          error: 'Not a PDF file',
        });
        continue;
      }
      
      // Validate file size
      if (file.size > MAX_FILE_SIZE) {
        results.push({
          filename: originalName,
          originalName,
          status: 'error',
          error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)`,
        });
        continue;
      }
      
      try {
        const sanitizedName = sanitizeFilename(originalName);
        const uniqueFilename = await ensureUniqueFilename(uploadsDir, sanitizedName);
        const filePath = path.join(uploadsDir, uniqueFilename);
        
        // Write file to disk
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        await fs.writeFile(filePath, buffer);
        
        // Add to manifest as pending
        await appendBulkPendingIfMissing(uniqueFilename);
        
        results.push({
          filename: uniqueFilename,
          originalName,
          status: 'success',
        });
      } catch (err) {
        results.push({
          filename: originalName,
          originalName,
          status: 'error',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
    
    const successful = results.filter(r => r.status === 'success').length;
    const failed = results.filter(r => r.status === 'error').length;
    
    return NextResponse.json({
      ok: true,
      uploaded: successful,
      failed,
      results,
    });
  } catch (err) {
    console.error('[bulk-upload] Error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Upload failed' },
      { status: 500 }
    );
  }
}



