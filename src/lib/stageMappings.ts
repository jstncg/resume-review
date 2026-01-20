/**
 * Stage Mappings Configuration
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

const MAPPINGS_PATH = path.join(process.cwd(), 'dataset', 'stage_mappings.json');

export type StageMapping = { stageId: string; stageName: string };

export type StageMappingConfig = {
  version: number;
  lastUpdated: string;
  jobId: string | null;
  mappings: {
    userReviewed?: StageMapping;
    archived?: StageMapping;
  };
};

const DEFAULT_CONFIG: StageMappingConfig = {
  version: 1,
  lastUpdated: new Date().toISOString(),
  jobId: null,
  mappings: {},
};

export async function loadStageMappings(filePath = MAPPINGS_PATH): Promise<StageMappingConfig> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as StageMappingConfig;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveStageMappings(config: StageMappingConfig, filePath = MAPPINGS_PATH): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  const data = { ...config, lastUpdated: new Date().toISOString() };
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmpPath, filePath);
}
