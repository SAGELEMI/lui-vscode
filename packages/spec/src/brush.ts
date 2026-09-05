export interface LuiSolidBrush { kind: "solid"; color: string; }
export interface LuiLinearGradientBrush { kind: "linear"; angle: number; stops: readonly [{ color: string; offset: number }, { color: string; offset: number }]; }
export type LuiBrush = LuiSolidBrush | LuiLinearGradientBrush;

const HEX = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i;
const GRADIENT = /^linear-gradient\(\s*(-?(?:\d+\.?\d*|\.\d+))deg\s*,\s*(#[0-9a-f]{6}(?:[0-9a-f]{2})?)\s+((?:\d+\.?\d*|\.\d+))%\s*,\s*(#[0-9a-f]{6}(?:[0-9a-f]{2})?)\s+((?:\d+\.?\d*|\.\d+))%\s*\)$/i;

export function normalizeColor(value: string): string | undefined {
  const color = value.trim();
  return HEX.test(color) ? color.toUpperCase() : undefined;
}

export function parseBrush(value: string | undefined): LuiBrush | undefined {
  const raw = value?.trim() ?? "";
  const solid = normalizeColor(raw);
  if (solid) return { kind: "solid", color: solid };
  const match = GRADIENT.exec(raw);
  if (!match) return undefined;
  const angle = Number(match[1]); const first = Number(match[3]); const second = Number(match[5]);
  if (![angle, first, second].every(Number.isFinite) || first < 0 || second > 100 || first >= second) return undefined;
  return { kind: "linear", angle: ((angle % 360) + 360) % 360, stops: [{ color: match[2]!.toUpperCase(), offset: first }, { color: match[4]!.toUpperCase(), offset: second }] };
}

export function formatLinearGradient(angle: number, firstColor: string, firstOffset: number, secondColor: string, secondOffset: number): string {
  return `linear-gradient(${((angle % 360) + 360) % 360}deg, ${normalizeColor(firstColor) ?? "#000000"} ${Math.max(0, Math.min(100, firstOffset))}%, ${normalizeColor(secondColor) ?? "#FFFFFF"} ${Math.max(0, Math.min(100, secondOffset))}%)`;
}
