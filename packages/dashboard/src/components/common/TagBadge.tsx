import { getTagColor } from '../../lib/tag-colors';

export function TagBadge({ tag }: { tag: string }) {
  const color = getTagColor(tag);

  return (
    <span
      className="inline-flex items-center rounded-md px-2.5 py-1.5 text-sm font-medium leading-none"
      style={{ backgroundColor: color.deleteBg, color: color.text }}
    >
      {tag}
    </span>
  );
}
