/**
 * 教学关卡验证测试：判定必须基于真实求值，
 * 结构"长得像"但功能错误的电路不能过关。
 */
import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from './helpers.js';
import { LEVELS, getLevel, verifyLevel } from '../src/core/levels.js';

/** 正确的三输入多数表决 */
function correctMajority() {
  const b = new CircuitBuilder();
  const a = b.input('A', 0, 0);
  const c = b.input('B', 0, 50);
  const d = b.input('C', 0, 100);
  const g1 = b.gate('AND', 220, 0);
  const g2 = b.gate('AND', 220, 50);
  const g3 = b.gate('AND', 220, 100);
  const o1 = b.gate('OR', 380, 30);
  const o2 = b.gate('OR', 500, 30);
  const f = b.output('F', 620, 30);
  b.connect(a, g1, 0)
    .connect(c, g1, 1)
    .connect(a, g2, 0)
    .connect(d, g2, 1)
    .connect(c, g3, 0)
    .connect(d, g3, 1)
    .connect(g1, o1, 0)
    .connect(g2, o1, 1)
    .connect(g3, o2, 0)
    .connect(o1, o2, 1)
    .connect(o2, f);
  return b.build();
}

/** 结构上"很像"多数表决（同样三个 AND 两个 OR），但 g3 错接成 A·A —— 功能错误 */
function structurallySimilarButWrong() {
  const b = new CircuitBuilder();
  const a = b.input('A', 0, 0);
  const c = b.input('B', 0, 50);
  const d = b.input('C', 0, 100);
  const g1 = b.gate('AND', 220, 0);
  const g2 = b.gate('AND', 220, 50);
  const g3 = b.gate('AND', 220, 100);
  const o1 = b.gate('OR', 380, 30);
  const o2 = b.gate('OR', 500, 30);
  const f = b.output('F', 620, 30);
  b.connect(a, g1, 0)
    .connect(c, g1, 1) // AB
    .connect(a, g2, 0)
    .connect(d, g2, 1) // AC
    .connect(c, g3, 0)
    .connect(a, g3, 1) // 应为 BC，错接成 AB —— 结构相似但功能错
    .connect(g1, o1, 0)
    .connect(g2, o1, 1)
    .connect(g3, o2, 0)
    .connect(o1, o2, 1)
    .connect(o2, f);
  return b.build();
}

describe('关卡验证基于真实求值', () => {
  it('正确的多数表决电路通过 majority3', () => {
    const r = verifyLevel({ levelId: 'majority3', circuit: correctMajority() });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.passed).toBe(true);
      expect(r.mismatchCount).toBe(0);
      expect(r.rows).toHaveLength(8);
      expect(r.rows.every((x) => x.match)).toBe(true);
    }
  });

  it('结构相似但功能错误的电路不能蒙混过关，并指出不符行', () => {
    const r = verifyLevel({ levelId: 'majority3', circuit: structurallySimilarButWrong() });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.passed).toBe(false);
      expect(r.mismatchCount).toBeGreaterThan(0);
      // m=6 (110): 目标 1，错误电路 F = AB+AC+AB = AB+AC = 1；m=4(100) 目标0，电路=0；
      // m=2(010) 目标0，电路 AB=0 AC=0 ->0；真正出错的是 m=13 不存在（3 变量）；
      // 3 变量下 m=2(010) 期望0得0；m=6 期望1得1；错误体现在 m=? —— BC 缺失：
      // m=6(110):AB=1,AC=0 ->1 正确；m=3(011): 目标1，电路 AB=0 AC=0 -> 0 ✗
      const bad = r.rows.find((x) => x.minterm === 3)!;
      expect(bad.match).toBe(false);
      expect(bad.expected).toEqual([1]);
      expect(bad.actual[0]).toBe(0);
    }
  });

  it('输入/输出元件数量不对直接判失败', () => {
    const b = new CircuitBuilder();
    const a = b.input('A');
    b.input('B');
    b.input('C');
    const f = b.output('F');
    const g2 = b.output('G');
    b.connect(a, f).connect(a, g2);
    const r = verifyLevel({ levelId: 'majority3', circuit: b.build() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('输出指示灯');
  });

  it('半加器：S 与 C 都正确才通过双输出判定', () => {
    const b = new CircuitBuilder();
    const a = b.input('A', 0, 0);
    const c = b.input('B', 0, 60);
    const x = b.gate('XOR', 220, 0);
    const g = b.gate('AND', 220, 80);
    const s = b.output('S', 400, 0);
    const carry = b.output('C', 400, 80);
    b.connect(a, x, 0)
      .connect(c, x, 1)
      .connect(a, g, 0)
      .connect(c, g, 1)
      .connect(x, s)
      .connect(g, carry);
    const r = verifyLevel({ levelId: 'half-adder', circuit: b.build() });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.passed).toBe(true);
  });

  it('半加器把进位接错（两个输出都接异或）则失败', () => {
    const b = new CircuitBuilder();
    const a = b.input('A', 0, 0);
    const c = b.input('B', 0, 60);
    const x = b.gate('XOR', 220, 0);
    const s = b.output('S', 400, 0);
    const carry = b.output('C', 400, 80);
    b.connect(a, x, 0).connect(c, x, 1).connect(x, s).connect(x, carry);
    const r = verifyLevel({ levelId: 'half-adder', circuit: b.build() });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.passed).toBe(false);
      // m=3 时进位期望 1 实际 0
      const last = r.rows[3];
      expect(last.expected).toEqual([0, 1]);
      expect(last.actual).toEqual([0, 0]);
    }
  });

  it('含环的学生电路返回环错误而不是崩溃', () => {
    const b = new CircuitBuilder();
    const a = b.input('A', 0, 0);
    b.input('B', 0, 60);
    const d = b.input('C', 0, 120);
    const g1 = b.gate('AND', 220, 0);
    const g2 = b.gate('OR', 360, 0);
    const f = b.output('F', 520, 0);
    b.connect(a, g1, 0)
      .connect(g2, g1, 1) // 反馈：g2 输出绕回 g1 第二输入
      .connect(g1, g2, 0)
      .connect(d, g2, 1)
      .connect(g2, f);
    const r = verifyLevel({ levelId: 'majority3', circuit: b.build() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cyclePath?.length).toBeGreaterThan(0);
  });

  it('非门关卡：接一条直通线（F=A）不能通过', () => {
    const b = new CircuitBuilder();
    const a = b.input('A');
    const f = b.output('F');
    b.connect(a, f);
    const r = verifyLevel({ levelId: 'not-gate', circuit: b.build() });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.passed).toBe(false);
      expect(r.rows[0]).toMatchObject({ expected: [1], actual: [0] });
    }
  });

  it('关卡表可枚举且目标表行数 = 2^n', () => {
    for (const level of LEVELS) {
      expect(level.target).toHaveLength(2 ** level.inputCount);
      expect(getLevel(level.id)?.id).toBe(level.id);
    }
  });
});
