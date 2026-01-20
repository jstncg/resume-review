import { NextResponse } from 'next/server';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { readBulkManifestLabels, readBulkCandidateNames } from '@/lib/bulkManifest';
import { STATUS_PERFECT, STATUS_VERY_GOOD, STATUS_GOOD_FIT, PASSING_STATUSES } from '@/lib/labels';

export const runtime = 'nodejs';

type CandidateEntry = {
  filename: string;
  name: string;
  label: string;
};

export async function GET() {
  try {
    const labels = await readBulkManifestLabels();
    const candidateNames = await readBulkCandidateNames();

    // Collect all passing candidates with their names
    const perfect: CandidateEntry[] = [];
    const veryGood: CandidateEntry[] = [];
    const passed: CandidateEntry[] = [];

    for (const [filename, label] of labels) {
      if (!PASSING_STATUSES.includes(label as typeof PASSING_STATUSES[number])) {
        continue;
      }

      const name = candidateNames.get(filename) || 'Unknown';
      const entry = { filename, name, label };

      if (label === STATUS_PERFECT) {
        perfect.push(entry);
      } else if (label === STATUS_VERY_GOOD) {
        veryGood.push(entry);
      } else if (label === STATUS_GOOD_FIT) {
        passed.push(entry);
      }
    }

    const totalPassed = perfect.length + veryGood.length + passed.length;

    if (totalPassed === 0) {
      return NextResponse.json({ error: 'No passed candidates to export' }, { status: 400 });
    }

    // Sort each tier alphabetically by name
    const sortByName = (a: CandidateEntry, b: CandidateEntry) => a.name.localeCompare(b.name);
    perfect.sort(sortByName);
    veryGood.sort(sortByName);
    passed.sort(sortByName);

    // Create PDF document
    const pdfDoc = await PDFDocument.create();
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const pageWidth = 612; // Letter size
    const pageHeight = 792;
    const margin = 50;
    const lineHeight = 18;

    let page = pdfDoc.addPage([pageWidth, pageHeight]);
    let y = pageHeight - margin;

    // Helper to add a new page if needed
    const ensureSpace = (needed: number) => {
      if (y - needed < margin) {
        page = pdfDoc.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
      }
    };

    // Title
    const dateStr = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    page.drawText('Passed Candidates', {
      x: margin,
      y,
      size: 24,
      font: helveticaBold,
      color: rgb(0, 0, 0),
    });
    y -= 30;

    page.drawText(dateStr, {
      x: margin,
      y,
      size: 12,
      font: helvetica,
      color: rgb(0.4, 0.4, 0.4),
    });
    y -= 20;

    page.drawText(`Total: ${totalPassed} candidates`, {
      x: margin,
      y,
      size: 11,
      font: helvetica,
      color: rgb(0.4, 0.4, 0.4),
    });
    y -= 40;

    // Helper function to render a tier section
    const renderTier = (
      title: string,
      emoji: string,
      entries: CandidateEntry[],
      color: { r: number; g: number; b: number }
    ) => {
      if (entries.length === 0) return;

      ensureSpace(60);

      // Section header
      const headerText = emoji ? `${emoji} ${title} (${entries.length})` : `${title} (${entries.length})`;
      page.drawText(headerText, {
        x: margin,
        y,
        size: 16,
        font: helveticaBold,
        color: rgb(color.r, color.g, color.b),
      });
      y -= 8;

      // Draw colored line
      page.drawLine({
        start: { x: margin, y },
        end: { x: pageWidth - margin, y },
        thickness: 2,
        color: rgb(color.r, color.g, color.b),
      });
      y -= 20;

      // List names
      let count = 0;
      for (const entry of entries) {
        ensureSpace(lineHeight);
        count++;
        const displayName = entry.name !== 'Unknown' ? entry.name : `[${entry.filename}]`;

        page.drawText(`${count}. ${displayName}`, {
          x: margin + 10,
          y,
          size: 11,
          font: helvetica,
          color: rgb(0.2, 0.2, 0.2),
        });
        y -= lineHeight;
      }

      y -= 20; // Space after section
    };

    // Render each tier with colors (using ASCII-compatible labels)
    renderTier('PERFECT', '', perfect, { r: 0.58, g: 0.2, b: 0.92 }); // Purple
    renderTier('VERY GOOD', '', veryGood, { r: 0.15, g: 0.39, b: 0.92 }); // Blue
    renderTier('PASSED', '', passed, { r: 0.02, g: 0.59, b: 0.41 }); // Green

    // Generate PDF bytes
    const pdfBytes = await pdfDoc.save();

    const pdfFilename = `passed-candidates-${new Date().toISOString().slice(0, 10)}.pdf`;

    return new Response(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${pdfFilename}"`,
      },
    });
  } catch (error) {
    console.error('[bulk-names-pdf] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'PDF generation failed' },
      { status: 500 }
    );
  }
}
