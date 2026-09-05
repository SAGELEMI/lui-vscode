export interface PageFrameInput { viewportWidth: number; viewportHeight: number; designWidth: number; designHeight: number; marginLeft?: number; marginTop?: number; marginRight?: number; marginBottom?: number; }
export interface PageFrame { x: number; y: number; width: number; height: number; scale: number; availableWidth: number; availableHeight: number; }

export function calculatePageFrame(input: PageFrameInput): PageFrame {
  const left = input.marginLeft ?? 0; const top = input.marginTop ?? 0; const right = input.marginRight ?? 0; const bottom = input.marginBottom ?? 0;
  if (!(input.designWidth > 0) || !(input.designHeight > 0)) throw new Error("LUI 页面设计尺寸必须为正数。");
  const availableWidth = Math.max(0, input.viewportWidth - left - right);
  const availableHeight = Math.max(0, input.viewportHeight - top - bottom);
  const rawScale = Math.min(availableWidth / input.designWidth, availableHeight / input.designHeight);
  const scale = Number.isFinite(rawScale) ? Math.max(0, rawScale) : 1;
  const width = input.designWidth * scale; const height = input.designHeight * scale;
  return { x: left + (availableWidth - width) * .5, y: top + (availableHeight - height) * .5, width, height, scale, availableWidth, availableHeight };
}
