/** 画布几何：元件尺寸、端口坐标、曼哈顿折线路由、坐标变换。 */

import type { CircuitComponent, Wire } from './types';

export const GRID = 10;
export const COMP_WIDTH = 90;
export const COMP_HEIGHT = 56;
export const INPUT_PORT_GAP = 20;
export const PORT_R = 6;

export function snap(v: number): number {
  return Math.round(v / GRID) * GRID;
}

export function inputPortCount(c: CircuitComponent): number {
  if (c.type === 'INPUT') return 0;
  if (c.type === 'OUTPUT') return 1;
  if (c.type === 'NOT') return 1;
  return c.inputCount ?? 2;
}

export function outputPortCount(c: CircuitComponent): number {
  return c.type === 'OUTPUT' ? 0 : 1;
}

/** 元件实际高度：多输入门随输入端口数增高，其余为固定高度 */
export function componentHeight(c: CircuitComponent): number {
  const n = inputPortCount(c);
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

export function portPosition(
  c: CircuitComponent,
  side: 'in' | 'out',
  port = 0
): { x: number; y: number } {
  const local =
    side === 'in'
      ? inputPortLocal(inputPortCount(c), port)
      : outputPortLocal(componentHeight(c));
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
  tolerance = 12
): { componentId: string; port: number } | null {
  for (const c of comps) {
    const n = inputPortCount(c);
    for (let i = 0; i < n; i++) {
      const pos = portPosition(c, 'in', i);
      if (Math.abs(pos.x - p.x) <= tolerance && Math.abs(pos.y - p.y) <= tolerance) {
        return { componentId: c.id, port: i };
      }
    }
  }
  return null;
}

/** 找鼠标位置下的输出端口 */
export function hitTestOutputPort(
  comps: CircuitComponent[],
  p: { x: number; y: number },
  tolerance = 12
): { componentId: string; port: number } | null {
  for (const c of comps) {
    if (outputPortCount(c) === 0) continue;
    const pos = portPosition(c, 'out', 0);
    if (Math.abs(pos.x - p.x) <= tolerance && Math.abs(pos.y - p.y) <= tolerance) {
      return { componentId: c.id, port: 0 };
    }
  }
  return null;
}

export function componentAt(
  comps: CircuitComponent[],
  p: { x: number; y: number }
): CircuitComponent | null {
  // 后添加的在上层，倒序命中
  for (let i = comps.length - 1; i >= 0; i--) {
    const c = comps[i];
    const h = componentHeight(c);
    if (p.x >= c.x && p.x <= c.x + COMP_WIDTH && p.y >= c.y && p.y <= c.y + h) {
      return c;
    }
  }
  return null;
}

export function isWireConnected(w: Wire, componentId: string): boolean {
  return w.from.componentId === componentId || w.to.componentId === componentId;
}
