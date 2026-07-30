import { describe, expect, it } from 'vitest';
import type { QueueEntry } from './types';
import { QueueProtocolError, QueueReplica } from './queue_protocol';

const entry = (id: string): QueueEntry => ({
  entry_id: id,
  track_ref: `ncm:${id}`,
  title: id,
  artist: 'Artist',
  duration_ms: 1000,
  requested_by: 'guest',
  added_at: 1,
});

describe('QueueReplica', () => {
  it('atomically commits a multi-part snapshot', () => {
    const replica = new QueueReplica();
    expect(replica.acceptSnapshot({ revision: 4, part: 0, items: [entry('a')], done: false })).toBe(false);
    expect(replica.state).toMatchObject({ revision: null, items: [], ready: false });
    expect(replica.acceptSnapshot({ revision: 4, part: 1, items: [entry('b')], done: true })).toBe(true);
    expect(replica.state).toMatchObject({ revision: 4, items: [entry('a'), entry('b')], ready: true });
  });

  it('applies ordered patch operations as one atomic commit', () => {
    const replica = new QueueReplica();
    replica.acceptSnapshot({ revision: 10, part: 0, items: [entry('a'), entry('b')], done: true });
    expect(
      replica.acceptPatch({
        base_revision: 10,
        revision: 11,
        part: 0,
        ops: [
          { op: 'add', index: 1, item: entry('c') },
          { op: 'move', entry_id: 'a', to_index: 2 },
          { op: 'remove', entry_id: 'b' },
        ],
        done: true,
      }),
    ).toBe(true);
    expect(replica.state.items.map((item) => item.entry_id)).toEqual(['c', 'a']);
  });

  it('rejects a revision mismatch without changing committed state', () => {
    const replica = new QueueReplica();
    replica.acceptSnapshot({ revision: 2, part: 0, items: [entry('a')], done: true });
    expect(() =>
      replica.acceptPatch({
        base_revision: 1,
        revision: 2,
        part: 0,
        ops: [{ op: 'clear' }],
        done: true,
      }),
    ).toThrow(QueueProtocolError);
    expect(replica.state.items.map((item) => item.entry_id)).toEqual(['a']);
  });

  it('holds a patch until the replacement snapshot is complete', () => {
    const replica = new QueueReplica();
    replica.acceptSnapshot({ revision: 1, part: 0, items: [entry('a')], done: true });
    replica.acceptSnapshot({ revision: 2, part: 0, items: [entry('a')], done: false });
    expect(
      replica.acceptPatch({
        base_revision: 2,
        revision: 3,
        part: 0,
        ops: [{ op: 'add', index: 1, item: entry('b') }],
        done: true,
      }),
    ).toBe(false);
    replica.acceptSnapshot({ revision: 2, part: 1, items: [], done: true });
    expect(replica.state).toMatchObject({ revision: 3, ready: true });
    expect(replica.state.items.map((item) => item.entry_id)).toEqual(['a', 'b']);
  });
});
