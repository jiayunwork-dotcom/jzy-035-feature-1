/**
 * SOP 布尔表达式提取测试：表达式必须与真值表一致，
 * 且最简式与规范式在给定变量集合上功能等价。
 */
import { describe, expect, it } from 'vitest';
import { CircuitBuilder, outputTrace } from './helpers.js';
import { extractExpressions } from '../src/core/expression.js';
import { minimizeSop, termsToString } from '../src/core/minimizer.js';

/** 直接用最小项构造"规范 SOP 网络"（每个最小项一个 AND + 大 OR）不现实，
 * 这里对典型电路做提取，并通过"枚举全部输入重新求值"验证最简式等价性。 */

/** 解析最小项字符串的辅助在测试里不需要：直接验证已知电路。 */

describe('SOP 提取', () => {
  it('三输入多数表决：minterms={3,5,6,7}，最简 F = AB + AC + BC', () => {
    const b = new CircuitBuilder();
    const a = b.input('A');
    const c = b.input('B', 0, 40);
    const d = b.input('C', 0, 80);
    const g1 = b.gate('AND', 220, 0);
    const g2 = b.gate('AND', 220, 60);
    const g3 = b.gate('AND', 220, 120);
    const or = b.gate('OR', 360, 40);
    const or2 = b.gate('OR', 480, 40);
    const f = b.output('F', 600, 40);
    b.connect(a, g1, 0)
      .connect(c, g1, 1)
      .connect(a, g2, 0)
      .connect(d, g2, 1)
      .connect(c, g3, 0)
      .connect(d, g3, 1)
      .connect(g1, or, 0)
      .connect(g2, or, 1)
      .connect(g3, or2, 0)
      .connect(or, or2, 1)
      .connect(or2, f);

    const r = extractExpressions({ circuit: b.build(), inputIds: [a, c, d], outputIds: [f] });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.message);
    const e = r.expressions[0];
    expect(e.minterms).toEqual([3, 5, 6, 7]);
    expect(e.sigma).toBe('∑ m(3, 5, 6, 7)');
    expect(e.canonical).toBe("A'·B·C + A·B'·C + A·B·C' + A·B·C");
    expect(new Set(e.minimal.split(' + '))).toEqual(new Set(['A·B', 'A·C', 'B·C']));
  });

  it('XOR 用与/或/非实现：最简 A·B\' + A\'·B，与真值表一致', () => {
    const b = new CircuitBuilder();
    const a = b.input('A');
    const c = b.input('B', 0, 40);
    const na = b.gate('NOT', 160, 0);
    const nb = b.gate('NOT', 160, 100);
    const and1 = b.gate('AND', 300, 0);
    const and2 = b.gate('AND', 300, 100);
    const or = b.gate('OR', 440, 50);
    const f = b.output('F', 580, 50);
    b.connect(a, na)
      .connect(c, nb)
      .connect(a, and1, 0)
      .connect(nb, and1, 1)
      .connect(na, and2, 0)
      .connect(c, and2, 1)
      .connect(and1, or, 0)
      .connect(and2, or, 1)
      .connect(or, f);
    const circuit = b.build();
    const r = extractExpressions({ circuit, inputIds: [a, c], outputIds: [f] });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.message);
    expect(r.expressions[0].minterms).toEqual([1, 2]);
    expect(new Set(r.expressions[0].minimal.split(' + '))).toEqual(
      new Set(["A·B'", "A'·B"])
    );
    // 与实际电路真值表一致性
    expect(outputTrace(circuit, [a, c], f)).toEqual([0, 1, 1, 0]);
  });

  it('恒 0 / 恒 1 输出', () => {
    // F1 = A AND NOT A -> 恒 0（但注意有共同输入，无环）
    const b = new CircuitBuilder();
    const a = b.input('A');
    const gNot = b.gate('NOT', 180, 0);
    const gAnd = b.gate('AND', 320, 0);
    const f0 = b.output('F0', 460, 0);
    b.connect(a, gNot).connect(a, gAnd, 0).connect(gNot, gAnd, 1).connect(gAnd, f0);
    const r0 = extractExpressions({ circuit: b.build(), inputIds: [a], outputIds: [f0] });
    expect(r0.ok).toBe(true);
    if (r0.ok) {
      expect(r0.expressions[0].minimal).toBe('0');
      expect(r0.expressions[0].minterms).toEqual([]);
    }

    // F = A OR NOT A -> 恒 1
    const b2 = new CircuitBuilder();
    const x = b2.input('A');
    const n = b2.gate('NOT', 180, 0);
    const o = b2.gate('OR', 320, 0);
    const f1 = b2.output('F1', 460, 0);
    b2.connect(x, n).connect(x, o, 0).connect(n, o, 1).connect(o, f1);
    const r1 = extractExpressions({ circuit: b2.build(), inputIds: [x], outputIds: [f1] });
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.expressions[0].minimal).toBe('1');
  });

  it('对任意随机函数：最简 SOP 与原始最小项集合功能等价（4 变量全枚举）', () => {
    // 用数学层面的 minimizeSop 验证：对若干 ones 集合，化简后的覆盖集
    // 必须覆盖且仅覆盖 ones。
    for (const ones of [
      [0, 2, 5, 7, 8, 10, 13, 15],
      [1, 3, 4, 5, 9, 11, 14],
      [0, 1, 2, 4, 8],
      [6, 7, 11, 15]
    ]) {
      const terms = minimizeSop(ones, [], 4)!;
      const covered = new Set<number>();
      for (const t of terms) for (const m of t.covers) covered.add(m);
      for (const m of ones) expect(covered.has(m), `最小项 ${m} 未被覆盖 (${termsToString(terms, ['A','B','C','D'])})`).toBe(true);
      // 不引入任何 0 项
      for (let m = 0; m < 16; m++) {
        if (!ones.includes(m)) expect(covered.has(m)).toBe(false);
      }
    }
  });
});
