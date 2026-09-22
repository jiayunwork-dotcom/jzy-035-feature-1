/** 画布几何：元件尺寸、端口坐标、曼哈顿折线路由、坐标变换。 */

import type {
  CircuitComponent,
  DeviceDefinition,
  PinDef,
  Wire
} from './types';

export const GRID = 10;
export const COMP_WIDTH = 90;
export const COMP_HEIGHT = 56;
export const INPUT_PORT_GAP = 20;
export const PORT_R = 6;

/** 自定义器件方块尺寸 */
export const CUSTOM_WIDTH = 110;
export const CUSTOM_PIN_GAP = 22;
export const CUSTOM_PAD_TOP = 34; // 顶部留给器件名
export const CUSTOM_MIN_HEIGHT = 70;

export type DefinitionLookup = ReadonlyMap<string, DeviceDefinition>;

export function snap(v: number): number {
  return Math.round(v / GRID) * GRID;
}

export function defOf(c: CircuitComponent, defs?: DefinitionLookup): DeviceDefinition | undefined {
  return c.type === 'CUSTOM' && c.definitionId ? defs?.get(c.definitionId) : undefined;
}

export function inputPortCount(
  c: CircuitComponent,
  defs?: DefinitionLookup
): number {
  if (c.type === 'INPUT') return 0;
  if (c.type === 'OUTPUT') return 1;
  if (c.type === 'CUSTOM') return defOf(c, defs)?.inputs.length ?? 0;
  if (c.type === 'NOT') return 1;
  return c.inputCount ?? 2;
}

export function outputPortCount(
  c: CircuitComponent,
  defs?: DefinitionLookup
): number {
  if (c.type === 'OUTPUT') return 0;
  if (c.type === 'CUSTOM') return defOf(c, defs)?.outputs.length ?? 0;
  return 1;
}

/** 元件实际高度：多输入门随输入端口数增高；自定义方块随管脚数增高 */
export function componentHeight(
  c: CircuitComponent,
  defs?: DefinitionLookup
): number {
  if (c.type === 'CUSTOM') {
    const d = defOf(c, defs);
    const pins = Math.max(d?.inputs.length ?? 0, d?.outputs.length ?? 0);
    return Math.max(CUSTOM_MIN_HEIGHT, CUSTOM_PAD_TOP + pins * CUSTOM_PIN_GAP + 12);
  }
  const n = inputPortCount(c, defs);
  if (n <= 1) return COMP_HEIGHT;
  return Math.max(COMP_HEIGHT, n * INPUT_PORT_GAP + 16);
}

/** 输入端口在元件本地坐标中的位置（相对左上角） */
export function inputPortLocal(count: number, port: number): { x: number; y: number } {
  if (count === 1) return { x: 0, y: COMP_HEIGHT / 2 };
  const top = INPUT_PORT_GAP / 2 + 8;
  return { x: 0, y: top + port * INPUT_PORT_GAP };
}

export function outputPortLocal(height: number): { x: number; y: number } {
  return { x: COMP_WIDTH, y: height / 2 };
}

/** 自定义器件输入管脚本地坐标（含单管脚垂直居中） */
export function customInputLocal(index: number, total: number): { x: number; y: number } {
  const h = customHeight(total, total);
  if (total <= 1) return { x: 0, y: h / 2 };
  return { x: 0, y: CUSTOM_PAD_TOP + index * CUSTOM_PIN_GAP + CUSTOM_PIN_GAP / 2 };
}

/** 自定义器件输出管脚本地坐标 */
export function customOutputLocal(index: number, totalOut: number, totalIn: number): { x: number; y: number } {
  const h = customHeight(totalIn, totalOut);
  if (totalOut <= 1) return { x: CUSTOM_WIDTH, y: h / 2 };
  return { x: CUSTOM_WIDTH, y: CUSTOM_PAD_TOP + index * CUSTOM_PIN_GAP + CUSTOM_PIN_GAP / 2 };
}

export function customHeight(totalIn: number, totalOut: number): number {
  const pins = Math.max(totalIn, totalOut);
  return Math.max(CUSTOM_MIN_HEIGHT, CUSTOM_PAD_TOP + pins * CUSTOM_PIN_GAP + 12);
}

export function portPosition(
  c: CircuitComponent,
  side: 'in' | 'out',
  port = 0,
  defs?: DefinitionLookup
): { x: number; y: number } {
  if (c.type === 'CUSTOM') {
    const d = defOf(c, defs);
    const local =
      side === 'in'
        ? customInputLocal(port, d?.inputs.length ?? 0)
        : customOutputLocal(port, d?.outputs.length ?? 0, d?.inputs.length ?? 0);
    return { x: c.x + local.x, y: c.y + local.y };
  }
  const local =
    side === 'in'
      ? inputPortLocal(inputPortCount(c, defs), port)
      : outputPortLocal(componentHeight(c, defs));
  return { x: c.x + local.x, y: c.y + local.y };
}

/** 管脚显示名（缺省时输入 A,B,...，输出 Y0,Y1,...） */
export function pinLabel(pin: PinDef, index: number, side: 'in' | 'out'): string {
  const trimmed = pin.name?.trim();
  if (trimmed) return trimmed;
  return side === 'in'
    ? String.fromCharCode(65 + (index % 26))
    : `Y${index}`;
}

/**
 * 生成曼哈顿折线路由：
 * 输出口先向右伸出一小段水平引线 -> 走到目标输入口所在列 -> 进入输入口。
 * 采用简单的三段式（水平-竖直-水平），保证横横平竖直。
 */
export function routeWire(
  from: { x: number; y: number },
  to: { x: number; y: number }
): string {
  const stub = 14;
  const x1 = from.x + stub;
  const x2 = to.x - stub;
  const midX = (x1 + x2) / 2;
  return `M ${from.x} ${from.y} L ${x1} ${from.y} L ${midX} ${from.y} L ${midX} ${to.y} L ${x2} ${to.y} L ${to.x} ${to.y}`;
}

/** 找鼠标位置下的输入端口（用于拉线落点吸附） */
export function hitTestInputPort(
  comps: CircuitComponent[],
  p: { x: number; y: number },
  defs?: DefinitionLookup,
  tolerance = 12
): { componentId: string; port: number } | null {
  for (const c of comps) {
    const n = inputPortCount(c, defs);
    for (let i = 0; i < n; i++) {
      const pos = portPosition(c, 'in', i, defs);
      if (Math.abs(pos.x - p.x) <= tolerance && Math.abs(pos.y - p.y) <= tolerance) {
        return { componentId: c.id, port: i };
      }
    }
  }
  return null;
}

/** 找鼠标位置下的输出端口（自定义器件可有多端口） */
export function hitTestOutputPort(
  comps: CircuitComponent[],
  p: { x: number; y: number },
  defs?: DefinitionLookup,
  tolerance = 12
): { componentId: string; port: number } | null {
  for (const c of comps) {
    const n = outputPortCount(c, defs);
    for (let i = 0; i < n; i++) {
      const pos = portPosition(c, 'out', i, defs);
      if (Math.abs(pos.x - p.x) <= tolerance && Math.abs(pos.y - p.y) <= tolerance) {
        return { componentId: c.id, port: i };
      }
    }
  }
  return null;
}

export function componentAt(
  comps: CircuitComponent[],
  p: { x: number; y: number },
  defs?: DefinitionLookup
): CircuitComponent | null {
  // 后添加的在上层，倒序命中
  for (let i = comps.length - 1; i >= 0; i--) {
    const c = comps[i];
    const w = c.type === 'CUSTOM' ? CUSTOM_WIDTH : COMP_WIDTH;
    const h = componentHeight(c, defs);
    if (p.x >= c.x && p.x <= c.x + w && p.y >= c.y && p.y <= c.y + h) {
      return c;
    }
  }
  return null;
}

/** 矩形框选：返回完全落在选框内的元件 id（选框坐标已规整为正宽高） */
export function componentsInRect(
  comps: CircuitComponent[],
  rect: { x: number; y: number; w: number; h: number },
  defs?: DefinitionLookup
): string[] {
  return comps
    .filter((c) => {
      const w = c.type === 'CUSTOM' ? CUSTOM_WIDTH : COMP_WIDTH;
      const h = componentHeight(c, defs);
      return (
        c.x >= rect.x &&
        c.y >= rect.y &&
        c.x + w <= rect.x + rect.w &&
        c.y + h <= rect.y + rect.h
      );
    })
    .map((c) => c.id);
}

export function isWireConnected(w: Wire, componentId: string): boolean {
  return w.from.componentId === componentId || w.to.componentId === componentId;
}
