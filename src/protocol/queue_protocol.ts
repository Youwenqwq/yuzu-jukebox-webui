import type { QueueEntry } from './types';

export interface QueueSnapshotPart {
  revision: number;
  part: number;
  items: QueueEntry[];
  done: boolean;
}

export type QueuePatchOp =
  | { op: 'add'; index: number; item: QueueEntry }
  | { op: 'remove'; entry_id: string }
  | { op: 'move'; entry_id: string; to_index: number }
  | { op: 'clear' };

export interface QueuePatchPart {
  base_revision: number;
  revision: number;
  part: number;
  ops: QueuePatchOp[];
  done: boolean;
}

export interface QueueReplicaState {
  revision: number | null;
  items: QueueEntry[];
  ready: boolean;
  resyncRequired: boolean;
}

export class QueueProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueueProtocolError';
  }
}

interface SnapshotAssembly {
  revision: number;
  nextPart: number;
  items: QueueEntry[];
}

interface PatchAssembly {
  baseRevision: number;
  revision: number;
  nextPart: number;
  ops: QueuePatchOp[];
}

interface CompletedPatch {
  baseRevision: number;
  revision: number;
  ops: QueuePatchOp[];
}

function cloneEntry(entry: QueueEntry): QueueEntry {
  return {
    ...entry,
    contributors: entry.contributors?.map((contributor) => ({ ...contributor })),
  };
}

function cloneEntries(items: QueueEntry[]): QueueEntry[] {
  return items.map(cloneEntry);
}

function entryIndex(items: QueueEntry[], entryId: string): number {
  if (!entryId) return -1;
  return items.findIndex((entry) => entry.entry_id === entryId);
}

function applyPatch(items: QueueEntry[], ops: QueuePatchOp[]): QueueEntry[] {
  const next = cloneEntries(items);
  for (const op of ops) {
    switch (op.op) {
      case 'add': {
        if (op.index < 0 || op.index > next.length || !op.item.entry_id) {
          throw new QueueProtocolError('invalid queue add operation');
        }
        if (entryIndex(next, op.item.entry_id) >= 0) {
          throw new QueueProtocolError('duplicate queue entry');
        }
        next.splice(op.index, 0, cloneEntry(op.item));
        break;
      }
      case 'remove': {
        const index = entryIndex(next, op.entry_id);
        if (index < 0) throw new QueueProtocolError('queue entry not found');
        next.splice(index, 1);
        break;
      }
      case 'move': {
        const index = entryIndex(next, op.entry_id);
        if (index < 0 || op.to_index < 0 || op.to_index >= next.length) {
          throw new QueueProtocolError('invalid queue move operation');
        }
        const [entry] = next.splice(index, 1);
        next.splice(op.to_index, 0, entry);
        break;
      }
      case 'clear':
        next.length = 0;
        break;
      default:
        throw new QueueProtocolError('unknown queue patch operation');
    }
  }
  return next;
}

/** Maintains the atomically committed revisioned queue replica. */
export class QueueReplica {
  private revisionValue: number | null = null;
  private itemsValue: QueueEntry[] = [];
  private readyValue = false;
  private resyncRequiredValue = false;
  private snapshot: SnapshotAssembly | null = null;
  private patch: PatchAssembly | null = null;
  private readonly pendingPatches: CompletedPatch[] = [];

  get state(): QueueReplicaState {
    return {
      revision: this.revisionValue,
      items: cloneEntries(this.itemsValue),
      ready: this.readyValue,
      resyncRequired: this.resyncRequiredValue,
    };
  }

  reset(): void {
    this.revisionValue = null;
    this.itemsValue = [];
    this.readyValue = false;
    this.clearAssemblies();
  }

  beginJoin(): void {
    this.clearAssemblies();
  }

  acceptSnapshot(part: QueueSnapshotPart): boolean {
    this.validatePart(part.part, part.revision);
    if (part.part === 0) {
      this.snapshot = { revision: part.revision, nextPart: 0, items: [] };
      this.patch = null;
      this.pendingPatches.length = 0;
    }

    const assembly = this.snapshot;
    if (
      assembly === null ||
      assembly.revision !== part.revision ||
      assembly.nextPart !== part.part
    ) {
      throw new QueueProtocolError('invalid queue snapshot part sequence');
    }
    assembly.items.push(...part.items.map(cloneEntry));
    assembly.nextPart += 1;
    if (!part.done) return false;

    let nextItems = cloneEntries(assembly.items);
    let nextRevision = assembly.revision;
    for (const pending of this.pendingPatches) {
      if (pending.baseRevision !== nextRevision || pending.revision !== nextRevision + 1) {
        throw new QueueProtocolError('queue patch revision mismatch');
      }
      nextItems = applyPatch(nextItems, pending.ops);
      nextRevision = pending.revision;
    }

    this.itemsValue = nextItems;
    this.revisionValue = nextRevision;
    this.readyValue = true;
    this.resyncRequiredValue = false;
    this.clearAssemblies();
    return true;
  }

  acceptPatch(part: QueuePatchPart): boolean {
    this.validatePart(part.part, part.revision);
    if (part.revision !== part.base_revision + 1) {
      throw new QueueProtocolError('invalid queue patch revision');
    }
    if (part.part === 0) {
      this.patch = {
        baseRevision: part.base_revision,
        revision: part.revision,
        nextPart: 0,
        ops: [],
      };
    }

    const assembly = this.patch;
    if (
      assembly === null ||
      assembly.baseRevision !== part.base_revision ||
      assembly.revision !== part.revision ||
      assembly.nextPart !== part.part
    ) {
      throw new QueueProtocolError('invalid queue patch part sequence');
    }
    assembly.ops.push(...part.ops);
    assembly.nextPart += 1;
    if (!part.done) return false;

    const completed: CompletedPatch = {
      baseRevision: assembly.baseRevision,
      revision: assembly.revision,
      ops: [...assembly.ops],
    };
    this.patch = null;
    if (this.snapshot !== null || !this.readyValue) {
      this.pendingPatches.push(completed);
      return false;
    }
    this.commitPatch(completed);
    return true;
  }

  markResyncRequired(): void {
    this.resyncRequiredValue = true;
    this.clearAssemblies();
  }

  private commitPatch(patch: CompletedPatch): void {
    if (
      this.revisionValue === null ||
      patch.baseRevision !== this.revisionValue ||
      patch.revision !== patch.baseRevision + 1
    ) {
      throw new QueueProtocolError('queue patch does not continue local revision');
    }
    const nextItems = applyPatch(this.itemsValue, patch.ops);
    this.itemsValue = nextItems;
    this.revisionValue = patch.revision;
    this.readyValue = true;
    this.resyncRequiredValue = false;
  }

  private validatePart(part: number, revision: number): void {
    if (!Number.isInteger(part) || part < 0 || !Number.isSafeInteger(revision) || revision < 0) {
      throw new QueueProtocolError('invalid queue part');
    }
  }

  private clearAssemblies(): void {
    this.snapshot = null;
    this.patch = null;
    this.pendingPatches.length = 0;
  }
}
