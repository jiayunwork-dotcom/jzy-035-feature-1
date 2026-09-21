/**
 * 真值表穷举测试：逐行与手工真值表比对。
 */
import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from './helpers.js';
import {
  MAX_TRUTH_TABLE_VARS,
  buildTruthTable,
  truthTableToCsv
} from '../src/core/truthTable.js';

/** 三输入多数表决电路：F = AB + AC + BC */
function majority3Circuit() {
  const b = new CircuitBuilder();
  const a = b.input('A', 0, 0, 0);
  const c = b.input('B', 0, 0, 40);
  const d = b.input('C', 0, 0, 80);
  const g1 = b.gate('AND', 220, 0);
  const g2 = b.gate('AND', 220, 60);
  const g3 = b.gate('AND', 220, 120);
  const or = b.gate('OR', 360, 60);
  const or2 = b.gate('OR', 480, 60);
  const f = b.output('F', 600, 60);
  b.connect(a, g1, 0)
    .connect(c, g1, 1) // AB
    .connect(a, g2, 0)
    .connect(d, g2, 1) // AC
    .connect(c, g3, 0)
    .connect(d, g3, 1) // BC
    .connect(g1, or, 0)
    .connect(g2, or, 1)
    .connect(g3, or2, 0)
    .connect(or, or2, 1)
    .connect(or2, f);
  return { circuit: b.build(), inputs: [a, c, d], output: f };
}

describe('真值表穷举', () => {
  it('三输入多数表决逐行正确', () => {
    const { circuit, inputs, output } = majority3Circuit();
    const r = buildTruthTable({ circuit, inputIds: inputs, outputIds: [output] });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.message);
    expect(r.rowCount).toBe(8);
    expect(r.variables).toEqual(['A', 'B', 'C']);
    const got = r.rows.map((row) => row.outputs[0]);
    // m: 0 1 2 3 4 5 6 7
    expect(got).toEqual([0, 0, 0, 1, 0, 1, 1, 1]);
    // minterm 编号连续，输入向量为标准二进制序
    expect(r.rows.map((row) => row.minterm)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(r.rows[3].inputs).toEqual([0, 1, 1]);
    expect(r.rows[7].inputs).toEqual([1, 1, 1]);
  });

  it('单输入非门真值表两行', () => {
    const b = new CircuitBuilder();
    const a = b.input('A');
    const g = b.gate('NOT');
    const f = b.output('F');
    b.connect(a, g).connect(g, f);
    const r = buildTruthTable({ circuit: b.build(), inputIds: [a], outputIds: [f] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows.map((x) => x.outputs[0])).toEqual([1, 0]);
  });

  it('多输出：半加器 S 与 C 各自正确', () => {
    const b = new CircuitBuilder();
    const a = b.input('A');
    const c = b.input('B', 0, 40);
    const xor = b.gate('XOR', 220, 0);
    const and = b.gate('AND', 220, 80);
    const s = b.output('S', 420, 0);
    const carry = b.output('C', 420, 80);
    b.connect(a, xor, 0)
      .connect(c, xor, 1)
      .connect(a, and, 0)
      .connect(c, and, 1)
      .connect(xor, s)
      .connect(and, carry);
    const r = buildTruthTable({ circuit: b.build(), inputIds: [a, c], outputIds: [s, carry] });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.message);
    expect(r.rows.map((x) => x.outputs)).toEqual([
      [0, 0],
      [1, 0],
      [1, 0],
      [0, 1]
    ]);
  });

  it('输入 >10 个给警告但仍生成', () => {
    const b = new CircuitBuilder();
    const ids: string[] = [];
    for (let i = 0; i < 11; i++) ids.push(b.input(String.fromCharCode(65 + i)));
    const g = b.gate('OR', 300, 0, 8);
    const g2 = b.gate('OR', 420, 0, 8);
    const f = b.output('F');
    ids.slice(0, 8).forEach((id, i) => b.connect(id, g, i));
    ids.slice(8).forEach((id, i) => b.connect(id, g2, i));
    b.connect(g, g2, 3).connect(g2, f);
    // g2 有 8 端口：slice(8)=3 个输入占 0..2，g 占端口 3
    const r = buildTruthTable({ circuit: b.build(), inputIds: ids, outputIds: [f] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rowCount).toBe(2048);
      expect(r.warning).toContain('2048');
    }
  });

  it(`输入超过 ${MAX_TRUTH_TABLE_VARS} 个直接拒绝并说明原因`, () => {
    const b = new CircuitBuilder();
    const ids: string[] = [];
    for (let i = 0; i < MAX_TRUTH_TABLE_VARS + 1; i++) ids.push(b.input(`I${i}`));
    const f = b.output('F');
    ids.slice(0, 1).forEach((id) => b.connect(id, f));
    const r = buildTruthTable({ circuit: b.build(), inputIds: ids, outputIds: [f] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('最多支持');
  });

  it('环电路求真值表时返回环错误而不是卡死', () => {
    const b = new CircuitBuilder();
    const a = b.input('A');
    const g1 = b.gate('AND', 200, 0);
    const g2 = b.gate('NOT', 320, 80);
    const f = b.output('F');
    b.connect(a, g1, 0).connect(g2, g1, 1).connect(g1, g2).connect(g2, f);
    const r = buildTruthTable({ circuit: b.build(), inputIds: [a], outputIds: [f] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect((r.cyclePath ?? []).length).toBeGreaterThan(0);
  });

  it('CSV 导出首行为变量与输出表头', () => {
    const { circuit, inputs, output } = majority3Circuit();
    const r = buildTruthTable({ circuit, inputIds: inputs, outputIds: [output] });
    if (!r.ok) throw new Error(r.message);
    const csv = truthTableToCsv(r);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('A,B,C,F(输出)');
    expect(lines[4]).toBe('0,1,1,1');
  });
});
