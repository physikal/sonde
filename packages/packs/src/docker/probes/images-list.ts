import type { ProbeHandler } from '../../types.js';

export interface ImageInfo {
  id: string;
  repository: string;
  tag: string;
  size: string;
  created: string;
}

export interface ImagesListResult {
  images: ImageInfo[];
}

/**
 * Runs `docker images --format json` and parses each JSON line.
 */
export const imagesList: ProbeHandler = async (_params, exec) => {
  const stdout = await exec('docker', ['images', '--format', 'json']);
  return parseImagesList(stdout);
};

export function parseImagesList(stdout: string): ImagesListResult {
  const lines = stdout.trim().split('\n').filter(Boolean);
  const images: ImageInfo[] = [];

  for (const line of lines) {
    const raw = JSON.parse(line);
    images.push({
      id: raw.ID ?? '',
      repository: raw.Repository ?? '',
      tag: raw.Tag ?? '',
      size: raw.Size ?? '',
      created: raw.CreatedSince ?? raw.CreatedAt ?? '',
    });
  }

  return { images };
}
