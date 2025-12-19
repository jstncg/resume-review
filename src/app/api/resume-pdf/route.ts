import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

function resumesDir() {
  return path.resolve(process.cwd(), "dataset", "sentra_test_resumes");
}

function isSafeFilename(filename: string) {
  if (!filename) return false;
  if (filename.includes("/") || filename.includes("\\")) return false;
  if (filename.includes("..")) return false;
  if (path.extname(filename).toLowerCase() !== ".pdf") return false;
  return true;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const filename = url.searchParams.get("filename") || "";
  const download = url.searchParams.get("download") === "1";

  if (!isSafeFilename(filename)) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  const absPath = path.join(resumesDir(), filename);

  let buf: Buffer;
  try {
    buf = await fs.readFile(absPath);
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  // `Response` expects a web `BodyInit`. Convert Buffer -> Uint8Array for TS.
  const body = new Uint8Array(buf);
  return new Response(body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}


