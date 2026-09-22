/**
 * 分层电路（自定义器件）核心行为测试：
 *  1. 单实例：对外管脚值 == 把外部输入灌进内部电路求得的内部输出；
 *  2. 多输出管脚逐端口取值；
 *  3. 多层嵌套实例求值正确；
 *  4. 同一定义摆多个实例，互不影响；
 *  5. 定义之间直接/间接循环引用在求值前被检测并拒绝（不爆栈）；
 *  6. 定义内部的层内反馈环仍被检测；顶层层内反馈环不退化；
 *  7. 修改一个定义后，全部实例的求值随之改变（共享定义语义）；
 *  8. 悬空管脚跨层传播 null；
 *  9. 含实例电路的真值表逐行正确（表达式/卡诺图经由同一内核，单独抽查）；
 * 10. 关卡判定对含实例电路照常逐行比对；
 * 11. 旧版纯扁平电路文件读入后行为与升级前一致（normalizeProject + evaluate）。
 */
import { describe, expect, it } from 'vitest';
import { CircuitBuilder, makeDefinition, outputTraceWithDefs } from './helpers.js';
import { evaluate, evaluateProject } from '../src/core/evaluate.js';
import {
  findDefinitionCycle,
  normalizeProject,
  validateDefinitions
} from '../src/core/definitions.js';
import { buildTruthTable } from '../src/core/truthTable.js';
import { extractExpressions } from '../src/core/expression.js';
import { buildKarnaugh } from '../src/core/karnaugh.js';
import { verifyLevel } from '../src/core/levels.js';
import type { Circuit, DeviceDefinition } from '../src/core/types.js';

/** 内部电路：Y = A XOR B（半加器和位） */
function xorGateDefinition(id = 'xor2', name = '我的异或'): DeviceDefinition {
  const b = new CircuitBuilder();
  const a = b.input('A', 0, 0, 20);
  const c = b.input('B', 0, 0, 80);
  const g = b.gate('XOR', 200, 40);
  const y = b.output('Y', 400, 40);
  b.connect(a, g, 0).connect(c, g, 1).connect(g, y);
  return makeDefinition(id, name, b.build(), [{ id: a }, { id: c }], [{ id: y }]);
}

/** 内部电路：S = A XOR B，Co = A AND B（半加器，双输出） */
function halfAdderDefinition(): DeviceDefinition {
  const b = new CircuitBuilder();
  const a = b.input('A', 0, 0, 20);
  const c = b.input('B', 0, 0, 90);
  const x = b.gate('XOR', 200, 20);
  const an = b.gate('AND', 200, 100);
  const s = b.output('S', 400, 20);
  const co = b.output('Co', 400, 100);
  b.connect(a, x, 0).connect(c, x, 1).connect(x, s);
  b.connect(a, an, 0).connect(c, an, 1).connect(an, co);
  return makeDefinition('ha', '半加器', b.build(), [{ id: a }, { id: c }], [
    { id: s },
    { id: co }
  ]);
}

/** 顶层：两个开关接一个 CUSTOM 实例再接输出灯 */
function topWithInstance(def: DeviceDefinition): {
  circuit: Circuit;
  inputs: string[];
  output: string;
  instance: string;
} {
  const b = new CircuitBuilder();
  const a = b.input('A', 0, 0, 20);
  const c = b.input('B', 0, 0, 90);
  const inst = b.instance(def.id, 220, 30);
  const f = b.output('F', 460, 50);
  b.connect(a, inst, 0).connect(c, inst, 1).connect(inst, f, 0);
  return { circuit: b.build(), inputs: [a, c], output: f, instance: inst };
}

describe('单实例跨层求值', () => {
  it('实例对外输出 == 外部输入灌入内部电路的内部输出（四种组合逐行）', () => {
    const def = xorGateDefinition();
    const { circuit, inputs, output } = topWithInstance(def);

    expect(outputTraceWithDefs(circuit, inputs, output, [def])).toEqual([0, 1, 1, 0]);
  });

  it('直接给定开关值时输出即时正确，且 instanceOutputs 记录管脚值', () => {
    const def = xorGateDefinition();
    const { circuit, inputs, instance } = topWithInstance(def);
    const r = evaluate(circuit, { [inputs[0]]: 1, [inputs[1]]: 0 }, [def]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.instanceOutputs[instance]).toEqual([1]);
      expect(r.outputs[instance]).toBe(1); // outputs 映射给主输出管脚
    }
  });

  it('多输出管脚：半加器 S 与 Co 分别落在端口 0/1，连线按端口取值', () => {
    const def = halfAdderDefinition();
    const b = new CircuitBuilder();
    const a = b.input('A', 0, 0, 20);
    const c = b.input('B', 0, 0, 90);
    const inst = b.instance(def.id, 220, 20);
    const sLamp = b.output('S', 460, 20);
    const coLamp = b.output('Co', 460, 110);
    b.connect(a, inst, 0)
      .connect(c, inst, 1)
      .connectFrom(inst, 0, sLamp, 0)
      .connectFrom(inst, 1, coLamp, 0);
    const circuit = b.build();

    for (const [av, bv, s, co] of [
      [0, 0, 0, 0],
      [1, 0, 1, 0],
      [0, 1, 1, 0],
      [1, 1, 0, 1]
    ] as const) {
      const r = evaluate(circuit, { [a]: av, [c]: bv }, [def]);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.outputs[sLamp]).toBe(s);
        expect(r.outputs[coLamp]).toBe(co);
        expect(r.instanceOutputs[inst]).toEqual([s, co]);
      }
    }
  });

  it('实例某输入管脚悬空 -> 内部对应输入为 null -> 输出未确定（不瞎给值）', () => {
    const def = xorGateDefinition();
    const b = new CircuitBuilder();
    const a = b.input('A');
    const inst = b.instance(def.id);
    const f = b.output('F');
    b.connect(a, inst, 0).connect(inst, f); // 管脚 1 悬空
    const r = evaluate(b.build(), { [a]: 1 }, [def]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.outputs[f]).toBeNull();
  });
});

describe('多实例与共享定义', () => {
  it('同一定义摆放两个实例，各自接线、各自求值，互不影响', () => {
    const def = xorGateDefinition();
    const b = new CircuitBuilder();
    const a = b.input('A', 0, 0, 0);
    const c = b.input('B', 0, 0, 40);
    const d = b.input('C', 0, 0, 120);
    const e = b.input('D', 0, 0, 160);
    const i1 = b.instance(def.id, 220, 0);
    const i2 = b.instance(def.id, 220, 120);
    const f1 = b.output('F1', 460, 10);
    const f2 = b.output('F2', 460, 130);
    b.connect(a, i1, 0).connect(c, i1, 1).connect(i1, f1);
    b.connect(d, i2, 0).connect(e, i2, 1).connect(i2, f2);
    const circuit = b.build();

    // F1 = A^B, F2 = C^D，逐行独立
    const r = evaluate(circuit, { [a]: 1, [c]: 0, [d]: 1, [e]: 1 }, [def]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.outputs[f1]).toBe(1);
      expect(r.outputs[f2]).toBe(0);
      expect(r.outputs[i1]).not.toBe(r.outputs[i2]);
    }
  });

  it('修改定义后，引用它的全部实例求值随之改变（不是各改各的副本）', () => {
    const def = xorGateDefinition();
    const top = topWithInstance(def).circuit;
    const r1 = evaluate(top, undefined, [def]);
    expect(r1.ok).toBe(true);

    // 把定义内部的 XOR 改成 AND：所有实例立刻变成与语义
    def.name = '我的与门';
    def.circuit.components = def.circuit.components.map((x) =>
      x.type === 'XOR' ? { ...x, type: 'AND' as const } : x
    );
    const r2 = evaluate(top, undefined, [def]);
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      // 默认开关都为 0 时 AND=0；枚举验证整条真值表已变成与
      // （直接重搭一个顶层枚举）
    }
    const { circuit, inputs, output } = topWithInstance(def);
    expect(outputTraceWithDefs(circuit, inputs, output, [def])).toEqual([0, 0, 0, 1]);
  });

  it('定义里再嵌套另一个自定义器件：用两个"异或定义"搭三输入奇校验', () => {
    const xor2 = xorGateDefinition();
    // 上层定义 XOR3：内部放两个 xor2 实例级联
    const b = new CircuitBuilder();
    const a = b.input('A', 0, 0, 0);
    const c = b.input('B', 0, 0, 60);
    const d = b.input('C', 0, 0, 140);
    const i1 = b.instance(xor2.id, 200, 20);
    const i2 = b.instance(xor2.id, 360, 60);
    const f = b.output('F', 520, 70);
    b.connect(a, i1, 0)
      .connect(c, i1, 1)
      .connectFrom(i1, 0, i2, 0)
      .connect(d, i2, 1)
      .connectFrom(i2, 0, f, 0);
    const xor3 = makeDefinition('xor3', '三输入异或', b.build(), [
      { id: a },
      { id: c },
      { id: d }
    ], [{ id: f }]);

    const defs = [xor2, xor3];
    const top = new CircuitBuilder();
    const t1 = top.input('A', 0, 0, 0);
    const t2 = top.input('B', 0, 0, 50);
    const t3 = top.input('C', 0, 0, 100);
    const inst = top.instance(xor3.id, 240, 40);
    const out = top.output('F', 480, 60);
    top.connect(t1, inst, 0).connect(t2, inst, 1).connect(t3, inst, 2).connect(inst, out);

    expect(outputTraceWithDefs(top.build(), [t1, t2, t3], out, defs)).toEqual([
      0, 1, 1, 0, 1, 0, 0, 1
    ]);
  });

  it('三层以上深嵌套同样逐层递归到底，结果正确', () => {
    const xor2 = xorGateDefinition('xor2', '异或2');
    // xor4 用两个 xor3 风格：直接构造 xor3 内联 xor2，再 xor4 内联 xor3
    const buildXor3 = () => {
      const b = new CircuitBuilder();
      const a = b.input('A', 0, 0, 0);
      const c = b.input('B', 0, 0, 60);
      const d = b.input('C', 0, 0, 140);
      const i1 = b.instance('xor2', 200, 20);
      const i2 = b.instance('xor2', 360, 60);
      const f = b.output('F', 520, 70);
      b.connect(a, i1, 0).connect(c, i1, 1);
      b.connectFrom(i1, 0, i2, 0).connect(d, i2, 1).connectFrom(i2, 0, f, 0);
      return makeDefinition('xor3', '异或3', b.build(), [{ id: a }, { id: c }, { id: d }], [{ id: f }]);
    };
    const xor3 = buildXor3();
    const b4 = new CircuitBuilder();
    const p = [b4.input('A', 0, 0, 0), b4.input('B', 0, 0, 50), b4.input('C', 0, 0, 100), b4.input('D', 0, 0, 150)];
    const g1 = b4.instance('xor3', 220, 30);
    const g2 = b4.instance('xor2', 420, 80);
    const f = b4.output('F', 600, 90);
    b4.connect(p[0], g1, 0).connect(p[1], g1, 1).connect(p[2], g1, 2);
    b4.connectFrom(g1, 0, g2, 0).connect(p[3], g2, 1).connectFrom(g2, 0, f, 0);
    const xor4 = makeDefinition('xor4', '异或4', b4.build(), p.map((id) => ({ id })), [{ id: f }]);

    const top = new CircuitBuilder();
    const t = [0, 1, 2, 3].map((i) => top.input(String.fromCharCode(65 + i), 0, 0, i * 50));
    const inst = top.instance('xor4', 240, 60);
    const out = top.output('F', 500, 80);
    t.forEach((id, i) => top.connect(id, inst, i));
    top.connect(inst, out);

    const defs = [xor2, xor3, xor4];
    const expected = Array.from({ length: 16 }, (_, m) => {
      const ones = m.toString(2).split('').filter((x) => x === '1').length;
      return (ones % 2) as 0 | 1;
    });
    expect(outputTraceWithDefs(top.build(), t, out, defs)).toEqual(expected);
  });
});

describe('跨层循环引用检测', () => {
  /** 单输入单输出壳定义：内部放一个 ref 实例透传 */
  const shell = (id: string, name: string, ref: string): DeviceDefinition => {
    const b = new CircuitBuilder();
    const a = b.input('A');
    const inst = b.instance(ref, 200, 20);
    const f = b.output('F');
    b.connect(a, inst, 0).connect(inst, f);
    return makeDefinition(id, name, b.build(), [{ id: a }], [{ id: f }]);
  };

  /** 单输入顶层：开关 -> 某定义实例 -> 输出灯 */
  const top1 = (defId: string): Circuit => {
    const b = new CircuitBuilder();
    const a = b.input('A');
    const inst = b.instance(defId, 200, 20);
    const f = b.output('F');
    b.connect(a, inst, 0).connect(inst, f);
    return b.build();
  };

  it('直接互引用：甲里放乙、乙里放甲，求值前被拒（绝不递归爆栈）', () => {
    const alpha = shell('alpha', '甲', 'beta');
    const beta = shell('beta', '乙', 'alpha');

    const cycle = findDefinitionCycle([alpha, beta]);
    expect(cycle).not.toBeNull();
    expect(new Set(cycle!.slice(0, -1))).toEqual(new Set(['alpha', 'beta']));
    expect(cycle![0]).toBe(cycle![cycle!.length - 1]); // 首尾闭合

    const r = evaluate(top1('alpha'), undefined, [alpha, beta]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('definition-cycle');
  });

  it('间接环：甲->乙->丙->甲 也被检测，错误信息点名全部定义', () => {
    const alpha = shell('alpha', '甲', 'beta');
    const beta = shell('beta', '乙', 'gamma');
    const gamma = shell('gamma', '丙', 'alpha');

    const cycle = findDefinitionCycle([alpha, beta, gamma]);
    expect(cycle).not.toBeNull();
    expect(new Set(cycle!.slice(0, -1))).toEqual(new Set(['alpha', 'beta', 'gamma']));

    const r = evaluate(top1('alpha'), undefined, [alpha, beta, gamma]);
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === 'definition-cycle') {
      expect(r.error.message).toContain('循环引用');
      expect(r.error.message).toContain('甲');
    }
  });

  it('自引用：定义内部直接放自己的实例，被检测', () => {
    const rec = shell('rec', '递归器', 'rec');
    expect(findDefinitionCycle([rec])).toEqual(['rec', 'rec']);
    const r = evaluate(top1('rec'), undefined, [rec]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('definition-cycle');
  });

  it('无环的菱形依赖（甲用乙、丙，乙丙都用丁）不误报', () => {
    // d 是底层异或；b、c 各用 d；a 用 b、c
    const d = xorGateDefinition('d', '丁');
    const wrap = (id: string, name: string, ref: string): DeviceDefinition => {
      const b = new CircuitBuilder();
      const a = b.input('A', 0, 0, 20);
      const c = b.input('B', 0, 0, 90);
      const inst = b.instance(ref, 200, 40);
      const f = b.output('F', 400, 40);
      b.connect(a, inst, 0).connect(c, inst, 1).connect(inst, f);
      return makeDefinition(id, name, b.build(), [{ id: a }, { id: c }], [{ id: f }]);
    };
    const bDef = wrap('b', '乙', 'd');
    const cDef = wrap('c', '丙', 'd');
    // 甲用乙、丙各一个实例，输出再异或（内部门 + 实例混合）
    const mb = new CircuitBuilder();
    const ai = mb.input('A', 0, 0, 20);
    const ci = mb.input('B', 0, 0, 90);
    const ib = mb.instance('b', 180, 10);
    const ic = mb.instance('c', 180, 110);
    const g = mb.gate('XOR', 380, 60);
    const f = mb.output('F', 520, 60);
    mb.connect(ai, ib, 0).connect(ci, ib, 1);
    mb.connect(ai, ic, 0).connect(ci, ic, 1);
    mb.connectFrom(ib, 0, g, 0).connectFrom(ic, 0, g, 1).connect(g, f);
    const aDef = makeDefinition('a', '甲', mb.build(), [{ id: ai }, { id: ci }], [{ id: f }]);

    const defs = [d, bDef, cDef, aDef];
    expect(findDefinitionCycle(defs)).toBeNull();
    expect(validateDefinitions(defs)).toBeNull();
    // 甲 = (A^B) ^ (A^B) = 0：求值到底恒 0
    const { circuit, inputs, output } = topWithInstance(aDef);
    expect(outputTraceWithDefs(circuit, inputs, output, defs)).toEqual([0, 0, 0, 0]);
  });
});

describe('层内反馈环在分层模型中继续成立', () => {
  it('顶层把输出绕回输入仍是 cycle（不因为加了分层而漏掉）', () => {
    const def = xorGateDefinition();
    const b = new CircuitBuilder();
    const a = b.input('A');
    const inst = b.instance(def.id, 200, 20);
    const f = b.output('F');
    b.connect(a, inst, 0);
    b.connectFrom(inst, 0, inst, 1); // 实例输出回灌自己的另一输入
    b.connect(inst, f);
    const r = evaluate(b.build(), undefined, [def]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('cycle');
      if (r.error.kind === 'cycle') {
        expect(r.error.path).toContain(inst);
        expect(r.error.layer).toBeNull();
      }
    }
  });

  it('反馈环藏在器件定义内部：定位到具体定义并返回层内环路径', () => {
    // 定义内部两个 NOT 互相环接即可成环；暴露的输入开关 A 不参与该环（允许悬空未用）
    const b = new CircuitBuilder();
    const n1 = b.gate('NOT', 180, 0);
    const n2 = b.gate('NOT', 320, 80);
    const a = b.input('A', 0, 0, 160);
    const f = b.output('F', 480, 60);
    b.connect(n1, n2, 0).connect(n2, n1, 0).connect(n2, f);
    const bad = makeDefinition('osc', '振荡器', b.build(), [{ id: a }], [{ id: f }]);

    const top = new CircuitBuilder();
    const tA = top.input('A');
    const inst = top.instance('osc', 200, 20);
    const tF = top.output('F');
    top.connect(tA, inst, 0).connect(inst, tF);

    const r = evaluate(top.build(), undefined, [bad]);
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === 'cycle') {
      expect(r.error.layer).toBe('osc');
      expect(new Set(r.error.path)).toEqual(new Set([n1, n2]));
    }
  });
});

describe('含实例电路的分析能力不退化', () => {
  it('真值表：封装后的异或与直接用门的异或逐行一致', () => {
    const def = xorGateDefinition();
    const { circuit, inputs, output } = topWithInstance(def);
    const tt = buildTruthTable({
      circuit,
      inputIds: inputs,
      outputIds: [output],
      definitions: [def]
    });
    expect(tt.ok).toBe(true);
    if (tt.ok) {
      expect(tt.rows.map((r) => r.outputs[0])).toEqual([0, 1, 1, 0]);
      expect(tt.variables).toEqual(['A', 'B']);
    }
  });

  it('SOP 表达式：实例电路输出为 A⊕B，最简式含两个最小项', () => {
    const def = xorGateDefinition();
    const { circuit, inputs, output } = topWithInstance(def);
    const expr = extractExpressions({
      circuit,
      inputIds: inputs,
      outputIds: [output],
      definitions: [def]
    });
    expect(expr.ok).toBe(true);
    if (expr.ok) {
      expect(expr.expressions[0].minterms).toEqual([1, 2]);
      expect(expr.expressions[0].minimal).toContain('+');
    }
  });

  it('卡诺图：实例电路同样生成 2 变量 1 值格 m1、m2', () => {
    const def = xorGateDefinition();
    const { circuit, inputs, output } = topWithInstance(def);
    const km = buildKarnaugh({
      circuit,
      inputIds: inputs,
      outputId: output,
      definitions: [def]
    });
    expect(km.ok).toBe(true);
    if (km.ok) {
      expect(km.cells.filter((c) => c.value === 1).map((c) => c.minterm).sort()).toEqual([1, 2]);
      expect(km.groups.length).toBe(2);
    }
  });

  it('关卡判定：用自定义器件搭的异或电路能通过"异或"关', () => {
    const def = xorGateDefinition();
    const { circuit } = topWithInstance(def);
    const r = verifyLevel({
      levelId: 'xor-from-universal',
      circuit,
      definitions: [def]
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.passed).toBe(true);
      expect(r.mismatchCount).toBe(0);
    }
  });
});

describe('旧版纯扁平工程兼容', () => {
  it('normalizeProject 接受裸 {components, wires}，definitions 为空', () => {
    const legacy = { components: [], wires: [] };
    const norm = normalizeProject(legacy);
    expect(norm.ok).toBe(true);
    if (norm.ok) {
      expect(norm.project.version).toBe(2);
      expect(norm.project.definitions).toEqual([]);
      expect(norm.project.circuit.components).toEqual([]);
    }
  });

  it('旧扁平文件读入后，求值与升级前完全一致', () => {
    const b = new CircuitBuilder();
    const a = b.input('A', 1, 0, 0);
    const c = b.input('B', 0, 0, 50);
    const g = b.gate('XOR', 220, 20);
    const f = b.output('F', 400, 20);
    b.connect(a, g, 0).connect(c, g, 1).connect(g, f);
    const legacyDoc = b.build(); // 旧文件：没有 version、没有 definitions

    // 模拟"存成 JSON 再读回来"
    const norm = normalizeProject(JSON.parse(JSON.stringify(legacyDoc)));
    expect(norm.ok).toBe(true);
    if (!norm.ok) throw new Error('归一化失败');

    // 路径一：evaluateProject
    const r1 = evaluateProject(norm.project, { [a]: 1, [c]: 1 });
    // 路径二：旧式直接 evaluate(circuit)
    const r2 = evaluate(legacyDoc, { [a]: 1, [c]: 1 });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r1.outputs[f]).toBe(0);
      expect(r1.outputs).toEqual(r2.outputs);
      expect(r1.wireValues).toEqual(r2.wireValues);
    }

    // 完整穷举也一致
    expect(
      outputTraceWithDefs(norm.project.circuit, [a, c], f, norm.project.definitions)
    ).toEqual([0, 1, 1, 0]);
  });

  it('带定义的 v2 工程 JSON 往返：定义、实例、管脚映射全部保留并照常求值', () => {
    const def = xorGateDefinition();
    const { circuit, inputs, output } = topWithInstance(def);
    const project = { version: 2 as const, circuit, definitions: [def] };

    const restored = JSON.parse(JSON.stringify(project));
    const norm = normalizeProject(restored);
    expect(norm.ok).toBe(true);
    if (!norm.ok) throw new Error('归一化失败');
    expect(norm.project.definitions).toHaveLength(1);
    expect(norm.project.definitions[0].name).toBe('我的异或');
    expect(
      outputTraceWithDefs(norm.project.circuit, inputs, output, norm.project.definitions)
    ).toEqual([0, 1, 1, 0]);
  });

  it('定义校验：管脚指向不存在的内部元件时拒绝', () => {
    const good = xorGateDefinition();
    const bad: DeviceDefinition = {
      ...good,
      inputs: [{ id: 'bad-pin', componentId: 'not-exist' }]
    };
    const v = validateDefinitions([bad]);
    expect(v).not.toBeNull();
    expect(v?.message).toContain('内部元件不存在');
  });
});
