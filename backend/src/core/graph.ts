/**
 * 电路图结构校验与依赖图构建。
 *
 * 连线方向：from(输出端口) -> to(输入端口)。
 * 这里只做结构层面的检查（端口存在、方向合法、无多重驱动、CUSTOM 实例的
 * 管脚与定义一致），反馈环的检测在 evaluate 的拓扑排序中完成，
 * 器件定义之间的跨层循环引用在 definitions.ts 中检测。
 */

import {
  MAX_GATE_INPUTS,
  MIN_GATE_INPUTS,
  gateInputCount
} from './gates.js';
import type {
  Circuit,
  CircuitComponent,
  ComponentType,
  DeviceDefinition,
  ValidationError
} from './types.js';

/** 定义查找表：definitionId -> 定义（顶层求值时传入；校验定义内部电路时传入全量表） */
export type DefinitionLookup = ReadonlyMap<string, DeviceDefinition>;

/** 元件的输入端口数（INPUT 为 0） */
export function inputPortCount(
  c: CircuitComponent,
  def?: DeviceDefinition
): number {
  if (c.type === 'INPUT') return 0;
  if (c.type === 'OUTPUT') return 1;
  if (c.type === 'CUSTOM') {
    if (!def) return 0; // 定义缺失：校验会报结构错误，这里先给 0 防止越界
    return def.inputs.length;
  }
  if (c.type === 'NOT') return 1;
  const n = c.inputCount ?? gateInputCount(c.type);
  return n;
}

/** 元件的逻辑输出端口数（OUTPUT 指示灯为 0；CUSTOM 可为多个） */
export function outputPortCount(
  c: CircuitComponent,
  def?: DeviceDefinition
): number {
  if (c.type === 'OUTPUT') return 0;
  if (c.type === 'CUSTOM') return def ? def.outputs.length : 0;
  return 1;
}

const VALID_TYPES: ReadonlySet<ComponentType> = new Set([
  'AND',
  'OR',
  'NOT',
  'NAND',
  'NOR',
  'XOR',
  'XNOR',
  'INPUT',
  'OUTPUT',
  'CUSTOM'
]);

function err(message: string): ValidationError {
  return { kind: 'validation', message };
}

/** 结构校验；合法时返回 null。definitions 缺省时按旧版扁平电路校验 */
export function validateCircuit(
  circuit: Circuit,
  definitions?: DefinitionLookup
): ValidationError | null {
  if (!circuit || !Array.isArray(circuit.components) || !Array.isArray(circuit.wires)) {
    return err('电路数据格式不正确：components/wires 必须是数组');
  }

  const comps = new Map<string, CircuitComponent>();
  for (const c of circuit.components) {
    if (!c || typeof c.id !== 'string' || c.id.length === 0) {
      return err('存在缺少 id 的元件');
    }
    if (comps.has(c.id)) return err(`元件 id 重复: ${c.id}`);
    if (!VALID_TYPES.has(c.type)) return err(`元件 ${c.id} 的类型无效: ${String(c.type)}`);
    if (c.type === 'CUSTOM') {
      if (!c.definitionId) {
        return err(`自定义器件实例 ${c.id} 缺少 definitionId，不知道引用哪个器件`);
      }
      if (!definitions?.has(c.definitionId)) {
        return err(`实例 ${c.id} 引用的器件定义不存在: ${c.definitionId ?? '(空)'}`);
      }
    } else if (c.type !== 'INPUT' && c.type !== 'OUTPUT' && c.type !== 'NOT') {
      const n = c.inputCount ?? gateInputCount(c.type);
      if (n < MIN_GATE_INPUTS || n > MAX_GATE_INPUTS) {
        return err(`门 ${c.id} 的输入数 ${n} 超出允许范围 ${MIN_GATE_INPUTS}~${MAX_GATE_INPUTS}`);
      }
    }
    comps.set(c.id, c);
  }

  for (const w of circuit.wires) {
    if (!w || typeof w.id !== 'string') return err('存在缺少 id 的连线');
    const src = comps.get(w.from?.componentId);
    const dst = comps.get(w.to?.componentId);
    if (!src) return err(`连线 ${w.id} 的源元件不存在`);
    if (!dst) return err(`连线 ${w.id} 的目标元件不存在`);

    const srcDef = src.type === 'CUSTOM' ? definitions?.get(src.definitionId!) : undefined;
    const dstDef = dst.type === 'CUSTOM' ? definitions?.get(dst.definitionId!) : undefined;
    const srcOutCount = outputPortCount(src, srcDef);
    const dstInCount = inputPortCount(dst, dstDef);

    if (w.from.port !== 0 && src.type !== 'CUSTOM') {
      return err(`连线 ${w.id} 只能从输出端口 0 出发（仅自定义器件可有多个输出端口）`);
    }
    if (w.from.port < 0 || w.from.port >= srcOutCount) {
      return err(`连线 ${w.id} 从元件 ${src.id} 不存在的输出端口 ${w.from.port} 出发`);
    }
    if (w.to.port < 0 || w.to.port >= dstInCount) {
      return err(`连线 ${w.id} 连到了元件 ${dst.id} 不存在的输入端口 ${w.to.port}`);
    }
    // 注意：元件输出接回自身输入（自环）不在此拦截，
    // 交由 evaluate 的环检测统一报告为"反馈环"。
  }

  // 输出->输入方向检查（INPUT 不能作目标由 inputPortCount=0 已覆盖；
  // OUTPUT 不能作源由 outputPortCount=0 已覆盖）。
  // 检查多重驱动：同一个输入端口至多一条线驱动。
  const driven = new Set<string>();
  for (const w of circuit.wires) {
    const key = `${w.to.componentId}:${w.to.port}`;
    if (driven.has(key)) {
      return err(`元件 ${w.to.componentId} 的输入端口 ${w.to.port} 被多条连线驱动`);
    }
    driven.add(key);
  }

  return null;
}

export interface CircuitGraph {
  comps: Map<string, CircuitComponent>;
  /** componentId -> 以其输出为起点的连线 */
  outWires: Map<string, Circuit['wires']>;
  /** "componentId:port" -> 驱动该输入端口的连线 */
  driver: Map<string, Circuit['wires'][number]>;
}

export function buildGraph(circuit: Circuit): CircuitGraph {
  const comps = new Map<string, CircuitComponent>();
  for (const c of circuit.components) comps.set(c.id, c);

  const outWires = new Map<string, Circuit['wires']>();
  const driver = new Map<string, Circuit['wires'][number]>();

  for (const w of circuit.wires) {
    const list = outWires.get(w.from.componentId) ?? [];
    list.push(w);
    outWires.set(w.from.componentId, list);
    driver.set(`${w.to.componentId}:${w.to.port}`, w);
  }

  return { comps, outWires, driver };
}
