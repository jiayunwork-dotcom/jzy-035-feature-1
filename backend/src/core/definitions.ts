/**
 * 自定义器件定义：工程归一化、定义结构校验、跨层循环引用检测。
 *
 * 分层模型里最容易漏掉的坑在这里处理：
 * 单看每一层内部都可能是无环的，但如果器件甲的定义里用了器件乙、
 * 器件乙的定义里又（直接或经丙）用回甲，整图展开就是无法求值的死递归。
 * findDefinitionCycle 在求值之前扫描"定义引用图"（甲内部电路里的 CUSTOM
 * 实例 -> 它引用的定义），用 DFS 三色标记找出一条具体的环并拒绝整个工程。
 *
 * 旧文件兼容：normalizeProject 接受不带 definitions 的裸 Circuit（version 1），
 * 归一化成 v2 Project，老工程的读入与求值行为与升级前完全一致。
 */

import { validateCircuit } from './graph.js';
import type {
  Circuit,
  DeviceDefinition,
  Project,
  ValidationError
} from './types.js';

export function definitionMap(
  definitions: readonly DeviceDefinition[]
): Map<string, DeviceDefinition> {
  return new Map(definitions.map((d) => [d.id, d]));
}

/** 输入管脚的缺省名 A, B, ...；输出管脚缺省名 Y0, Y1, ... */
export function inputPinName(index: number): string {
  return String.fromCharCode(65 + (index % 26));
}
export function outputPinName(index: number): string {
  return `Y${index}`;
}

export type NormalizeResult =
  | { ok: true; project: Project }
  | { ok: false; error: ValidationError };

/**
 * 把磁盘上的 JSON 归一成 v2 Project。
 * 接受两种形态：
 *   1. 旧版裸 Circuit：{ components, wires }（没有 version/definitions）
 *   2. v2 工程：{ version: 2, circuit: {...}, definitions: [...] }
 * 也容错 { components, wires, definitions: [...] } 这种过渡形态。
 */
export function normalizeProject(doc: unknown): NormalizeResult {
  if (!doc || typeof doc !== 'object') {
    return { ok: false, error: { kind: 'validation', message: '工程文件格式不正确：不是一个 JSON 对象' } };
  }
  const obj = doc as Record<string, unknown>;

  let circuit: Circuit | null = null;
  if (obj.circuit && typeof obj.circuit === 'object') {
    circuit = obj.circuit as Circuit;
  } else if (Array.isArray(obj.components) || Array.isArray(obj.wires)) {
    // 旧版裸电路
    circuit = {
      components: Array.isArray(obj.components) ? (obj.components as Circuit['components']) : [],
      wires: Array.isArray(obj.wires) ? (obj.wires as Circuit['wires']) : []
    };
  }
  if (!circuit) {
    return { ok: false, error: { kind: 'validation', message: '工程文件格式不正确：找不到 circuit（或 components/wires）' } };
  }

  const definitions = Array.isArray(obj.definitions)
    ? (obj.definitions as DeviceDefinition[])
    : [];

  return {
    ok: true,
    project: { version: 2, circuit, definitions }
  };
}

/** 仅判断一个已解析 JSON 是否为旧版裸电路（前端迁移存储版本时使用） */
export function isLegacyCircuitDoc(doc: unknown): boolean {
  if (!doc || typeof doc !== 'object') return false;
  const obj = doc as Record<string, unknown>;
  return (
    obj.version !== 2 &&
    !('circuit' in obj) &&
    (Array.isArray(obj.components) || Array.isArray(obj.wires))
  );
}

function validationError(message: string): ValidationError {
  return { kind: 'validation', message };
}

/**
 * 校验全部器件定义：
 *  id/名字合法且不重复、管脚表与内部 INPUT/OUTPUT 元件一一对应、
 *  内部电路本身通过结构校验（CUSTOM 实例引用的定义都在表里）。
 */
export function validateDefinitions(
  definitions: readonly DeviceDefinition[]
): ValidationError | null {
  const ids = new Set<string>();
  const names = new Set<string>();

  for (const d of definitions) {
    if (!d || typeof d.id !== 'string' || d.id.length === 0) {
      return validationError('存在缺少 id 的器件定义');
    }
    if (ids.has(d.id)) return validationError(`器件定义 id 重复: ${d.id}`);
    ids.add(d.id);

    const name = typeof d.name === 'string' ? d.name.trim() : '';
    if (!name) return validationError(`器件 ${d.id} 没有命名`);
    if (names.has(name)) return validationError(`器件名称重复: ${name}`);
    names.add(name);

    if (!d.circuit || !Array.isArray(d.circuit.components) || !Array.isArray(d.circuit.wires)) {
      return validationError(`器件 ${name} 的内部电路数据不完整`);
    }

    const comps = new Map(d.circuit.components.map((c) => [c.id, c]));
    const pinIds = new Set<string>();
    const pinComps = new Set<string>();

    const checkPins = (pins: DeviceDefinition['inputs'], kind: '输入' | '输出') => {
      if (!Array.isArray(pins) || pins.length === 0) {
        return validationError(`器件 ${name} 至少需要一个${kind}管脚`);
      }
      for (const pin of pins) {
        if (!pin || typeof pin.id !== 'string' || pin.id.length === 0) {
          return validationError(`器件 ${name} 存在缺少 id 的${kind}管脚`);
        }
        if (pinIds.has(pin.id)) return validationError(`器件 ${name} 的管脚 id 重复: ${pin.id}`);
        pinIds.add(pin.id);
        const c = comps.get(pin.componentId);
        if (!c) return validationError(`器件 ${name} 的${kind}管脚 ${pin.id} 指向的内部元件不存在`);
        const expectType = kind === '输入' ? 'INPUT' : 'OUTPUT';
        if (c.type !== expectType) {
          return validationError(
            `器件 ${name} 的${kind}管脚 ${pin.id} 必须对应内部的${expectType === 'INPUT' ? '输入开关' : '输出指示灯'}元件`
          );
        }
        if (pinComps.has(pin.componentId)) {
          return validationError(`器件 ${name} 的内部元件 ${pin.componentId} 被多个管脚同时暴露`);
        }
        pinComps.add(pin.componentId);
      }
      return null;
    };

    const inErr = checkPins(d.inputs, '输入');
    if (inErr) return inErr;
    const outErr = checkPins(d.outputs, '输出');
    if (outErr) return outErr;
  }

  // 内部电路结构校验：所有定义对彼此可见（含前向引用与自引用——
  // 自引用是结构合法的，但会被跨层环检测拒绝）。
  const lookup = definitionMap(definitions);
  for (const d of definitions) {
    const v = validateCircuit(d.circuit, lookup);
    if (v) return validationError(`器件 ${d.name} 的内部电路不合法：${v.message}`);
  }

  return null;
}

/**
 * 构造定义引用图：definitionId -> 其内部电路直接引用到的定义 id 集合。
 * 不存在的引用不参与建边（结构校验已另行报错）。
 */
export function definitionReferenceGraph(
  definitions: readonly DeviceDefinition[]
): Map<string, Set<string>> {
  const known = new Set(definitions.map((d) => d.id));
  const graph = new Map<string, Set<string>>();
  for (const d of definitions) {
    const edges = new Set<string>();
    for (const c of d.circuit.components) {
      if (c.type === 'CUSTOM' && c.definitionId && known.has(c.definitionId)) {
        edges.add(c.definitionId);
      }
    }
    graph.set(d.id, edges);
  }
  return graph;
}

/**
 * 跨层循环引用检测。
 * @returns 构成环的定义 id 序列（末位补回首尾，如 ['A','B','A']）；无环返回 null。
 *  直接自引用（A 的定义里放了 A 的实例）返回 ['A','A']。
 */
export function findDefinitionCycle(
  definitions: readonly DeviceDefinition[]
): string[] | null {
  const graph = definitionReferenceGraph(definitions);
  // 0 未访问 1 在递归栈上 2 完成
  const state = new Map<string, 0 | 1 | 2>();
  for (const id of graph.keys()) state.set(id, 0);
  const stack: string[] = [];

  const dfs = (u: string): string[] | null => {
    state.set(u, 1);
    stack.push(u);
    for (const v of graph.get(u) ?? []) {
      const s = state.get(v);
      if (s === 1) {
        // 回边 u -> v：截出 v..u 并在末尾补 v 闭合
        const start = stack.indexOf(v);
        return [...stack.slice(start), v];
      }
      if (s === 0) {
        const found = dfs(v);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(u, 2);
    return null;
  };

  for (const id of graph.keys()) {
    if (state.get(id) === 0) {
      const found = dfs(id);
      if (found) return found;
    }
  }
  return null;
}

/** 环路径的人类可读文本 */
export function formatDefinitionCycle(path: string[], nameOf?: (id: string) => string): string {
  const names = path.map((id) => nameOf?.(id) ?? id);
  return `检测到器件定义之间的循环引用（${names.join(' → ')}）：这些自定义器件互相把对方当作子电路使用，展开后会无限递归、无法求值。请断开循环引用，使器件的嵌套关系构成有向无环图。`;
}
