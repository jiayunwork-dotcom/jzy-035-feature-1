/**
 * 电路图结构校验与依赖图构建。
 *
 * 连线方向：from(输出端口) -> to(输入端口)。
 * 这里只做结构层面的检查（端口存在、方向合法、无多重驱动），
 * 反馈环的检测在 evaluate 的拓扑排序中完成。
 *
 * 分层扩展：SUB 实例的端口数由它引用的 DeviceDefinition 决定，
 * 因此校验/端口计数额外接受一个 definitions 参数（扁平旧调用可省略，
 * 此时画布上若出现 SUB 会报结构错误）。
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

export type DefinitionLibrary = ReadonlyMap<string, DeviceDefinition>;

/** 元件的输入端口数（INPUT 为 0）；SUB 实例取定义的输入管脚数 */
export function inputPortCount(c: CircuitComponent, defs?: DefinitionLibrary): number {
  if (c.type === 'INPUT') return 0;
  if (c.type === 'OUTPUT') return 1;
  if (c.type === 'NOT') return 1;
  if (c.type === 'SUB') {
    const def = c.deviceId ? defs?.get(c.deviceId) : undefined;
    return def ? def.inputPins.length : 0;
  }
  const n = c.inputCount ?? gateInputCount(c.type);
  return n;
}

/** 元件的逻辑输出端口数（OUTPUT 指示灯为 0）；SUB 实例取定义的输出管脚数 */
export function outputPortCount(c: CircuitComponent, defs?: DefinitionLibrary): number {
  if (c.type === 'OUTPUT') return 0;
  if (c.type === 'SUB') {
    const def = c.deviceId ? defs?.get(c.deviceId) : undefined;
    return def ? def.outputPins.length : 0;
  }
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
  'SUB'
]);

function err(message: string): ValidationError {
  return { kind: 'validation', message };
}

/** 结构校验；合法时返回 null。defs 提供 SUB 实例引用的器件定义 */
export function validateCircuit(
  circuit: Circuit,
  defs?: DefinitionLibrary
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
    if (c.type === 'SUB') {
      if (!c.deviceId) return err(`实例 ${c.id} 缺少 deviceId，无法确定引用的自定义器件`);
      if (!defs?.has(c.deviceId)) {
        return err(`实例 ${c.id} 引用的自定义器件不存在: ${c.deviceId}（定义可能已被删除）`);
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
    if (w.from.port < 0 || w.from.port >= outputPortCount(src, defs)) {
      return err(`连线 ${w.id} 从元件 ${src.id} 不存在的输出端口 ${w.from.port} 出发`);
    }
    if (w.to.port < 0 || w.to.port >= inputPortCount(dst, defs)) {
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
