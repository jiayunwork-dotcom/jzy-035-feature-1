/**
 * 测试辅助：用紧凑的链式方式构造电路。
 */
import { randomUUID } from 'node:crypto';
import { evaluate } from '../src/core/evaluate.js';
import type {
  Circuit,
  CircuitComponent,
  ComponentType,
  DeviceDefinition,
  PinDef,
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
      definitionId: opts.definitionId
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

  /** 放置一个自定义器件实例，引用 definitionId */
  instance(definitionId: string, x = 200, y = 0): string {
    return this.add('CUSTOM', { x, y, definitionId });
  }

  /** 从 src 的指定输出端口连到 dst 的指定输入端口（自定义器件可有多个输出端口） */
  connectFrom(src: string, srcPort: number, dst: string, dstPort = 0): this {
    this.wires.push({
      id: randomUUID(),
      from: { componentId: src, port: srcPort },
      to: { componentId: dst, port: dstPort }
    });
    return this;
  }

  /** 从 src 的输出(端口0) 连到 dst 的指定输入端口 */
  connect(src: string, dst: string, dstPort = 0): this {
    this.wires.push({
      id: randomUUID(),
      from: { componentId: src, port: 0 },
      to: { componentId: dst, port: dstPort }
    });
    return this;
  }

  build(): Circuit {
    return { components: this.components, wires: this.wires };
  }
}

/**
 * 把一张"以 INPUT/OUTPUT 元件为管脚"的内部电路封装成器件定义。
 * inputs/outputs 中的元件 id 顺序即管脚顺序。
 */
export function makeDefinition(
  id: string,
  name: string,
  inner: Circuit,
  inputs: { id: string; name?: string }[],
  outputs: { id: string; name?: string }[]
): DeviceDefinition {
  const pins = (list: { id: string; name?: string }[], prefix: string): PinDef[] =>
    list.map((p, i) => ({ id: `${id}-${prefix}${i}`, name: p.name, componentId: p.id }));
  return {
    id,
    name,
    inputs: pins(inputs, 'in'),
    outputs: pins(outputs, 'out'),
    circuit: inner
  };
}

/** 以 0..2^n-1 的输入向量逐行求值某输出，返回 0/1 数组（MSB = 第一个输入），支持器件定义表 */
export function outputTraceWithDefs(
  circuit: Circuit,
  inputIds: string[],
  outputId: string,
  definitions: DeviceDefinition[]
): (0 | 1 | null)[] {
  const n = inputIds.length;
  const trace: (0 | 1 | null)[] = [];
  for (let m = 0; m < 2 ** n; m++) {
    const values: Record<string, 0 | 1> = {};
    for (let i = 0; i < n; i++) {
      values[inputIds[i]] = ((m >> (n - 1 - i)) & 1) as 0 | 1;
    }
    const r = evaluate(circuit, values, definitions);
    if (!r.ok) throw new Error(`求值失败: ${r.error.message}`);
    trace.push(r.outputs[outputId] ?? null);
  }
  return trace;
}

/** 以 0..2^n-1 的输入向量逐行求值某输出，返回 0/1 数组（MSB = 第一个输入） */
export function outputTrace(
  circuit: Circuit,
  inputIds: string[],
  outputId: string
): (0 | 1 | null)[] {
  return outputTraceWithDefs(circuit, inputIds, outputId, []);
}
