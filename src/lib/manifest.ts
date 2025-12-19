import { promises as fs } from "node:fs";
import path from "node:path";

export type ManifestLabels = Map<string, string>;

function defaultManifestPath() {
  return path.resolve(process.cwd(), "dataset", "manifest.csv");
}

export async function readManifestLabels(
  manifestPath: string = process.env.MANIFEST_PATH || defaultManifestPath()
): Promise<ManifestLabels> {
  let raw: string;
  try {
    raw = await fs.readFile(manifestPath, "utf8");
  } catch {
    return new Map();
  }

  const labels = new Map<string, string>();
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return labels;

  // Expect header: filename,label
  const startIdx = lines[0].toLowerCase().startsWith("filename,") ? 1 : 0;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    const comma = line.indexOf(",");
    if (comma === -1) continue;
    const filename = line.slice(0, comma).trim();
    const label = line.slice(comma + 1).trim();
    if (!filename || !label) continue;
    labels.set(filename, label);
  }

  return labels;
}


