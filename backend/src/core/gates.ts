/**
 * 各类逻辑门的真值语义。
 *
 * 输入一律为 0/1（悬空在求值器中另行处理），输出为 0/1。
 * 多输入门（AND/OR/NAND/NOR/XOR/XNOR）支持 2~8 个输入。
 */

import type { GateType, Signal } from './types.js';

export const DEFAULT_GATE_INPUT_COUNT = 2;
export const MIN_GATE_INPUTS = 2;
export const MAX_GATE_INPUTS = 8;

/** 某类型门的输入端口个数；NOT 恒为 1，INPUT/OUTPUT 不在此处讨论 */
export function gateInputCount(type: GateType): number {
  return type === 'NOT' ? 1 : DEFAULT_GATE_INPUT_COUNT;
}

/** 异或/同或的多输入推广：按输入中 1 的个数奇偶判定 */
function parity(inputs: number[]): number {
  return inputs.reduce((acc, v) => acc ^ v, 0);
}

/**
 * 计算门的输出。
 * @returns 0/1；若任一输入为 null（悬空），返回 null
 */
export function evalGate(type: GateType, inputs: Signal[]): Signal {
  if (inputs.some((v) => v === null)) return null;
  const a = inputs as number[];

  switch (type) {
    case 'AND':
      return a.every((v) => v === 1) ? 1 : 0;
    case 'OR':
      return a.some((v) => v === 1) ? 1 : 0;
    case 'NOT':
      return a[0] === 1 ? 0 : 1;
    case 'NAND':
      return a.every((v) => v === 1) ? 0 : 1;
    case 'NOR':
      return a.some((v) => v === 1) ? 0 : 1;
    case 'XOR':
      return parity(a) as 0 | 1;
    case 'XNOR':
      return (parity(a) ^ 1) as 0 | 1;
    default: {
      const exhaustive: never = type;
      throw new Error(`未知门类型: ${String(exhaustive)}`);
    }
  }
}

export const GATE_LABELS: Record<GateType, string> = {
  AND: '与',
  OR: '或',
  NOT: '非',
  NAND: '与非',
  NOR: '或非',
  XOR: '异或',
  XNOR: '同或'
};
