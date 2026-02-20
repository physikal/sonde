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
      className="flex flex-wrap items-center gap-1.5"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {tags.map((tag) => {
        const color = getTagColor(tag);
        return (
        <span
          key={tag}
          className="inline-flex items-center rounded-md text-sm font-medium leading-none"
          style={{ backgroundColor: color.deleteBg, color: color.text }}
        >
          <span className="py-1.5 pl-2.5 pr-2">{tag}</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(tag);
            }}
            className="flex items-center rounded-r-md py-1.5 pr-2 pl-1.5 opacity-60 hover:opacity-100"
            style={{ backgroundColor: color.bg, color: color.text }}
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
          className="w-20 rounded-md border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-gray-800 text-sm font-medium text-gray-500 hover:bg-gray-700 hover:text-gray-300"
        >
          +
        </button>
      )}
    </div>
  );
}
