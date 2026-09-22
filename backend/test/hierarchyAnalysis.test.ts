/**
 * 分层电路上的分析能力测试：真值表穷举、SOP 表达式、卡诺图、关卡判定
 * 对"含自定义器件实例"的电路必须与对扁平电路一样给出正确结果 ——
 * 它们走的都是同一个跨层求值内核。
 */
import { describe, expect, it } from 'vitest';
import { CircuitBuilder, makeDefinition } from './helpers.js';
import { buildTruthTable } from '../src/core/truthTable.js';
import { extractExpressions } from '../src/core/expression.js';
import { buildKarnaugh } from '../src/core/karnaugh.js';
import { LEVELS, verifyLevel } from '../src/core/levels.js';
import type { DeviceDefinition } from '../src/core/types.js';

/** 二输入与器件定义 */
function andDef(id = 'def-and', name = 'MY_AND'): DeviceDefinition {
  const b = new CircuitBuilder();
  const a = b.input('A');
  const c = b.input('B', 0, 40);
  const g = b.gate('AND', 200, 10);
  const f = b.output('F', 360, 10);
  b.connect(a, g, 0).connect(c, g, 1).connect(g, f);
  return makeDefinition({ id, name, circuit: b.build(), inputComponentIds: [a, c], outputComponentIds: [f] });
}

/** 三输入多数表决：内部用两级 AND/OR 实现 */
function majorityDef(): DeviceDefinition {
  const b = new CircuitBuilder();
  const a = b.input('A', 0, 0, 0);
  const c = b.input('B', 0, 0, 50);
  const d = b.input('C', 0, 0, 100);
  const g1 = b.gate('AND', 200, 0);
  const g2 = b.gate('AND', 200, 50);
  const g3 = b.gate('AND', 200, 100);
  const or = b.gate('OR', 360, 40, 3);
  const f = b.output('F', 520, 40);
  b.connect(a, g1, 0).connect(c, g1, 1);
  b.connect(a, g2, 0).connect(d, g2, 1);
  b.connect(c, g3, 0).connect(d, g3, 1);
  b.connect(g1, or, 0).connect(g2, or, 1).connect(g3, or, 2);
  b.connect(or, f);
  return makeDefinition({
    id: 'def-maj',
    name: 'MAJ3',
    circuit: b.build(),
    inputComponentIds: [a, c, d],
    outputComponentIds: [f]
  });
}

/** 顶层：n 个开关 -> 1 个实例 -> 1 个输出灯 */
function topInstanceCircuit(defId: string, inputCount: number) {
  const b = new CircuitBuilder();
  const inputs: string[] = [];
  for (let i = 0; i < inputCount; i++) {
    inputs.push(b.input(String.fromCharCode(65 + i), 0, 0, i * 50));
  }
  const inst = b.instance(defId, 240, inputCount * 20);
  const f = b.output('F', 420, inputCount * 20);
  inputs.forEach((id, i) => b.connect(id, inst, i));
  b.connect(inst, f, 0);
  return { circuit: b.build(), inputs, output: f };
}

describe('含实例电路的真值表', () => {
  it('MY_AND 实例：四行输出与 AND 完全一致', () => {
    const def = andDef();
    const { circuit, inputs, output } = topInstanceCircuit(def.id, 2);
    const r = buildTruthTable({
      circuit,
      inputIds: inputs,
      outputIds: [output],
      definitions: [def]
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rowCount).toBe(4);
      expect(r.rows.map((row) => row.outputs[0])).toEqual([0, 0, 0, 1]);
    }
  });

  it('三输入多数表决实例：8 行逐行正确', () => {
    const def = majorityDef();
    const { circuit, inputs, output } = topInstanceCircuit(def.id, 3);
    const r = buildTruthTable({
      circuit,
      inputIds: inputs,
      outputIds: [output],
      definitions: [def]
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const got = r.rows.map((row) => row.outputs[0]);
      // 最小项 3(011),5(101),6(110),7(111)
      expect(got).toEqual([0, 0, 0, 1, 0, 1, 1, 1]);
    }
  });

  it('定义间存在循环引用时真值表直接拒绝，不做任何求值', () => {
    const b1 = new CircuitBuilder();
    const a1 = b1.input('A');
    const i1 = b1.instance('d-b');
    const f1 = b1.output('F');
    b1.connect(a1, i1, 0).connect(i1, f1, 0);
    const d1 = makeDefinition({
      id: 'd-a',
      name: 'A',
      circuit: b1.build(),
      inputComponentIds: [a1],
      outputComponentIds: [f1]
    });
    const b2 = new CircuitBuilder();
    const a2 = b2.input('A');
    const i2 = b2.instance('d-a');
    const f2 = b2.output('F');
    b2.connect(a2, i2, 0).connect(i2, f2, 0);
    const d2 = makeDefinition({
      id: 'd-b',
      name: 'B',
      circuit: b2.build(),
      inputComponentIds: [a2],
      outputComponentIds: [f2]
    });

    const top = new CircuitBuilder();
    const x = top.input('X');
    const inst = top.instance('d-a');
    const out = top.output('F');
    top.connect(x, inst, 0).connect(inst, out, 0);

    const r = buildTruthTable({
      circuit: top.build(),
      inputIds: [x],
      outputIds: [out],
      definitions: [d1, d2]
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('跨层循环引用');
  });
});

describe('含实例电路的布尔表达式与卡诺图', () => {
  it('多数表决实例的最简 SOP 为 AB+AC+BC（三项两文字）', () => {
    const def = majorityDef();
    const { circuit, inputs, output } = topInstanceCircuit(def.id, 3);
    const r = extractExpressions({
      circuit,
      inputIds: inputs,
      outputIds: [output],
      definitions: [def]
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const e = r.expressions[0];
      expect(e.minterms).toEqual([3, 5, 6, 7]);
      // 最简式由三个二文字项组成（顺序由化简器稳定字典序决定）
      const terms = e.minimal.split(' + ').map((t) => t.replace(/·/g, '')).sort();
      expect(terms).toEqual(['AB', 'AC', 'BC']);
    }
  });

  it('MY_AND 实例的卡诺图：唯一 1 格在 11，最简式 A·B', () => {
    const def = andDef();
    const { circuit, inputs, output } = topInstanceCircuit(def.id, 2);
    const r = buildKarnaugh({
      circuit,
      inputIds: inputs,
      outputId: output,
      definitions: [def]
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const ones = r.cells.filter((cell) => cell.value === 1).map((cell) => cell.minterm);
      expect(ones).toEqual([3]);
      expect(r.minimalExpression.replace(/·/g, '')).toBe('AB');
    }
  });
});

describe('关卡判定对含实例电路成立', () => {
  it('用自定义 MAJ3 器件搭第 4 关（多数表决）可以通过', () => {
    const def = majorityDef();
    const { circuit, inputs } = topInstanceCircuit(def.id, 3);
    const level = LEVELS.find((l) => l.id === 'majority3')!;

    const r = verifyLevel({ levelId: level.id, circuit, definitions: [def] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.passed).toBe(true);
      expect(r.mismatchCount).toBe(0);
    }
    void inputs;
  });

  it('自定义器件功能错误时不能靠结构蒙混：AND 器件去过 AND2 关会失败并给出错行', () => {
    // 做一个"长得像 AND、实际是 OR"的器件
    const wrong = andDef();
    const broken: DeviceDefinition = {
      ...wrong,
      id: 'def-wrong',
      name: 'WRONG',
      circuit: {
        ...wrong.circuit,
        components: wrong.circuit.components.map((c) =>
          c.type === 'AND' ? { ...c, type: 'OR' as const } : c
        )
      }
    };
    const { circuit } = topInstanceCircuit(broken.id, 2);
    const r = verifyLevel({ levelId: 'and2', circuit, definitions: [broken] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.passed).toBe(false);
      expect(r.mismatchCount).toBeGreaterThan(0);
    }
  });

  it('第 7 关半加器：用多输出自定义器件实例（S/C）逐行比对通过', () => {
    const hb = new CircuitBuilder();
    const a = hb.input('A');
    const c = hb.input('B', 0, 60);
    const xg = hb.gate('XOR', 200, 0);
    const ag = hb.gate('AND', 200, 80);
    const s = hb.output('S', 380, 0);
    const carry = hb.output('C', 380, 80);
    hb.connect(a, xg, 0).connect(c, xg, 1).connect(xg, s);
    hb.connect(a, ag, 0).connect(c, ag, 1).connect(ag, carry);
    const ha = makeDefinition({
      id: 'def-ha',
      name: 'HA',
      circuit: hb.build(),
      inputComponentIds: [a, c],
      outputComponentIds: [s, carry]
    });

    // 顶层两个开关 + 一个半加器实例 + 两个输出灯
    const tb = new CircuitBuilder();
    const ta = tb.input('A', 0, 0, 0);
    const tc = tb.input('B', 0, 0, 60);
    const inst = tb.instance(ha.id, 220, 20);
    const oS = tb.output('S', 420, 0);
    const oC = tb.output('C', 420, 80);
    tb.connect(ta, inst, 0).connect(tc, inst, 1);
    tb.connect(inst, oS, 0, 0).connect(inst, oC, 0, 1);

    const r = verifyLevel({ levelId: 'half-adder', circuit: tb.build(), definitions: [ha] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.passed).toBe(true);
  });
});
