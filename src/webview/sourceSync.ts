/** Version checks shared by the extension host and the embedded CodeMirror editor. */
export interface VersionedSource {
  source: string;
  version: number;
  text: string;
}

export type SourceEol = "\n" | "\r\n";

/** CodeMirror positions count every line break as one character. Keep the editor/host
 * protocol on LF so source offsets, selections and syntax-tree ranges share one space. */
export function toProtocolText(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** Convert protocol text back to the target document's existing line-ending style. */
export function fromProtocolText(text: string, eol: SourceEol): string {
  const logical = toProtocolText(text);
  return eol === "\r\n" ? logical.replace(/\n/g, "\r\n") : logical;
}

export type SourceEditDecision =
  | { kind: "apply" }
  | { kind: "noop" }
  | { kind: "reload"; source: VersionedSource };

export interface SourcePatch { from: number; to: number; insert: string; }

/** One user transaction may edit multiple ranges (multi-cursor, completion, paste).
 * Offsets refer to the same LF base, never to a rebuilt full-file snapshot. */
export function applySourceChanges(base: string, changes: readonly SourcePatch[]): string {
  let cursor = 0, result = "";
  for (const change of changes) {
    if (!Number.isInteger(change.from) || !Number.isInteger(change.to) || change.from < cursor || change.to < change.from || change.to > base.length || typeof change.insert !== "string") throw new Error("无效的源码增量范围");
    result += base.slice(cursor, change.from) + toProtocolText(change.insert);
    cursor = change.to;
  }
  return result + base.slice(cursor);
}

export function rebaseSourceChanges(base: string, current: string, changes: readonly SourcePatch[]): SourcePatch[] | undefined {
  const mapped: SourcePatch[] = [];
  for (const change of changes) {
    const result = rebaseSourcePatch(base, current, change);
    if (!result) return undefined;
    mapped.push(result);
  }
  return mapped;
}

/** The smallest single-span edit between two protocol documents. */
export function sourcePatch(before: string, after: string): SourcePatch | undefined {
  const left = toProtocolText(before); const right = toProtocolText(after);
  if (left === right) return undefined;
  let from = 0;
  while (from < left.length && from < right.length && left[from] === right[from]) from += 1;
  let leftEnd = left.length; let rightEnd = right.length;
  while (leftEnd > from && rightEnd > from && left[leftEnd - 1] === right[rightEnd - 1]) { leftEnd -= 1; rightEnd -= 1; }
  return { from, to: leftEnd, insert: right.slice(from, rightEnd) };
}

/** The host document is authoritative whenever the webview edited an old revision. */
export function decideSourceEdit(current: VersionedSource, baseVersion: number, nextText: string): SourceEditDecision {
  if (current.version !== baseVersion) return { kind: "reload", source: current };
  if (toProtocolText(current.text) === toProtocolText(nextText)) return { kind: "noop" };
  return { kind: "apply" };
}

/** A version bump with identical logical text is a same-document acknowledgement, not a conflict. */
export function decideSourcePatch(current: VersionedSource, baseVersion: number, baseText: string, patch: SourcePatch): SourceEditDecision {
  const currentText = toProtocolText(current.text); const expectedBase = toProtocolText(baseText);
  if (!Number.isInteger(patch.from) || !Number.isInteger(patch.to) || patch.from < 0 || patch.to < patch.from || patch.to > expectedBase.length) return { kind: "reload", source: current };
  const next = expectedBase.slice(0, patch.from) + toProtocolText(patch.insert) + expectedBase.slice(patch.to);
  if (currentText === next) return { kind: "noop" };
  if (currentText !== expectedBase) return { kind: "reload", source: current };
  return { kind: "apply" };
}

/**
 * Rebase one Studio edit over one external TextDocument change.  The protocol
 * deliberately uses a single contiguous patch, so overlapping edits stay a
 * visible conflict instead of silently choosing either side.
 */
export function rebaseSourcePatch(baseText: string, currentText: string, patch: SourcePatch): SourcePatch | undefined {
  const base = toProtocolText(baseText); const current = toProtocolText(currentText);
  const external = sourcePatch(base, current);
  if (!external) return patch;
  const sameInsertionPoint = patch.from === patch.to && external.from === external.to && patch.from === external.from;
  if (patch.to <= external.from && !sameInsertionPoint) return patch;
  if (external.to <= patch.from && !sameInsertionPoint) {
    const delta = external.insert.length - (external.to - external.from);
    return { ...patch, from: patch.from + delta, to: patch.to + delta };
  }
  return undefined;
}

export type SaveSourceStatus = "saved" | "noop" | "conflict" | "failed";

/**
 * TextDocument.save() may return false after VS Code has already saved the same
 * document through its native Ctrl+S route.  Treat the verified document state,
 * rather than that boolean alone, as the authority.
 */
export function decideSaveResult(input: { wasDirty: boolean; saveReturned: boolean; isDirtyAfter: boolean; diskMatches: boolean }): SaveSourceStatus {
  if (!input.wasDirty) return "noop";
  if (input.saveReturned) return "saved";
  if (!input.isDirtyAfter || input.diskMatches) return "noop";
  return "failed";
}

/** Retry only the unchanged native document; an external revision is a conflict. */
export function shouldRetrySave(status: SaveSourceStatus, documentVersion: number, expectedVersion: number): boolean {
  return status === "failed" && documentVersion === expectedVersion;
}
