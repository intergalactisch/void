import type { SyncConflictHunk } from './Sync';

export interface Diff3MergeResult {
  clean: boolean;
  mergedText: string;
  hunks: SyncConflictHunk[];
}

interface ChangeRange {
  baseStart: number;
  baseEnd: number;
  replacement: string[];
}

const MAX_LCS_CELLS = 4_000_000;

export function mergeText3(base: string, local: string, remote: string): Diff3MergeResult {
  if (local === remote) {
    return { clean: true, mergedText: local, hunks: [] };
  }
  if (base === local) {
    return { clean: true, mergedText: remote, hunks: [] };
  }
  if (base === remote) {
    return { clean: true, mergedText: local, hunks: [] };
  }

  const baseLines = splitLines(base);
  const localChanges = changedRanges(baseLines, splitLines(local));
  const remoteChanges = changedRanges(baseLines, splitLines(remote));
  if (!localChanges || !remoteChanges) {
    return unresolvedWholeFile(base, local, remote, 'diff3-size-limit');
  }

  const merged: string[] = [];
  const hunks: SyncConflictHunk[] = [];
  let cursor = 0;
  let localIndex = 0;
  let remoteIndex = 0;

  while (localIndex < localChanges.length || remoteIndex < remoteChanges.length) {
    const localChange = localChanges[localIndex] ?? null;
    const remoteChange = remoteChanges[remoteIndex] ?? null;

    if (localChange && (!remoteChange || localChange.baseStart < remoteChange.baseStart)) {
      if (!remoteChange || !rangesInteract(localChange, remoteChange)) {
        merged.push(...baseLines.slice(cursor, localChange.baseStart), ...localChange.replacement);
        cursor = localChange.baseEnd;
        localIndex += 1;
        continue;
      }
    }

    if (remoteChange && (!localChange || remoteChange.baseStart < localChange.baseStart)) {
      if (!localChange || !rangesInteract(localChange, remoteChange)) {
        merged.push(...baseLines.slice(cursor, remoteChange.baseStart), ...remoteChange.replacement);
        cursor = remoteChange.baseEnd;
        remoteIndex += 1;
        continue;
      }
    }

    if (!localChange || !remoteChange) break;

    let groupStart = Math.min(localChange.baseStart, remoteChange.baseStart);
    let groupEnd = Math.max(localChange.baseEnd, remoteChange.baseEnd);
    const localGroup: ChangeRange[] = [];
    const remoteGroup: ChangeRange[] = [];

    let expanded = true;
    while (expanded) {
      expanded = false;
      while (
        localIndex < localChanges.length &&
        rangeTouchesGroup(localChanges[localIndex]!, groupStart, groupEnd)
      ) {
        const change = localChanges[localIndex]!;
        localGroup.push(change);
        groupStart = Math.min(groupStart, change.baseStart);
        groupEnd = Math.max(groupEnd, change.baseEnd);
        localIndex += 1;
        expanded = true;
      }
      while (
        remoteIndex < remoteChanges.length &&
        rangeTouchesGroup(remoteChanges[remoteIndex]!, groupStart, groupEnd)
      ) {
        const change = remoteChanges[remoteIndex]!;
        remoteGroup.push(change);
        groupStart = Math.min(groupStart, change.baseStart);
        groupEnd = Math.max(groupEnd, change.baseEnd);
        remoteIndex += 1;
        expanded = true;
      }
    }

    merged.push(...baseLines.slice(cursor, groupStart));
    const baseText = baseLines.slice(groupStart, groupEnd).join('');
    const localText = applyChangesToSlice(baseLines, groupStart, groupEnd, localGroup);
    const remoteText = applyChangesToSlice(baseLines, groupStart, groupEnd, remoteGroup);
    if (localText === remoteText) {
      merged.push(localText);
    } else {
      const hunk: SyncConflictHunk = {
        id: `hunk-${hunks.length + 1}`,
        base: baseText,
        local: localText,
        remote: remoteText,
        merged: conflictMarkerText(baseText, localText, remoteText),
      };
      hunks.push(hunk);
      merged.push(hunk.merged);
    }
    cursor = groupEnd;
  }

  merged.push(...baseLines.slice(cursor));
  return {
    clean: hunks.length === 0,
    mergedText: merged.join(''),
    hunks,
  };
}

function splitLines(text: string): string[] {
  const parts = text.split('\n');
  return parts.map((part, index) => index < parts.length - 1 ? `${part}\n` : part);
}

function changedRanges(base: string[], other: string[]): ChangeRange[] | null {
  let prefix = 0;
  while (prefix < base.length && prefix < other.length && base[prefix] === other[prefix]) {
    prefix += 1;
  }

  let baseSuffix = base.length;
  let otherSuffix = other.length;
  while (baseSuffix > prefix && otherSuffix > prefix && base[baseSuffix - 1] === other[otherSuffix - 1]) {
    baseSuffix -= 1;
    otherSuffix -= 1;
  }

  const baseMiddle = base.slice(prefix, baseSuffix);
  const otherMiddle = other.slice(prefix, otherSuffix);
  if (baseMiddle.length * otherMiddle.length > MAX_LCS_CELLS) {
    return null;
  }

  const table = lcsTable(baseMiddle, otherMiddle);
  const changes: ChangeRange[] = [];
  let i = 0;
  let j = 0;
  let pending: ChangeRange | null = null;

  const ensurePending = () => {
    if (!pending) {
      pending = { baseStart: prefix + i, baseEnd: prefix + i, replacement: [] };
    }
  };
  const flush = () => {
    if (pending && (pending.baseStart !== pending.baseEnd || pending.replacement.length > 0)) {
      changes.push(pending);
    }
    pending = null;
  };

  while (i < baseMiddle.length || j < otherMiddle.length) {
    if (i < baseMiddle.length && j < otherMiddle.length && baseMiddle[i] === otherMiddle[j]) {
      flush();
      i += 1;
      j += 1;
      continue;
    }
    if (j < otherMiddle.length && (i === baseMiddle.length || table[i]![j + 1]! >= table[i + 1]![j]!)) {
      ensurePending();
      pending!.replacement.push(otherMiddle[j]!);
      j += 1;
      continue;
    }
    if (i < baseMiddle.length) {
      ensurePending();
      pending!.baseEnd = prefix + i + 1;
      i += 1;
    }
  }
  flush();
  return changes;
}

function lcsTable(left: string[], right: string[]): number[][] {
  const table = Array.from({ length: left.length + 1 }, () => new Array<number>(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i]![j] = left[i] === right[j]
        ? table[i + 1]![j + 1]! + 1
        : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  return table;
}

function rangesInteract(left: ChangeRange, right: ChangeRange): boolean {
  if (left.baseStart === left.baseEnd && right.baseStart === right.baseEnd) {
    return left.baseStart === right.baseStart;
  }
  return left.baseStart < right.baseEnd && right.baseStart < left.baseEnd;
}

function rangeTouchesGroup(range: ChangeRange, groupStart: number, groupEnd: number): boolean {
  if (groupStart === groupEnd) {
    return range.baseStart === groupStart;
  }
  if (range.baseStart === range.baseEnd) {
    return range.baseStart >= groupStart && range.baseStart <= groupEnd;
  }
  return range.baseStart < groupEnd && groupStart < range.baseEnd;
}

function applyChangesToSlice(
  base: string[],
  sliceStart: number,
  sliceEnd: number,
  changes: ChangeRange[],
): string {
  const ordered = changes.slice().sort((a, b) => a.baseStart - b.baseStart || a.baseEnd - b.baseEnd);
  const out: string[] = [];
  let cursor = sliceStart;
  for (const change of ordered) {
    out.push(...base.slice(cursor, change.baseStart), ...change.replacement);
    cursor = change.baseEnd;
  }
  out.push(...base.slice(cursor, sliceEnd));
  return out.join('');
}

function conflictMarkerText(base: string, local: string, remote: string): string {
  return [
    '<<<<<<< local\n',
    ensureTrailingNewline(local),
    '||||||| base\n',
    ensureTrailingNewline(base),
    '=======\n',
    ensureTrailingNewline(remote),
    '>>>>>>> remote\n',
  ].join('');
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') || value.length === 0 ? value : `${value}\n`;
}

function unresolvedWholeFile(base: string, local: string, remote: string, id: string): Diff3MergeResult {
  const hunk: SyncConflictHunk = {
    id,
    base,
    local,
    remote,
    merged: conflictMarkerText(base, local, remote),
  };
  return { clean: false, mergedText: hunk.merged, hunks: [hunk] };
}
