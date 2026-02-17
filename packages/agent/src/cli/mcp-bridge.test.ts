import { describe, expect, it } from 'vitest';

// Test the SSE parsing logic (extracted for testability)
function parseSseEvents(text: string): string[] {
  const payloads: string[] = [];
  let currentData = '';
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      currentData += line.slice(6);
    } else if (line === '' && currentData) {
      payloads.push(currentData);
      currentData = '';
    }
  }
  if (currentData) {
    payloads.push(currentData);
  }
  return payloads;
}

describe('parseSseEvents', () => {
  it('parses a single event', () => {
    const text = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{}}\n\n';
    const events = parseSseEvents(text);
    expect(events).toEqual(['{"jsonrpc":"2.0","id":1,"result":{}}']);
  });

  it('parses multiple events', () => {
    const text = [
      'event: message',
      'data: {"jsonrpc":"2.0","id":1,"result":{"tools":[]}}',
      '',
      'event: message',
      'data: {"jsonrpc":"2.0","method":"notifications/tools/list_changed"}',
      '',
    ].join('\n');
    const events = parseSseEvents(text);
    expect(events).toHaveLength(2);
    expect(JSON.parse(events[0]!)).toHaveProperty('id', 1);
    expect(JSON.parse(events[1]!)).toHaveProperty('method', 'notifications/tools/list_changed');
  });

  it('handles data without trailing blank line', () => {
    const text = 'data: {"jsonrpc":"2.0","id":2,"result":{}}';
    const events = parseSseEvents(text);
    expect(events).toEqual(['{"jsonrpc":"2.0","id":2,"result":{}}']);
  });

  it('handles empty input', () => {
    expect(parseSseEvents('')).toEqual([]);
  });

  it('ignores non-data lines', () => {
    const text = 'event: message\nid: 123\ndata: {"ok":true}\n\n';
    const events = parseSseEvents(text);
    expect(events).toEqual(['{"ok":true}']);
  });
});
