interface TagColor {
  bg: string;
  text: string;
  deleteBg: string;
}

const PALETTE: TagColor[] = [
  { bg: 'rgba(59, 130, 246, 0.15)', text: '#93bbfd', deleteBg: 'rgba(59, 130, 246, 0.3)' },   // blue
  { bg: 'rgba(16, 185, 129, 0.15)', text: '#6ee7b7', deleteBg: 'rgba(16, 185, 129, 0.3)' },   // emerald
  { bg: 'rgba(245, 158, 11, 0.15)', text: '#fcd34d', deleteBg: 'rgba(245, 158, 11, 0.3)' },    // amber
  { bg: 'rgba(239, 68, 68, 0.15)', text: '#fca5a5', deleteBg: 'rgba(239, 68, 68, 0.3)' },     // red
  { bg: 'rgba(139, 92, 246, 0.15)', text: '#c4b5fd', deleteBg: 'rgba(139, 92, 246, 0.3)' },    // violet
  { bg: 'rgba(236, 72, 153, 0.15)', text: '#f9a8d4', deleteBg: 'rgba(236, 72, 153, 0.3)' },    // pink
  { bg: 'rgba(6, 182, 212, 0.15)', text: '#67e8f9', deleteBg: 'rgba(6, 182, 212, 0.3)' },     // cyan
  { bg: 'rgba(249, 115, 22, 0.15)', text: '#fdba74', deleteBg: 'rgba(249, 115, 22, 0.3)' },    // orange
  { bg: 'rgba(132, 204, 22, 0.15)', text: '#bef264', deleteBg: 'rgba(132, 204, 22, 0.3)' },    // lime
  { bg: 'rgba(168, 85, 247, 0.15)', text: '#d8b4fe', deleteBg: 'rgba(168, 85, 247, 0.3)' },    // purple
  { bg: 'rgba(20, 184, 166, 0.15)', text: '#5eead4', deleteBg: 'rgba(20, 184, 166, 0.3)' },    // teal
  { bg: 'rgba(244, 63, 94, 0.15)', text: '#fda4af', deleteBg: 'rgba(244, 63, 94, 0.3)' },     // rose
  { bg: 'rgba(99, 102, 241, 0.15)', text: '#a5b4fc', deleteBg: 'rgba(99, 102, 241, 0.3)' },    // indigo
  { bg: 'rgba(234, 179, 8, 0.15)', text: '#fde047', deleteBg: 'rgba(234, 179, 8, 0.3)' },     // yellow
  { bg: 'rgba(14, 165, 233, 0.15)', text: '#7dd3fc', deleteBg: 'rgba(14, 165, 233, 0.3)' },    // sky
  { bg: 'rgba(217, 70, 239, 0.15)', text: '#f0abfc', deleteBg: 'rgba(217, 70, 239, 0.3)' },    // fuchsia
];

/** DJB2 hash of a string, returning a positive integer. */
function djb2(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return hash >>> 0;
}

/** Returns a deterministic bg/text/deleteBg color triple for a tag string. */
export function getTagColor(tag: string): TagColor {
  return PALETTE[djb2(tag) % PALETTE.length]!;
}
