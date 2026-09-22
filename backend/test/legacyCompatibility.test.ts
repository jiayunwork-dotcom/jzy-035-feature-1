/**
 * 旧工程兼容测试：
 * 升级前保存的纯扁平电路文件（只有 {components, wires}，没有任何器件定义、
 * 没有实例），经归一化读入后必须与升级前行为完全一致 —— 求值、真值表、
 * 表达式、卡诺图、关卡全部照旧，不能因为数据模型扩展而打不开或算错。
 */
import { describe, expect, it } from 'vitest';
import { CircuitBuilder, outputTrace } from './helpers.js';
import { normalizeProject, serializeProject } from '../src/core/serialization.js';
import { evaluate } from '../src/core/evaluate.js';
import { buildTruthTable } from '../src/core/truthTable.js';
import { verifyLevel } from '../src/core/levels.js';
import type { Circuit } from '../src/core/types.js';

function legacyFlatCircuit(): Circuit {
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
  return b.build();
}

describe('旧版纯扁平工程文件读入', () => {
  it('归一化：{components,wires} 被识别为 legacy，definitions 为空数组', () => {
    const circuit = legacyFlatCircuit();
    const text = JSON.stringify(circuit); // 旧版保存格式
    const r = normalizeProject(JSON.parse(text));
    expect(r.error).toBeUndefined();
    expect(r.legacy).toBe(true);
    expect(r.project.definitions).toEqual([]);
    expect(r.project.version).toBe(2);
    expect(r.project.circuit.components).toHaveLength(circuit.components.length);
    expect(r.project.circuit.wires).toHaveLength(circuit.wires.length);
  });

  it('归一化后的工程逐行求值与旧文件直接扁平求值完全一致', () => {
    const circuit = legacyFlatCircuit();
    const inputs = circuit.components.filter((c) => c.type === 'INPUT').map((c) => c.id);
    const output = circuit.components.find((c) => c.type === 'OUTPUT')!.id;

    const legacyTrace = outputTrace(circuit, inputs, output);

    const normalized = normalizeProject(JSON.parse(JSON.stringify(circuit))).project;
    // 空定义库 + 跨层引擎，结果必须与扁平 evaluate 相同
    const tt = buildTruthTable({
      circuit: normalized.circuit,
      inputIds: inputs,
      outputIds: [output],
      definitions: normalized.definitions
    });
    expect(tt.ok).toBe(true);
    if (tt.ok) {
      expect(tt.rows.map((r) => r.outputs[0])).toEqual(legacyTrace);
    }

    // 开关值也保留，单次求值结果与升级前一致
    const direct = evaluate(circuit);
    expect(direct.ok).toBe(true);
    if (direct.ok) expect(direct.outputs[output]).toBe(legacyTrace[3]);
  });

  it('旧文件不带 definitions 提交所有分析接口都正常（关卡逐行判定）', () => {
    // 用扁平门搭一个二输入与
    const b = new CircuitBuilder();
    const a = b.input('A');
    const c = b.input('B', 0, 50);
    const g = b.gate('AND', 200, 20);
    const f = b.output('F', 360, 20);
    b.connect(a, g, 0).connect(c, g, 1).connect(g, f);

    // 模拟"旧前端"：请求体里完全不带 definitions 字段
    const r = verifyLevel({ levelId: 'and2', circuit: b.build() });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.passed).toBe(true);
  });

  it('旧文件含反馈环时仍按旧逻辑报 cycle', () => {
    const b = new CircuitBuilder();
    const g1 = b.gate('NOT', 200, 0);
    const g2 = b.gate('NOT', 320, 80);
    b.connect(g1, g2, 0).connect(g2, g1, 0);
    const normalized = normalizeProject(b.build()).project;
    const r = evaluate(normalized.circuit);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('cycle');
  });

  it('新版工程往返序列化不丢定义；新版格式不会被误判为 legacy', () => {
    const circuit = legacyFlatCircuit();
    const project = {
      version: 2 as const,
      circuit,
      definitions: [
        {
          id: 'd1',
          name: 'D1',
          inputPins: [],
          outputPins: [{ componentId: 'x', name: 'O' }],
          circuit: { components: [], wires: [] }
        }
      ]
    };
    // 上面那份定义的管脚绑定是假的，只用于测试 JSON 往返不丢字段
    const text = serializeProject(project);
    const parsed = JSON.parse(text);
    const r = normalizeProject(parsed);
    expect(r.legacy).toBe(false);
    expect(r.project.definitions).toHaveLength(1);
    expect(r.project.definitions[0].name).toBe('D1');
  });
});
