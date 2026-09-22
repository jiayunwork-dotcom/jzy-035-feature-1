/**
 * 工程文件的读入归一化（前端侧）与封装前校验。
 *
 * 旧版保存的文件是裸 { components, wires }，这里归一成 v2 Project：
 * definitions 为空、电路原样保留 —— 老工程打开后表现与升级前完全一致。
 * localStorage 也沿用同一套迁移逻辑（旧键读出后转存 v2 键）。
 */

import type {
  Circuit,
  CircuitComponent,
  DeviceDefinition,
  Project
} from './types';

export function asProject(doc: unknown): Project | { error: string } {
  if (!doc || typeof doc !== 'object') return { error: '文件不是合法的 JSON 对象' };
  const obj = doc as Record<string, unknown>;

  let circuit: Circuit | null = null;
  if (obj.circuit && typeof obj.circuit === 'object') {
    circuit = obj.circuit as Circuit;
  } else if (Array.isArray(obj.components) || Array.isArray(obj.wires)) {
    circuit = {
      components: Array.isArray(obj.components) ? (obj.components as Circuit['components']) : [],
      wires: Array.isArray(obj.wires) ? (obj.wires as Circuit['wires']) : []
    };
  }
  if (!circuit || !Array.isArray(circuit.components) || !Array.isArray(circuit.wires)) {
    return { error: '文件格式不正确：找不到 components/wires（或 circuit）' };
  }

  const definitions = Array.isArray(obj.definitions) ? (obj.definitions as DeviceDefinition[]) : [];
  return { version: 2, circuit, definitions };
}

export function isLegacyDoc(doc: unknown): boolean {
  if (!doc || typeof doc !== 'object') return false;
  const obj = doc as Record<string, unknown>;
  return obj.version !== 2 && !('circuit' in obj);
}

/** 选区中各类型元件的分类，供封装对话框使用 */
export function classifySelection(
  circuit: Circuit,
  selectedIds: string[]
): {
  inputs: CircuitComponent[];
  outputs: CircuitComponent[];
  internals: CircuitComponent[];
  all: CircuitComponent[];
} {
  const set = new Set(selectedIds);
  const all = circuit.components.filter((c) => set.has(c.id));
  return {
    inputs: all.filter((c) => c.type === 'INPUT'),
    outputs: all.filter((c) => c.type === 'OUTPUT'),
    internals: all.filter((c) => c.type !== 'INPUT' && c.type !== 'OUTPUT'),
    all
  };
}
