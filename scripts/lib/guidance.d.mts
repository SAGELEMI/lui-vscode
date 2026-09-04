export interface GuidanceIO {
  read(path: string): Promise<Uint8Array | undefined>;
  write(path: string, bytes: Uint8Array): Promise<void>;
}
export interface GuidanceResult { version: string; updated: string[]; preserved: string[]; }
export const GUIDE_DOCS: string[];
export const GUIDE_EXAMPLES: string[];
export const GUIDE_SKILLS: string[];
export function guidanceEntries(): Array<{source: string; target: string; rewrite?: (source: string) => string}>;
export function digest(value: Uint8Array | string): string;
export function deployGuidance(sourceRoot: string, targetRoot: string, io: GuidanceIO): Promise<GuidanceResult>;
export function matchesRuntime(project: Record<string, unknown> | undefined, installedBytes: Uint8Array, expectedBytes: Uint8Array): boolean;
