/**
 * 分层电路（自定义器件）核心行为测试：
 *  - 单实例对外管脚 = 外部输入灌进内部电路求得的内部输出；
 *  - 多层嵌套实例求值正确、多输出管脚正确；
 *  - 定义间直接/间接循环引用在求值前被检测并拒绝（不靠爆栈）；
 *  - 层内反馈环（含绕经实例的）仍被检测；
 *  - 修改定义后所有实例的求值随之改变（定义共享语义）；
 *  - 悬空管脚的 null 传播、非法实例引用的结构校验。
 */
import { describe, expect, it } from 'vitest';
import { CircuitBuilder, evalProject, makeDefinition } from './helpers.js';
import {
  createHierarchyEngine,
  detectDefinitionCycle,
  validateDefinitions
} from '../src/core/hierarchy.js';
import { evaluate } from '../src/core/evaluate.js';
import { validateCircuit } from '../src/core/graph.js';
import type {
  Circuit,
  DeviceDefinition,
  Project
} from '../src/core/types.js';

/** 构造"二输入与"器件的内部电路与定义 */
function andGateDefinition(id = 'def-and', name = 'MY_AND') {
  const b = new CircuitBuilder();
  const a = b.input('A');
  const c = b.input('B', 0, 40);
  const g = b.gate('AND', 200, 10);
  const f = b.output('F', 360, 10);
  b.connect(a, g, 0).connect(c, g, 1).connect(g, f);
  return makeDefinition({
    id,
    name,
    circuit: b.build(),
    inputComponentIds: [a, c],
    outputComponentIds: [f]
  });
}

/** 顶层电路：两个外部开关 -> 单个实例 -> 输出灯 */
function topWithInstance(defId: string, values: [0 | 1, 0 | 1] = [0, 0]): {
  project: Project;
  inputs: string[];
  output: string;
} {
  const b = new CircuitBuilder();
  const a = b.input('X', values[0], 0, 0);
  const c = b.input('Y', values[1], 0, 60);
  const inst = b.instance(defId, 220, 10);
  const f = b.output('F', 400, 10);
  b.connect(a, inst, 0).connect(c, inst, 1).connect(inst, f, 0);
  return {
    project: { version: 2, circuit: b.build(), definitions: [] },
    inputs: [a, c],
    output: f
  };
}

describe('单实例跨层求值', () => {
  it('实例对外管脚值 = 外部输入灌进内部电路求得的内部输出（AND 四种组合）', () => {
    const def = andGateDefinition();
    const { project, inputs, output } = topWithInstance(def.id);
    project.definitions = [def];

    const cases: Array<[[0 | 1, 0 | 1], 0 | 1]> = [
      [[0, 0], 0],
      [[0, 1], 0],
      [[1, 0], 0],
      [[1, 1], 1]
    ];
    for (const [[x, y], expected] of cases) {
      const r = evalProject(project, { [inputs[0]]: x, [inputs[1]]: y });
      expect(r.outputs[output]).toBe(expected);
    }
  });

  it('实例与等价的扁平门逐行一致', () => {
    const def = andGateDefinition();
    const { project, inputs, output } = topWithInstance(def.id);
    project.definitions = [def];

    // 等价扁平电路
    const fb = new CircuitBuilder();
    const a = fb.input('X');
    const c = fb.input('Y', 0, 60);
    const g = fb.gate('AND');
    const f = fb.output('F');
    fb.connect(a, g, 0).connect(c, g, 1).connect(g, f);
    const flat = fb.build();

    for (let m = 0; m < 4; m++) {
      const vals = {
        [inputs[0]]: ((m >> 1) & 1) as 0 | 1,
        [inputs[1]]: (m & 1) as 0 | 1
      };
      const hr = evalProject(project, vals);
      const fr = evaluate(flat, vals);
      expect(fr.ok).toBe(true);
      if (fr.ok) expect(hr.outputs[output]).toBe(fr.outputs[f]);
    }
  });

  it('线值取实例输出端口信号，连线颜色依据不受封装影响', () => {
    const def = andGateDefinition();
    const { project } = topWithInstance(def.id, [1, 1]);
    project.definitions = [def];
    const r = evalProject(project);
    const wireFromInstance = project.circuit.wires.find(
      (w) => w.from.componentId === project.circuit.components.find((c) => c.type === 'SUB')!.id
    )!;
    expect(r.wireValues[wireFromInstance.id]).toBe(1);
  });

  it('同一定义放置多个实例，各实例输入互不影响、各自独立求值', () => {
    const def = andGateDefinition();
    const b = new CircuitBuilder();
    const a = b.input('A', 1);
    const c = b.input('B', 1, 0, 60);
    const d = b.input('C', 0, 0, 120);
    const e = b.input('D', 0, 0, 180);
    const i1 = b.instance(def.id, 220, 10);
    const i2 = b.instance(def.id, 220, 120);
    const f1 = b.output('F1', 400, 10);
    const f2 = b.output('F2', 400, 120);
    b.connect(a, i1, 0).connect(c, i1, 1).connect(i1, f1, 0);
    b.connect(d, i2, 0).connect(e, i2, 1).connect(i2, f2, 0);
    const project: Project = { version: 2, circuit: b.build(), definitions: [def] };
    const r = evalProject(project);
    expect(r.outputs[f1]).toBe(1); // A·B
    expect(r.outputs[f2]).toBe(0); // C·D
  });
});

describe('多层嵌套实例', () => {
  it('三层：XOR(XOR(A,B),C) 奇校验，实例里再放实例', () => {
    // 底层 XOR2 定义（直接用异或门）
    const xb = new CircuitBuilder();
    const xa = xb.input('A');
    const xc = xb.input('B', 0, 40);
    const xg = xb.gate('XOR', 200, 10);
    const xf = xb.output('F', 360, 10);
    xb.connect(xa, xg, 0).connect(xc, xg, 1).connect(xg, xf);
    const xorDef = makeDefinition({
      id: 'def-xor',
      name: 'MY_XOR',
      circuit: xb.build(),
      inputComponentIds: [xa, xc],
      outputComponentIds: [xf]
    });

    // 中层 PARITY3 定义：内部放两个 XOR2 实例
    const pb = new CircuitBuilder();
    const p0 = pb.input('A');
    const p1 = pb.input('B', 0, 40);
    const p2 = pb.input('C', 0, 80);
    const q1 = pb.instance(xorDef.id, 200, 10);
    const q2 = pb.instance(xorDef.id, 360, 30);
    const pf = pb.output('F', 540, 30);
    pb.connect(p0, q1, 0).connect(p1, q1, 1);
    pb.connect(q1, q2, 0).connect(p2, q2, 1);
    pb.connect(q2, pf, 0);
    const parityDef = makeDefinition({
      id: 'def-parity3',
      name: 'PARITY3',
      circuit: pb.build(),
      inputComponentIds: [p0, p1, p2],
      outputComponentIds: [pf]
    });

    // 顶层：一个 PARITY3 实例
    const tb = new CircuitBuilder();
    const t0 = tb.input('A');
    const t1 = tb.input('B', 0, 40);
    const t2 = tb.input('C', 0, 80);
    const inst = tb.instance(parityDef.id, 220, 20);
    const out = tb.output('F', 400, 20);
    tb.connect(t0, inst, 0).connect(t1, inst, 1).connect(t2, inst, 2).connect(inst, out, 0);
    const project: Project = {
      version: 2,
      circuit: tb.build(),
      definitions: [xorDef, parityDef]
    };

    const trace = [0, 1, 1, 0, 1, 0, 0, 1]; // A⊕B⊕C
    for (let m = 0; m < 8; m++) {
      const r = evalProject(project, {
        [t0]: ((m >> 2) & 1) as 0 | 1,
        [t1]: ((m >> 1) & 1) as 0 | 1,
        [t2]: (m & 1) as 0 | 1
      });
      expect(r.outputs[out]).toBe(trace[m]);
    }
  });

  it('多输出实例：半加器定义（S, C）两个输出管脚分别可接线', () => {
    const hb = new CircuitBuilder();
    const a = hb.input('A');
    const c = hb.input('B', 0, 60);
    const xg = hb.gate('XOR', 200, 0);
    const ag = hb.gate('AND', 200, 80);
    const s = hb.output('S', 380, 0);
    const carry = hb.output('C', 380, 80);
    hb.connect(a, xg, 0).connect(c, xg, 1).connect(xg, s);
    hb.connect(a, ag, 0).connect(c, ag, 1).connect(ag, carry);
    const halfAdder = makeDefinition({
      id: 'def-ha',
      name: 'HALF_ADDER',
      circuit: hb.build(),
      inputComponentIds: [a, c],
      outputComponentIds: [s, carry],
      outputNames: ['S', 'C']
    });

    const tb = new CircuitBuilder();
    const ta = tb.input('A', 1);
    const tc = tb.input('B', 1, 0, 60);
    const inst = tb.instance(halfAdder.id, 220, 20);
    const oS = tb.output('S', 420, 0);
    const oC = tb.output('C', 420, 80);
    // 输出端口 0=S 接 oS，端口 1=C 接 oC
    tb.connect(inst, oS, 0, 0).connect(inst, oC, 0, 1).connect(ta, inst, 0).connect(tc, inst, 1);
    const project: Project = { version: 2, circuit: tb.build(), definitions: [halfAdder] };

    const r = evalProject(project);
    expect(r.portOutputs[`${inst}:0`]).toBe(0); // 1 xor 1
    expect(r.portOutputs[`${inst}:1`]).toBe(1); // 1 and 1
    expect(r.outputs[oS]).toBe(0);
    expect(r.outputs[oC]).toBe(1);
  });

  it('悬空输入管脚按 null 跨层传播，不瞎给值', () => {
    const def = andGateDefinition();
    const b = new CircuitBuilder();
    const a = b.input('A', 1);
    const inst = b.instance(def.id);
    const f = b.output('F');
    // 只接了实例的第 0 个输入，第 1 个悬空
    b.connect(a, inst, 0).connect(inst, f, 0);
    const project: Project = { version: 2, circuit: b.build(), definitions: [def] };
    const r = evalProject(project);
    expect(r.outputs[f]).toBeNull();
  });
});

describe('跨层循环引用检测', () => {
  /** 造一个"内部只有输入、输出和一个 SUB 实例"的器件定义壳 */
  function shellDef(id: string, name: string, refId: string): DeviceDefinition {
    const b = new CircuitBuilder();
    const a = b.input('A');
    const c = b.input('B', 0, 40);
    const inst = b.instance(refId, 200, 10);
    const f = b.output('F', 380, 10);
    b.connect(a, inst, 0);
    // ref 器件可能只有一个输入：第二个输入悬空也允许
    b.connect(inst, f, 0);
    return makeDefinition({
      id,
      name,
      circuit: b.build(),
      inputComponentIds: [a, c],
      outputComponentIds: [f]
    });
  }

  it('直接自引用（甲的定义里放甲实例）被检测并报 definition-cycle', () => {
    const def = shellDef('d-self', 'SELF', 'd-self');
    const cycle = detectDefinitionCycle([def]);
    expect(cycle).not.toBeNull();
    expect(cycle![0]).toBe('d-self');
    expect(cycle![cycle!.length - 1]).toBe('d-self');

    const created = createHierarchyEngine([def]);
    expect(created.ok).toBe(false);
    if (!created.ok) {
      expect(created.error.kind).toBe('definition-cycle');
      expect(created.error.message).toContain('跨层循环引用');
    }
  });

  it('间接循环（甲→乙→甲）被检测，错误路径给出甲、乙', () => {
    // 甲引用乙，乙引用甲（各只需要 1 个输入能接上；壳默认 2 输入，第二个悬空无妨）
    const jia = shellDef('d-jia', 'JIA', 'd-yi');
    const yi = shellDef('d-yi', 'YI', 'd-jia');
    const cycle = detectDefinitionCycle([jia, yi]);
    expect(cycle).not.toBeNull();
    expect(new Set(cycle!)).toEqual(new Set(['d-jia', 'd-yi']));

    const created = createHierarchyEngine([jia, yi]);
    expect(created.ok).toBe(false);
    if (!created.ok && created.error.kind === 'definition-cycle') {
      expect(created.error.path).toContain('d-jia');
      expect(created.error.path).toContain('d-yi');
      expect(created.error.message).toContain('JIA');
      expect(created.error.message).toContain('YI');
    }
  });

  it('三环互引（甲→乙→丙→甲）被检测', () => {
    const jia = shellDef('d-jia', 'JIA', 'd-yi');
    const yi = shellDef('d-yi', 'YI', 'd-bing');
    const bing = shellDef('d-bing', 'BING', 'd-jia');
    const cycle = detectDefinitionCycle([jia, yi, bing]);
    expect(cycle).not.toBeNull();
    expect(new Set(cycle!)).toEqual(new Set(['d-jia', 'd-yi', 'd-bing']));
  });

  it('无循环引用的嵌套定义不被误报', () => {
    const base = andGateDefinition('d-and', 'AND2');
    // 上层引用底层，无回边
    const upper = shellDef('d-upper', 'UPPER', 'd-and');
    expect(detectDefinitionCycle([base, upper])).toBeNull();
    expect(createHierarchyEngine([base, upper]).ok).toBe(true);
  });

  it('每层内部无环但跨层成环时，即使顶层没有实例，引擎创建阶段就拒绝（不求值、不爆栈）', () => {
    const jia = shellDef('d-jia', 'JIA', 'd-yi');
    const yi = shellDef('d-yi', 'YI', 'd-jia');
    // 顶层就是一个普通扁平电路
    const top: Circuit = new CircuitBuilder().build();
    const project: Project = { version: 2, circuit: top, definitions: [jia, yi] };
    const created = createHierarchyEngine(project.definitions);
    expect(created.ok).toBe(false);
  });
});

describe('层内反馈环在分层模型下继续成立', () => {
  it('顶层扁平反馈环照旧被 Kahn 检测', () => {
    const b = new CircuitBuilder();
    const a = b.input('A');
    const g = b.gate('AND');
    const f = b.output('F');
    b.connect(a, g, 0).connect(g, g, 1).connect(g, f);
    const created = createHierarchyEngine([]);
    expect(created.ok).toBe(true);
    const r = created.ok ? created.engine.evaluate(b.build()) : null;
    expect(r?.ok).toBe(false);
    if (r && !r.ok) {
      expect(r.error.kind).toBe('cycle');
      if (r.error.kind === 'cycle') expect(r.error.path).toContain(g);
    }
  });

  it('反馈环穿过实例（实例输出绕回驱动同一实例输入）在所在层被检测', () => {
    const def = andGateDefinition();
    const b = new CircuitBuilder();
    const a = b.input('A');
    const inst = b.instance(def.id);
    const f = b.output('F');
    b.connect(a, inst, 0);
    // 实例输出 0 绕回自己的输入 1 —— 外层元件图上 inst -> inst 自环
    b.connect(inst, inst, 1, 0);
    b.connect(inst, f, 0);
    const project: Project = { version: 2, circuit: b.build(), definitions: [def] };
    const created = createHierarchyEngine([def]);
    expect(created.ok).toBe(true);
    const r = created.ok ? created.engine.evaluate(project.circuit) : null;
    expect(r?.ok).toBe(false);
    if (r && !r.ok) expect(r.error.kind).toBe('cycle');
  });

  it('器件定义内部的反馈环在该实例被求值时冒泡成 cycle 错误', () => {
    // 定义内部：NOT 输出绕回自身输入（悬空输入也无妨，环先被抓到）
    const b = new CircuitBuilder();
    const ng = b.gate('NOT', 200, 0);
    const f = b.output('F', 360, 0);
    b.connect(ng, ng, 0).connect(ng, f);
    const badDef = makeDefinition({
      id: 'def-bad',
      name: 'BAD_LOOP',
      circuit: b.build(),
      inputComponentIds: [],
      outputComponentIds: [f]
    });

    const tb = new CircuitBuilder();
    const inst = tb.instance(badDef.id);
    const out = tb.output('F');
    tb.connect(inst, out, 0);
    const created = createHierarchyEngine([badDef]);
    expect(created.ok).toBe(true);
    const r = created.ok ? created.engine.evaluate(tb.build()) : null;
    expect(r?.ok).toBe(false);
    if (r && !r.ok) expect(r.error.kind).toBe('cycle');
  });
});

describe('定义共享：改定义，所有实例随之更新', () => {
  it('把 AND 定义改成 OR 后，两个实例的输出同时改变', () => {
    const def = andGateDefinition();
    const b = new CircuitBuilder();
    const a = b.input('A', 1);
    const c = b.input('B', 0, 0, 60);
    const i1 = b.instance(def.id, 220, 0);
    const i2 = b.instance(def.id, 220, 100);
    const f1 = b.output('F1', 400, 0);
    const f2 = b.output('F2', 400, 100);
    b.connect(a, i1, 0).connect(c, i1, 1).connect(i1, f1, 0);
    b.connect(a, i2, 0).connect(c, i2, 1).connect(i2, f2, 0);
    const circuit = b.build();

    const before = evalProject({ version: 2, circuit, definitions: [def] });
    expect(before.outputs[f1]).toBe(0);
    expect(before.outputs[f2]).toBe(0);

    // 修改定义：把内部 AND 门替换成 OR —— 实例本身一律不动
    const updated: DeviceDefinition = {
      ...def,
      circuit: {
        ...def.circuit,
        components: def.circuit.components.map((x) =>
          x.type === 'AND' ? { ...x, type: 'OR' as const } : x
        )
      }
    };
    const after = evalProject({ version: 2, circuit, definitions: [updated] });
    expect(after.outputs[f1]).toBe(1); // 1 OR 0
    expect(after.outputs[f2]).toBe(1);
  });
});

describe('实例结构校验', () => {
  it('没有定义库时画布上出现 SUB 直接结构非法', () => {
    const b = new CircuitBuilder();
    const inst = b.instance('missing');
    const f = b.output('F');
    b.connect(inst, f, 0);
    expect(validateCircuit(b.build())).not.toBeNull();
    const r = evaluate(b.build());
    expect(r.ok).toBe(false);
  });

  it('实例引用了不存在的 deviceId 被拒绝', () => {
    const b = new CircuitBuilder();
    const inst = b.instance('ghost');
    const f = b.output('F');
    b.connect(inst, f, 0);
    const created = createHierarchyEngine([]);
    expect(created.ok).toBe(true);
    const r = created.ok ? created.engine.evaluate(b.build()) : null;
    expect(r?.ok).toBe(false);
    if (r && !r.ok) {
      expect(r.error.kind).toBe('validation');
      expect(r.error.message).toContain('ghost');
    }
    void inst;
  });

  it('定义缺少输出管脚 / 管脚绑错元件类型时被拒绝', () => {
    const b = new CircuitBuilder();
    const a = b.input('A');
    const g = b.gate('NOT');
    const f = b.output('F');
    b.connect(a, g).connect(g, f);
    const circuit = b.build();

    const noOutput = makeDefinition({
      id: 'd1',
      name: 'NO_OUT',
      circuit,
      inputComponentIds: [a],
      outputComponentIds: []
    });
    expect(validateDefinitions([noOutput])?.message).toContain('输出管脚');

    const wrongPin = makeDefinition({
      id: 'd2',
      name: 'WRONG_PIN',
      circuit,
      inputComponentIds: [a],
      outputComponentIds: [g] // g 是门，不是 OUTPUT
    });
    expect(validateDefinitions([wrongPin])?.message).toContain('输出指示灯');
  });
});
