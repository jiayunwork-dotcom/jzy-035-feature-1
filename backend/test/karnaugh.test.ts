/**
 * 卡诺图化简测试（2~4 变量）：
 *  - 网格按 Gray 码布局，最小项落在正确格子；
 *  - 分组覆盖所有 1 且不覆盖 0；
 *  - 最简表达式正确；
 *  - 超过 4 变量拒绝并说明原因。
 */
import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from './helpers.js';
import { buildKarnaugh } from '../src/core/karnaugh.js';
import type { Circuit } from '../src/core/types.js';

/** 不经过电路，直接用最小项构造电路网络成本太高；
 * 因此先用一个已知电路（多数表决/异或）做端到端，再对纯算法做矩阵检查。 */

/** 构造一个由最小项集合"译码"出来的电路：
 *  每个最小项 -> NOT+AND -> 大 OR。仅测试用。 */
function mintermCircuit(
  varCount: number,
  ones: number[]
): { circuit: Circuit; inputs: string[]; output: string } {
  const b = new CircuitBuilder();
  const inputs: string[] = [];
  for (let i = 0; i < varCount; i++) {
    inputs.push(b.input(String.fromCharCode(65 + i), 0, i * 60));
  }
  const termGates: string[] = [];
  const notGates = inputs.map((id) => {
    const ng = b.gate('NOT', 140, inputs.indexOf(id) * 40);
    b.connect(id, ng);
    return ng;
  });

  ones.forEach((m, gi) => {
    const and = b.gate('AND', 280, gi * 50, varCount);
    for (let i = 0; i < varCount; i++) {
      const bit = (m >> (varCount - 1 - i)) & 1;
      b.connect(bit === 1 ? inputs[i] : notGates[i], and, i);
    }
    termGates.push(and);
  });

  // OR 树（二输入）
  let layer = termGates;
  let y = ones.length * 60;
  while (layer.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      if (i + 1 < layer.length) {
        const o = b.gate('OR', 420 + next.length * 0, y);
        b.connect(layer[i], o, 0).connect(layer[i + 1], o, 1);
        next.push(o);
        y += 50;
      } else {
        next.push(layer[i]);
      }
    }
    layer = next;
  }
  const f = b.output('F', 700, y);
  if (layer[0]) b.connect(layer[0], f);
  return { circuit: b.build(), inputs, output: f };
}

describe('卡诺图布局', () => {
  it('3 变量：2×4 Gray 码网格，行列标签与最小项位置正确', () => {
    const { circuit, inputs, output } = mintermCircuit(3, [3, 5, 6, 7]);
    const r = buildKarnaugh({ circuit, inputIds: inputs, outputId: output });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.message);
    expect(r.rowLabels).toEqual(['A=0', 'A=1']);
    expect(r.colLabels).toEqual(['BC=00', 'BC=01', 'BC=11', 'BC=10']);
    // (row1,col2=11) 是 m7? row=1(A=1),col code=3(BC=11) => 111=7
    const cell = r.cells.find((c) => c.row === 1 && c.col === 2)!;
    expect(cell.minterm).toBe(7);
    expect(cell.value).toBe(1);
    // 环上相邻检查：m4(100) 在 row1 col0；m6(110) 在 row1 col3；它们在环上相邻
    const m4 = r.cells.find((c) => c.minterm === 4)!;
    const m6 = r.cells.find((c) => c.minterm === 6)!;
    expect([m4.row, m4.col]).toEqual([1, 0]);
    expect([m6.row, m6.col]).toEqual([1, 3]);
  });

  it('4 变量：4×4 网格，m0 与 m2、m8 环面相邻', () => {
    const { circuit, inputs, output } = mintermCircuit(4, [0]);
    const r = buildKarnaugh({ circuit, inputIds: inputs, outputId: output });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rowLabels).toEqual(['AB=00', 'AB=01', 'AB=11', 'AB=10']);
    expect(r.colLabels).toEqual(['CD=00', 'CD=01', 'CD=11', 'CD=10']);
    const m0 = r.cells.find((c) => c.minterm === 0)!;
    expect([m0.row, m0.col]).toEqual([0, 0]);
  });
});

describe('卡诺图化简结果', () => {
  it('3 变量多数表决最简为 AB + AC + BC，分组覆盖 {3,5,6,7}', () => {
    const { circuit, inputs, output } = mintermCircuit(3, [3, 5, 6, 7]);
    const r = buildKarnaugh({ circuit, inputIds: inputs, outputId: output });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.message);
    expect(new Set(r.minimalExpression.split(' + '))).toEqual(
      new Set(['A·B', 'A·C', 'B·C'])
    );
    const covered = new Set(r.groups.flatMap((g) => g.minterms));
    expect(covered).toEqual(new Set([3, 5, 6, 7]));
    // 每组大小必须是 2 的幂
    for (const g of r.groups) {
      expect(Number.isInteger(Math.log2(g.minterms.length))).toBe(true);
    }
  });

  it('2 变量 XOR：两个对角 1 无法合并，最简保留两个文字项', () => {
    const { circuit, inputs, output } = mintermCircuit(2, [1, 2]);
    const r = buildKarnaugh({ circuit, inputIds: inputs, outputId: output });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(new Set(r.minimalExpression.split(' + '))).toEqual(
      new Set(["A'·B", "A·B'"])
    );
  });

  it('4 变量环面合并：4 个角 0,2,8,10 合成 B\'·D\'', () => {
    const { circuit, inputs, output } = mintermCircuit(4, [0, 2, 8, 10]);
    const r = buildKarnaugh({ circuit, inputIds: inputs, outputId: output });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.message);
    expect(r.minimalExpression).toBe("B'·D'");
    expect([...r.groups[0].minterms].sort((x, y) => x - y)).toEqual([0, 2, 8, 10]);
  });

  it('4 变量整列/整行合并：m4,m5,m12,m13 -> B·C\'', () => {
    const { circuit, inputs, output } = mintermCircuit(4, [4, 5, 12, 13]);
    const r = buildKarnaugh({ circuit, inputIds: inputs, outputId: output });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.minimalExpression).toBe("B·C'");
  });

  it('全 0 / 全 1', () => {
    const m0 = mintermCircuit(2, []);
    const rr0 = buildKarnaugh({ circuit: m0.circuit, inputIds: m0.inputs, outputId: m0.output });
    expect(rr0.ok).toBe(true);
    if (rr0.ok) {
      expect(rr0.minimalExpression).toBe('0');
      expect(rr0.groups).toEqual([]);
    }
    const m1 = mintermCircuit(2, [0, 1, 2, 3]);
    const rr1 = buildKarnaugh({ circuit: m1.circuit, inputIds: m1.inputs, outputId: m1.output });
    expect(rr1.ok).toBe(true);
    if (rr1.ok) expect(rr1.minimalExpression).toBe('1');
  });

  it('5 变量拒绝并解释原因', () => {
    const { circuit, inputs, output } = mintermCircuit(5, [0]);
    const r = buildKarnaugh({ circuit, inputIds: inputs, outputId: output });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('超过 4 个变量');
  });
});
