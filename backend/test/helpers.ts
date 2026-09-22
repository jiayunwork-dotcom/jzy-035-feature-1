/**
 * 测试辅助：用紧凑的链式方式构造电路。
 */
import { randomUUID } from 'node:crypto';
import { createHierarchyEngine } from '../src/core/hierarchy.js';
import type {
  Circuit,
  CircuitComponent,
  ComponentType,
  DeviceDefinition,
  DevicePin,
  Project,
  Signal,
  Wire
} from '../src/core/types.js';

export class CircuitBuilder {
  private components: CircuitComponent[] = [];
  private wires: Wire[] = [];
  private seq = 0;

  private uid(prefix: string): string {
    this.seq += 1;
    return `${prefix}${this.seq}`;
  }

  add(type: ComponentType, opts: Partial<CircuitComponent> = {}): string {
    const id = opts.id ?? this.uid(type.toLowerCase());
    this.components.push({
      id,
      type,
      x: opts.x ?? 0,
      y: opts.y ?? 0,
      label: opts.label,
      value: opts.value,
      inputCount: opts.inputCount,
      deviceId: opts.deviceId
    });
    return id;
  }

  input(label?: string, value: 0 | 1 = 0, x = 0, y = 0): string {
    return this.add('INPUT', { label, value, x, y });
  }

  output(label?: string, x = 400, y = 0): string {
    return this.add('OUTPUT', { label, x, y });
  }

  gate(type: ComponentType, x = 200, y = 0, inputCount?: number): string {
    return this.add(type, { x, y, inputCount });
  }

  /** 放置一个自定义器件实例 */
  instance(deviceId: string, x = 200, y = 0): string {
    return this.add('SUB', { deviceId, x, y });
  }

  /** 从 src 的输出端口 srcPort 连到 dst 的指定输入端口 */
  connect(src: string, dst: string, dstPort = 0, srcPort = 0): this {
    this.wires.push({
      id: randomUUID(),
      from: { componentId: src, port: srcPort },
      to: { componentId: dst, port: dstPort }
    });
    return this;
  }

  build(): Circuit {
    return { components: this.components, wires: this.wires };
  }
}

/** 用一组已暴露管脚的内部电路构造自定义器件定义 */
export function makeDefinition(input: {
  id: string;
  name: string;
  circuit: Circuit;
  inputComponentIds: string[];
  outputComponentIds: string[];
  inputNames?: string[];
  outputNames?: string[];
}): DeviceDefinition {
  const pin = (componentId: string, i: number, kind: 'in' | 'out', names?: string[]): DevicePin => ({
    componentId,
    name: names?.[i] ?? (kind === 'in' ? `I${i + 1}` : `O${i + 1}`)
  });
  return {
    id: input.id,
    name: input.name,
    inputPins: input.inputComponentIds.map((id, i) => pin(id, i, 'in', input.inputNames)),
    outputPins: input.outputComponentIds.map((id, i) => pin(id, i, 'out', input.outputNames)),
    circuit: input.circuit
  };
}

/** 对整个工程（顶层 + 定义库）求值，失败时抛错 */
export function evalProject(
  project: Project,
  inputValues?: Record<string, 0 | 1>
): { ok: true; outputs: Record<string, Signal>; portOutputs: Record<string, Signal>; wireValues: Record<string, Signal> } {
  const created = createHierarchyEngine(project.definitions);
  if (!created.ok) throw new Error(`分层引擎创建失败: ${created.error.message}`);
  const r = created.engine.evaluate(project.circuit, inputValues);
  if (!r.ok) throw new Error(`求值失败: ${r.error.message}`);
  return r;
}

/** 以 0..2^n-1 的输入向量逐行求值某输出，返回 0/1 数组（MSB = 第一个输入） */
export function outputTrace(
  circuit: Circuit,
  inputIds: string[],
  outputId: string
): (0 | 1 | null)[] {
  const n = inputIds.length;
  const trace: (0 | 1 | null)[] = [];
  for (let m = 0; m < 2 ** n; m++) {
    const values: Record<string, 0 | 1> = {};
    for (let i = 0; i < n; i++) {
      values[inputIds[i]] = ((m >> (n - 1 - i)) & 1) as 0 | 1;
    }
    const r = evaluateFlat(circuit, values);
    if (!r.ok) throw new Error(`求值失败: ${r.error.message}`);
    trace.push(r.outputs[outputId] ?? null);
  }
  return trace;
}

/** 含定义库的逐行求值 */
export function outputTraceProject(
  project: Project,
  inputIds: string[],
  outputId: string
): (0 | 1 | null)[] {
  const n = inputIds.length;
  const trace: (0 | 1 | null)[] = [];
  for (let m = 0; m < 2 ** n; m++) {
    const values: Record<string, 0 | 1> = {};
    for (let i = 0; i < n; i++) {
      values[inputIds[i]] = ((m >> (n - 1 - i)) & 1) as 0 | 1;
    }
    trace.push(evalProject(project, values).outputs[outputId] ?? null);
  }
  return trace;
}

// 延迟引入避免循环：扁平求值入口
import { evaluate as evaluateFlat } from '../src/core/evaluate.js';
