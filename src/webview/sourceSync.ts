/** Version checks shared by the extension host and the embedded CodeMirror editor. */
export interface VersionedSource {
  source: string;
  version: number;
  text: string;
}

export type SourceEditDecision =
  | { kind: "apply" }
  | { kind: "noop" }
  | { kind: "reload"; source: VersionedSource };

/** The host document is authoritative whenever the webview edited an old revision. */
export function decideSourceEdit(current: VersionedSource, baseVersion: number, nextText: string): SourceEditDecision {
  if (current.version !== baseVersion) return { kind: "reload", source: current };
  if (current.text === nextText) return { kind: "noop" };
  return { kind: "apply" };
}
