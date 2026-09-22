/** 画布几何：元件尺寸、端口坐标、曼哈顿折线路由、坐标变换。 */

import type { CircuitComponent, DeviceDefinition, Wire } from './types';

export const GRID = 10;
export const COMP_WIDTH = 90;
export const COMP_HEIGHT = 56;
export const INPUT_PORT_GAP = 20;
export const PORT_R = 6;

/** 自定义实例方块的尺寸 */
export const SUB_WIDTH = 110;
export const SUB_MIN_HEIGHT = 64;
export const SUB_PIN_GAP = 22;
export const SUB_PAD_TOP = 18;

export function snap(v: number): number {
  return Math.round(v / GRID) * GRID;
}

/** id -> 定义（实例端口数/方块尺寸从这里取） */
export type DefLookup = ReadonlyMap<string, DeviceDefinition>;

export function inputPortCount(c: CircuitComponent, defs?: DefLookup): number {
  if (c.type === 'INPUT') return 0;
  if (c.type === 'OUTPUT') return 1;
  if (c.type === 'NOT') return 1;
  if (c.type === 'SUB') return c.deviceId ? defs?.get(c.deviceId)?.inputPins.length ?? 0 : 0;
  return c.inputCount ?? 2;
}

export function outputPortCount(c: CircuitComponent, defs?: DefLookup): number {
  if (c.type === 'OUTPUT') return 0;
  if (c.type === 'SUB') return c.deviceId ? defs?.get(c.deviceId)?.outputPins.length ?? 0 : 0;
  return 1;
}

/** 元件实际高度：多输入门/多管脚实例随端口数增高，其余为固定高度 */
export function componentHeight(c: CircuitComponent, defs?: DefLookup): number {
  if (c.type === 'SUB') {
    const n = Math.max(
      inputPortCount(c, defs),
      outputPortCount(c, defs)
    );
    return Math.max(SUB_MIN_HEIGHT, SUB_PAD_TOP * 2 + Math.max(0, n - 1) * SUB_PIN_GAP);
  }
  const n = inputPortCount(c, defs);
  if (n <= 1) return COMP_HEIGHT;
  return Math.max(COMP_HEIGHT, n * INPUT_PORT_GAP + 16);
}

export function componentWidth(c: CircuitComponent): number {
  return c.type === 'SUB' ? SUB_WIDTH : COMP_WIDTH;
}

/** 门/开关/灯的输入端口在元件本地坐标中的位置（相对左上角） */
export function inputPortLocal(count: number, port: number): { x: number; y: number } {
  if (count === 1) return { x: 0, y: COMP_HEIGHT / 2 };
  const top = INPUT_PORT_GAP / 2 + 8;
  return { x: 0, y: top + port * INPUT_PORT_GAP };
}

export function outputPortLocal(height: number): { x: number; y: number } {
  return { x: COMP_WIDTH, y: height / 2 };
}

/** 实例方块输入管脚的本地坐标 */
export function subInputPortLocal(index: number): { x: number; y: number } {
  return { x: 0, y: SUB_PAD_TOP + index * SUB_PIN_GAP };
}

/** 实例方块输出管脚的本地坐标 */
export function subOutputPortLocal(index: number): { x: number; y: number } {
  return { x: SUB_WIDTH, y: SUB_PAD_TOP + index * SUB_PIN_GAP };
}

export function portPosition(
  c: CircuitComponent,
  side: 'in' | 'out',
  port = 0,
  defs?: DefLookup
): { x: number; y: number } {
  if (c.type === 'SUB') {
    const local =
      side === 'in' ? subInputPortLocal(port) : subOutputPortLocal(port);
    return { x: c.x + local.x, y: c.y + local.y };
  }
  const local =
    side === 'in'
      ? inputPortLocal(inputPortCount(c, defs), port)
      : outputPortLocal(componentHeight(c, defs));
  return { x: c.x + local.x, y: c.y + local.y };
}

/**
 * 生成曼哈顿折线路由：
 * 输出口先向右伸出一小段水平引线 -> 走到目标输入口所在列 -> 进入输入口。
 * 采用简单的三段式（水平-竖直-水平），保证横平竖直。
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
  tolerance = 12,
  defs?: DefLookup
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

/** 找鼠标位置下的输出端口（实例可有多个输出端口） */
export function hitTestOutputPort(
  comps: CircuitComponent[],
  p: { x: number; y: number },
  tolerance = 12,
  defs?: DefLookup
): { componentId: string; port: number } | null {
  for (const c of comps) {
    const n = outputPortCount(c, defs);
    if (n === 0) continue;
    for (let port = 0; port < n; port++) {
      const pos = portPosition(c, 'out', port, defs);
      if (Math.abs(pos.x - p.x) <= tolerance && Math.abs(pos.y - p.y) <= tolerance) {
        return { componentId: c.id, port };
      }
    }
  }
  return null;
}

export function componentAt(
  comps: CircuitComponent[],
  p: { x: number; y: number },
  defs?: DefLookup
): CircuitComponent | null {
  // 后添加的在上层，倒序命中
  for (let i = comps.length - 1; i >= 0; i--) {
    const c = comps[i];
    const h = componentHeight(c, defs);
    const w = componentWidth(c);
    if (p.x >= c.x && p.x <= c.x + w && p.y >= c.y && p.y <= c.y + h) {
      return c;
    }
  }
  return null;
}

export function isWireConnected(w: Wire, componentId: string): boolean {
  return w.from.componentId === componentId || w.to.componentId === componentId;
}

/** 元件是否落在框选矩形内（与矩形相交即算选中） */
export function componentInRect(
  c: CircuitComponent,
  rect: { x: number; y: number; w: number; h: number },
  defs?: DefLookup
): boolean {
  const hgt = componentHeight(c, defs);
  const wdt = componentWidth(c);
  return (
    c.x < rect.x + rect.w &&
    c.x + wdt > rect.x &&
    c.y < rect.y + rect.h &&
    c.y + hgt > rect.y
  );
}
