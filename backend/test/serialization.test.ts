/**
 * 电路序列化往返测试：
 * 保存（JSON.stringify）-> 读取（JSON.parse）后的电路，
 * 结构与求值结果必须完全一致。
 */
import { describe, expect, it } from 'vitest';
import { CircuitBuilder, outputTrace } from './helpers.js';
import { evaluate } from '../src/core/evaluate.js';

function demoCircuit() {
  const b = new CircuitBuilder();
  const a = b.input('A', 1, 0, 0);
  const c = b.input('B', 0, 0, 50);
  const g1 = b.gate('XOR', 220, 20);
  const g2 = b.gate('AND', 220, 90);
  const o = b.gate('OR', 360, 50);
  const f = b.output('F', 500, 50);
  b.connect(a, g1, 0)
    .connect(c, g1, 1)
    .connect(a, g2, 0)
    .connect(c, g2, 1)
    .connect(g1, o, 0)
    .connect(g2, o, 1)
    .connect(o, f);
  return { circuit: b.build(), inputs: [a, c], output: f };
}

describe('序列化保存 / 读取', () => {
  it('JSON 往返后元件与连线数量、id、位置保持一致', () => {
    const { circuit } = demoCircuit();
    const text = JSON.stringify(circuit);
    const restored = JSON.parse(text);

    expect(restored.components).toHaveLength(circuit.components.length);
    expect(restored.wires).toHaveLength(circuit.wires.length);
    expect(restored.components.map((c: any) => c.id).sort()).toEqual(
      circuit.components.map((c) => c.id).sort()
    );
    expect(restored.wires.map((w: any) => w.id).sort()).toEqual(
      circuit.wires.map((w) => w.id).sort()
    );
  });

  it('读回来的电路重新求值，逐行结果与原电路一致', () => {
    const { circuit, inputs, output } = demoCircuit();
    const restored = JSON.parse(JSON.stringify(circuit));

    const before = outputTrace(circuit, inputs, output);
    const after = outputTrace(restored, inputs, output);
    expect(after).toEqual(before);

    // 开关值也随序列化保留
    expect(restored.components.find((c: any) => c.id === inputs[0]).value).toBe(1);
    const r = evaluate(restored);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.outputs[output]).toBe(before[3]); // A=1,B=1 对应第 4 行
  });
});
