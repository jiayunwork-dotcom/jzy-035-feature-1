/**
 * "封装"操作：把画布上选中的一坨元件连同它们之间的连线，
 * 深拷贝成一份自定义器件定义；被选中的 INPUT/OUTPUT 元件暴露为命名管脚。
 *
 * 注意：
 *  - 封装后原选区在画布上保持不动（用户可以随后自行删掉它，或直接开始用
 *    库里的新器件）；定义拿到的是独立副本，内部 id 全部重映射，避免与
 *    原电路或其他定义撞 id；
 *  - 只有两端元件都在选区内的连线才属于内部电路；跨边界的线不进定义；
 *  - 管脚顺序按元件画面位置（先 y 后 x）排列，方块上端口分布稳定。
 */

import type {
  Circuit,
  CircuitComponent,
  DeviceDefinition,
  DevicePin,
  Wire
} from './types';
import { uid } from './utils';

export interface PackageInput {
  circuit: Circuit;
  selectedComponentIds: string[];
  name: string;
  /** 可选：管脚命名覆盖；key 为被暴露元件的 id */
  inputPinNames?: Record<string, string>;
  outputPinNames?: Record<string, string>;
}

export interface PackageResult {
  definition: DeviceDefinition;
}

function byPosition(components: CircuitComponent[]): CircuitComponent[] {
  return [...components].sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
}

function pinName(c: CircuitComponent, fallback: string, override?: string): string {
  const custom = override?.trim();
  if (custom) return custom;
  return c.label?.trim() || fallback;
}

export function packageSelection(input: PackageInput): PackageResult {
  const selected = new Set(input.selectedComponentIds);
  const comps = input.circuit.components.filter((c) => selected.has(c.id));

  // 仅保留两端都在选区内的连线
  const innerWires = input.circuit.wires.filter(
    (w) => selected.has(w.from.componentId) && selected.has(w.to.componentId)
  );

  // id 重映射：旧 id -> 新 id，定义内部一律使用全新的内部 id
  const remap = new Map<string, string>();
  for (const c of comps) remap.set(c.id, uid('inner'));

  const clonedComponents: CircuitComponent[] = comps.map((c) => ({
    ...c,
    id: remap.get(c.id)!
  }));
  const clonedWires: Wire[] = innerWires.map((w) => ({
    id: uid('iw'),
    from: { componentId: remap.get(w.from.componentId)!, port: w.from.port },
    to: { componentId: remap.get(w.to.componentId)!, port: w.to.port }
  }));

  const innerCircuit: Circuit = { components: clonedComponents, wires: clonedWires };

  const buildPins = (
    kind: 'INPUT' | 'OUTPUT',
    names?: Record<string, string>
  ): DevicePin[] => {
    const originals = byPosition(comps.filter((c) => c.type === kind));
    return originals.map((c, i) => ({
      componentId: remap.get(c.id)!,
      name: pinName(c, kind === 'INPUT' ? `I${i + 1}` : `O${i + 1}`, names?.[c.id])
    }));
  };

  const definition: DeviceDefinition = {
    id: uid('dev'),
    name: input.name.trim(),
    inputPins: buildPins('INPUT', input.inputPinNames),
    outputPins: buildPins('OUTPUT', input.outputPinNames),
    circuit: innerCircuit
  };

  return { definition };
}

/** 校验封装输入：名字、至少一个输出管脚（输入管脚可以为空） */
export function validatePackageInput(
  name: string,
  selected: CircuitComponent[],
  existingNames: string[]
): string | null {
  if (!name.trim()) return '请给自定义器件起个名字';
  if (selected.length === 0) return '请先在画布上圈选要封装的元件';
  const outputs = selected.filter((c) => c.type === 'OUTPUT');
  if (outputs.length === 0) {
    return '选区内至少要包含一个输出指示灯作为对外输出管脚';
  }
  if (existingNames.some((n) => n === name.trim())) {
    return `已存在同名器件“${name.trim()}”，请换个名字`;
  }
  return null;
}

/** 构造一个放置在画布上的 SUB 实例元件 */
export function makeInstance(definition: DeviceDefinition, x: number, y: number): CircuitComponent {
  return {
    id: uid('c'),
    type: 'SUB',
    deviceId: definition.id,
    label: definition.name,
    x,
    y
  };
}

/** 工具：从当前表里读出选区内的输入/输出开关（供封装对话框展示管脚） */
export function selectedIO(circuit: Circuit, ids: string[]) {
  const set = new Set(ids);
  const comps = circuit.components.filter((c) => set.has(c.id));
  return {
    inputs: byPosition(comps.filter((c) => c.type === 'INPUT')),
    outputs: byPosition(comps.filter((c) => c.type === 'OUTPUT')),
    gates: comps.filter((c) => c.type !== 'INPUT' && c.type !== 'OUTPUT' && c.type !== 'SUB'),
    instances: comps.filter((c) => c.type === 'SUB')
  };
}
