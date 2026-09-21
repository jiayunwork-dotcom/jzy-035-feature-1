/**
 * 各类逻辑门真值正确性测试。
 */
import { describe, expect, it } from 'vitest';
import { evalGate } from '../src/core/gates.js';
import { CircuitBuilder } from './helpers.js';
import { evaluate } from '../src/core/evaluate.js';

describe('各门真值表（evalGate 直接调用）', () => {
  it('AND', () => {
    expect(evalGate('AND', [0, 0])).toBe(0);
    expect(evalGate('AND', [0, 1])).toBe(0);
    expect(evalGate('AND', [1, 0])).toBe(0);
    expect(evalGate('AND', [1, 1])).toBe(1);
  });

  it('OR', () => {
    expect(evalGate('OR', [0, 0])).toBe(0);
    expect(evalGate('OR', [0, 1])).toBe(1);
    expect(evalGate('OR', [1, 0])).toBe(1);
    expect(evalGate('OR', [1, 1])).toBe(1);
  });

  it('NOT', () => {
    expect(evalGate('NOT', [0])).toBe(1);
    expect(evalGate('NOT', [1])).toBe(0);
  });

  it('NAND = NOT AND', () => {
    expect(evalGate('NAND', [0, 0])).toBe(1);
    expect(evalGate('NAND', [0, 1])).toBe(1);
    expect(evalGate('NAND', [1, 0])).toBe(1);
    expect(evalGate('NAND', [1, 1])).toBe(0);
  });

  it('NOR = NOT OR', () => {
    expect(evalGate('NOR', [0, 0])).toBe(1);
    expect(evalGate('NOR', [0, 1])).toBe(0);
    expect(evalGate('NOR', [1, 0])).toBe(0);
    expect(evalGate('NOR', [1, 1])).toBe(0);
  });

  it('XOR', () => {
    expect(evalGate('XOR', [0, 0])).toBe(0);
    expect(evalGate('XOR', [0, 1])).toBe(1);
    expect(evalGate('XOR', [1, 0])).toBe(1);
    expect(evalGate('XOR', [1, 1])).toBe(0);
    // 三输入异或 = 奇校验
    expect(evalGate('XOR', [1, 1, 1])).toBe(1);
    expect(evalGate('XOR', [1, 1, 0])).toBe(0);
  });

  it('XNOR = NOT XOR', () => {
    expect(evalGate('XNOR', [0, 0])).toBe(1);
    expect(evalGate('XNOR', [0, 1])).toBe(0);
    expect(evalGate('XNOR', [1, 0])).toBe(0);
    expect(evalGate('XNOR', [1, 1])).toBe(1);
    expect(evalGate('XNOR', [1, 1, 1])).toBe(0);
  });

  it('悬空输入（null）传播为 null', () => {
    expect(evalGate('AND', [1, null])).toBeNull();
    expect(evalGate('NOT', [null])).toBeNull();
  });
});

describe('通过电路求值验证门真值（含输入开关与输出灯）', () => {
  it('每个二输入门在四种组合下输出正确', () => {
    const cases: Array<{
      type: 'AND' | 'OR' | 'NAND' | 'NOR' | 'XOR' | 'XNOR';
      expected: number[];
    }> = [
      { type: 'AND', expected: [0, 0, 0, 1] },
      { type: 'OR', expected: [0, 1, 1, 1] },
      { type: 'NAND', expected: [1, 1, 1, 0] },
      { type: 'NOR', expected: [1, 0, 0, 0] },
      { type: 'XOR', expected: [0, 1, 1, 0] },
      { type: 'XNOR', expected: [1, 0, 0, 1] }
    ];

    for (const { type, expected } of cases) {
      const b = new CircuitBuilder();
      const a = b.input('A');
      const c = b.input('B');
      const g = b.gate(type);
      const out = b.output('F');
      b.connect(a, g, 0).connect(c, g, 1).connect(g, out);
      const circuit = b.build();
      const got = [0, 1, 2, 3].map((m) => {
        const r = evaluate(circuit, {
          [a]: ((m >> 1) & 1) as 0 | 1,
          [c]: (m & 1) as 0 | 1
        });
        if (!r.ok) throw new Error(r.error.message);
        return r.outputs[out];
      });
      expect(got, type).toEqual(expected);
    }
  });

  it('NOT 门取反', () => {
    const b = new CircuitBuilder();
    const a = b.input('A');
    const g = b.gate('NOT');
    const out = b.output('F');
    b.connect(a, g).connect(g, out);
    const circuit = b.build();
    const r0 = evaluate(circuit, { [a]: 0 });
    const r1 = evaluate(circuit, { [a]: 1 });
    expect(r0.ok && r0.outputs[out]).toBe(1);
    expect(r1.ok && r1.outputs[out]).toBe(0);
  });

  it('三输入 AND 门（inputCount=3）', () => {
    const b = new CircuitBuilder();
    const a = b.input('A');
    const c = b.input('B');
    const d = b.input('C');
    const g = b.gate('AND', 200, 0, 3);
    const out = b.output('F');
    b.connect(a, g, 0).connect(c, g, 1).connect(d, g, 2).connect(g, out);
    const circuit = b.build();
    for (let m = 0; m < 8; m++) {
      const r = evaluate(circuit, {
        [a]: ((m >> 2) & 1) as 0 | 1,
        [c]: ((m >> 1) & 1) as 0 | 1,
        [d]: (m & 1) as 0 | 1
      });
      if (!r.ok) throw new Error(r.error.message);
      expect(r.outputs[out]).toBe(m === 7 ? 1 : 0);
    }
  });
});
