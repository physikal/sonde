import { getTagColor } from '../../lib/tag-colors';

export function TagBadge({ tag }: { tag: string }) {
  const color = getTagColor(tag);

  return (
    <span
      className="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium leading-none"
      style={{ backgroundColor: color.bg, color: color.text }}
    >
      {tag}
    </span>
  );
}
