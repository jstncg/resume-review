import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { resumeWatcher } from "@/lib/resumeWatcher";

export const runtime = "nodejs";

function isPdf(name: string) {
  return path.extname(name).toLowerCase() === ".pdf";
}

function toPosixPath(p: string) {
  return p.split(path.sep).join("/");
}

export async function GET() {
  const dir = resumeWatcher.getWatchDir();
  const names = await fs.readdir(dir);
  const pdfs = names.filter(isPdf).sort((a, b) => a.localeCompare(b));
  return NextResponse.json({
    dir,
    files: pdfs.map((n) =>
      toPosixPath(path.join(path.relative(process.cwd(), dir), n))
    ),
  });
}


