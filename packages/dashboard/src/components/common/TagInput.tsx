import { type KeyboardEvent, useState } from 'react';
import { getTagColor } from '../../lib/tag-colors';

interface TagInputProps {
  tags: string[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
}

export function TagInput({ tags, onAdd, onRemove }: TagInputProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && value.trim()) {
      e.preventDefault();
      e.stopPropagation();
      onAdd(value.trim());
      setValue('');
      setEditing(false);
    }
    if (e.key === 'Escape') {
      setValue('');
      setEditing(false);
    }
  };

  return (
    <div
      className="flex flex-wrap items-center gap-1"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {tags.map((tag) => {
        const color = getTagColor(tag);
        return (
        <span
          key={tag}
          className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs"
          style={{ backgroundColor: color.bg, color: color.text }}
        >
          {tag}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(tag);
            }}
            className="ml-0.5 text-gray-500 hover:text-gray-200"
          >
            &times;
          </button>
        </span>
        );
      })}
      {editing ? (
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (value.trim()) {
              onAdd(value.trim());
            }
            setValue('');
            setEditing(false);
          }}
          placeholder="tag"
          autoFocus
          className="w-16 rounded border border-gray-700 bg-gray-800 px-1 py-0.5 text-xs text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
          className="rounded bg-gray-800 px-1 py-0.5 text-xs text-gray-500 hover:text-gray-300"
        >
          +
        </button>
      )}
    </div>
  );
}
