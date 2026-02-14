import { describe, expect, it } from 'vitest';
import type { ExecFn } from '../../types.js';
import type { ImagesListResult } from './images-list.js';
import { imagesList, parseImagesList } from './images-list.js';

const SAMPLE_OUTPUT = `{"Containers":"N/A","CreatedAt":"2024-01-10 08:00:00 +0000 UTC","CreatedSince":"5 days ago","Digest":"\u003cnone\u003e","ID":"sha256:abc123","Repository":"nginx","SharedSize":"N/A","Size":"187MB","Tag":"latest","UniqueSize":"N/A","VirtualSize":"187MB"}
{"Containers":"N/A","CreatedAt":"2024-01-08 12:00:00 +0000 UTC","CreatedSince":"7 days ago","Digest":"\u003cnone\u003e","ID":"sha256:def456","Repository":"postgres","SharedSize":"N/A","Size":"432MB","Tag":"16","UniqueSize":"N/A","VirtualSize":"432MB"}`;

describe('parseImagesList', () => {
  it('parses docker images JSON output into structured data', () => {
    const result = parseImagesList(SAMPLE_OUTPUT);

    expect(result.images).toHaveLength(2);
    expect(result.images[0]).toEqual({
      id: 'sha256:abc123',
      repository: 'nginx',
      tag: 'latest',
      size: '187MB',
      created: '5 days ago',
    });
    expect(result.images[1]).toEqual({
      id: 'sha256:def456',
      repository: 'postgres',
      tag: '16',
      size: '432MB',
      created: '7 days ago',
    });
  });

  it('returns empty array for empty output', () => {
    const result = parseImagesList('');
    expect(result.images).toHaveLength(0);
  });
});

describe('imagesList handler', () => {
  it('calls docker images with correct args and returns parsed result', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('docker');
      expect(args).toEqual(['images', '--format', 'json']);
      return SAMPLE_OUTPUT;
    };

    const result = (await imagesList(undefined, mockExec)) as ImagesListResult;
    expect(result.images).toHaveLength(2);
    expect(result.images[0]?.repository).toBe('nginx');
  });
});
