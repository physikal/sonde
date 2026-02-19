interface TagColor {
  bg: string;
  text: string;
}

const PALETTE: TagColor[] = [
  { bg: 'rgba(59, 130, 246, 0.15)', text: '#93bbfd' },   // blue
  { bg: 'rgba(16, 185, 129, 0.15)', text: '#6ee7b7' },   // emerald
  { bg: 'rgba(245, 158, 11, 0.15)', text: '#fcd34d' },    // amber
  { bg: 'rgba(239, 68, 68, 0.15)', text: '#fca5a5' },     // red
  { bg: 'rgba(139, 92, 246, 0.15)', text: '#c4b5fd' },    // violet
  { bg: 'rgba(236, 72, 153, 0.15)', text: '#f9a8d4' },    // pink
  { bg: 'rgba(6, 182, 212, 0.15)', text: '#67e8f9' },     // cyan
  { bg: 'rgba(249, 115, 22, 0.15)', text: '#fdba74' },    // orange
  { bg: 'rgba(132, 204, 22, 0.15)', text: '#bef264' },    // lime
  { bg: 'rgba(168, 85, 247, 0.15)', text: '#d8b4fe' },    // purple
  { bg: 'rgba(20, 184, 166, 0.15)', text: '#5eead4' },    // teal
  { bg: 'rgba(244, 63, 94, 0.15)', text: '#fda4af' },     // rose
  { bg: 'rgba(99, 102, 241, 0.15)', text: '#a5b4fc' },    // indigo
  { bg: 'rgba(234, 179, 8, 0.15)', text: '#fde047' },     // yellow
  { bg: 'rgba(14, 165, 233, 0.15)', text: '#7dd3fc' },    // sky
  { bg: 'rgba(217, 70, 239, 0.15)', text: '#f0abfc' },    // fuchsia
];

/** DJB2 hash of a string, returning a positive integer. */
function djb2(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return hash >>> 0;
}

/** Returns a deterministic bg/text color pair for a tag string. */
export function getTagColor(tag: string): TagColor {
  return PALETTE[djb2(tag) % PALETTE.length];
}
