/**
 * Stage Mappings Configuration
 * 
 * Stores the mapping between UI actions and Ashby interview stages.
 * Persisted to dataset/stage_mappings.json
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

const DEFAULT_MAPPINGS_PATH = path.join(process.cwd(), 'dataset', 'stage_mappings.json');

export type StageMapping = {
  stageId: string;
  stageName: string;
};

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

/**
 * Load stage mappings from disk.
 */
export async function loadStageMappings(
  filePath: string = DEFAULT_MAPPINGS_PATH
): Promise<StageMappingConfig> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as StageMappingConfig;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Save stage mappings to disk atomically.
 */
export async function saveStageMappings(
  config: StageMappingConfig,
  filePath: string = DEFAULT_MAPPINGS_PATH
): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  
  const tmpPath = `${filePath}.tmp`;
  const data = { ...config, lastUpdated: new Date().toISOString() };
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmpPath, filePath);
}

