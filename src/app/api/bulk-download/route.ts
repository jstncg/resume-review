import { NextResponse } from 'next/server';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import archiver from 'archiver';
import { PassThrough } from 'node:stream';
import { getBulkUploadsDir, readBulkManifestLabels, readBulkCandidateNames } from '@/lib/bulkManifest';
import { PASSING_STATUSES } from '@/lib/labels';

export const runtime = 'nodejs';

// Helper to sanitize filename
function sanitizeFilename(name: string): string {
  // Remove or replace characters that are invalid in filenames
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .trim();
}

export async function GET() {
  try {
    const dir = getBulkUploadsDir();
    const labels = await readBulkManifestLabels();
    const candidateNames = await readBulkCandidateNames();

    // Get all passing files
    const passingFiles: { filename: string; label: string; candidateName: string | null }[] = [];
    
    for (const [filename, label] of labels) {
      if (PASSING_STATUSES.includes(label as typeof PASSING_STATUSES[number])) {
        passingFiles.push({
          filename,
          label,
          candidateName: candidateNames.get(filename) ?? null,
        });
      }
    }

    if (passingFiles.length === 0) {
      return NextResponse.json({ error: 'No passed resumes to download' }, { status: 400 });
    }

    // Create a pass-through stream to pipe the archive
    const passThrough = new PassThrough();

    // Create archive
    const archive = archiver('zip', {
      zlib: { level: 5 }, // Moderate compression for speed
    });

    // Handle archive errors
    archive.on('error', (err) => {
      console.error('[bulk-download] Archive error:', err);
      passThrough.destroy(err);
    });

    // Pipe archive to the pass-through stream
    archive.pipe(passThrough);

    // Track used names to avoid duplicates
    const usedNames = new Set<string>();

    // Add files to the archive with renamed names
    for (const file of passingFiles) {
      const filePath = path.join(dir, file.filename);
      
      // Check if file exists
      try {
        await fs.access(filePath);
      } catch {
        console.warn(`[bulk-download] File not found: ${file.filename}`);
        continue;
      }

      // Determine the output filename
      let outputName: string;
      
      if (file.candidateName && file.candidateName !== 'Unknown') {
        // Use candidate name with tier prefix
        const tierPrefix = file.label === 'perfect' ? '1_PERFECT' :
                          file.label === 'very_good' ? '2_VERY_GOOD' : '3_PASSED';
        const baseName = sanitizeFilename(file.candidateName);
        outputName = `${tierPrefix}/${baseName}.pdf`;
      } else {
        // Fall back to original filename
        const tierPrefix = file.label === 'perfect' ? '1_PERFECT' :
                          file.label === 'very_good' ? '2_VERY_GOOD' : '3_PASSED';
        outputName = `${tierPrefix}/${file.filename}`;
      }

      // Handle duplicate names
      let finalName = outputName;
      let counter = 1;
      while (usedNames.has(finalName.toLowerCase())) {
        const ext = path.extname(outputName);
        const base = outputName.slice(0, -ext.length);
        finalName = `${base}_${counter}${ext}`;
        counter++;
      }
      usedNames.add(finalName.toLowerCase());

      // Add file to archive
      archive.file(filePath, { name: finalName });
    }

    // Finalize the archive
    archive.finalize();

    // Create readable stream from pass-through
    const readableStream = new ReadableStream({
      start(controller) {
        passThrough.on('data', (chunk) => {
          controller.enqueue(chunk);
        });
        passThrough.on('end', () => {
          controller.close();
        });
        passThrough.on('error', (err) => {
          controller.error(err);
        });
      },
    });

    // Generate filename with date
    const dateStr = new Date().toISOString().slice(0, 10);
    const zipFilename = `passed-candidates-${dateStr}.zip`;

    return new Response(readableStream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zipFilename}"`,
      },
    });
  } catch (error) {
    console.error('[bulk-download] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Download failed' },
      { status: 500 }
    );
  }
}
