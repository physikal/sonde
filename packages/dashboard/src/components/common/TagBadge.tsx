import { getTagColor } from '../../lib/tag-colors';

export function TagBadge({ tag }: { tag: string }) {
  const color = getTagColor(tag);

  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-xs"
      style={{ backgroundColor: color.bg, color: color.text }}
    >
      {tag}
    </span>
  );
}
