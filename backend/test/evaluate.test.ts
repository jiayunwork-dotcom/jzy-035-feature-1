/**
 * 多级电路拓扑传播 & 反馈环检测测试。
 */
import { describe, expect, it } from 'vitest';
import { CircuitBuilder, outputTrace } from './helpers.js';
import { evaluate } from '../src/core/evaluate.js';

describe('多级电路按拓扑顺序传播', () => {
  it('两层电路：F = (A AND B) OR (C AND D) —— 多数/选择结构', () => {
    const b = new CircuitBuilder();
    const a = b.input('A', 0, 0, 0);
    const c = b.input('B', 0, 0, 40);
    const d = b.input('C', 0, 0, 80);
    const e = b.input('D', 0, 0, 120);
    const g1 = b.gate('AND', 200, 20);
    const g2 = b.gate('AND', 200, 100);
    const or = b.gate('OR', 320, 60);
    const f = b.output('F', 460, 60);
    b.connect(a, g1, 0)
      .connect(c, g1, 1)
      .connect(d, g2, 0)
      .connect(e, g2, 1)
      .connect(g1, or, 0)
      .connect(g2, or, 1)
      .connect(or, f);
    const circuit = b.build();

    // m: ABCD 0000..1111；F=1 当且仅当 AB=11 或 CD=11
    expect(outputTrace(circuit, [a, c, d, e], f)).toEqual([
      0, 0, 0, 1,
      0, 0, 0, 1,
      0, 0, 0, 1,
      1, 1, 1, 1
    ]);
  });

  it('三层异或级联：F = A XOR B XOR C（奇校验），传播顺序正确', () => {
    const b = new CircuitBuilder();
    const a = b.input('A');
    const c = b.input('B', 0, 40);
    const d = b.input('C', 0, 80);
    const x1 = b.gate('XOR', 200, 20);
    const x2 = b.gate('XOR', 320, 40);
    const out = b.output('F', 460, 40);
    b.connect(a, x1, 0).connect(c, x1, 1).connect(x1, x2, 0).connect(d, x2, 1).connect(x2, out);
    const circuit = b.build();
    expect(outputTrace(circuit, [a, c, d], out)).toEqual([0, 1, 1, 0, 1, 0, 0, 1]);
  });

  it('拓扑顺序：输入在最前、输出在最后（即使元件添加顺序是乱的）', () => {
    const b = new CircuitBuilder();
    const out = b.output('F');
    const g = b.gate('AND');
    const a = b.input('A');
    const c = b.input('B');
    b.connect(a, g, 0).connect(c, g, 1).connect(g, out);
    const r = evaluate(b.build());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.order.slice(0, 2).sort()).toEqual([a, c].sort());
      expect(r.order[r.order.length - 1]).toBe(out);
      expect(r.order.indexOf(g)).toBeLessThan(r.order.indexOf(out));
    }
  });

  it('扇出：一个输入同时驱动多个门，所有下游都收到同一信号', () => {
    const b = new CircuitBuilder();
    const a = b.input('A', 1);
    const g1 = b.gate('NOT', 200, 0);
    const g2 = b.gate('NOT', 200, 80);
    const o1 = b.output('F', 400, 0);
    const o2 = b.output('G', 400, 80);
    b.connect(a, g1).connect(a, g2).connect(g1, o1).connect(g2, o2);
    const r = evaluate(b.build());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.outputs[o1]).toBe(0);
      expect(r.outputs[o2]).toBe(0);
    }
  });

  it('线值随源元件输出记录在 wireValues 中', () => {
    const b = new CircuitBuilder();
    const a = b.input('A', 1);
    const g = b.gate('NOT');
    const out = b.output('F');
    b.connect(a, g).connect(g, out);
    const circuit = b.build();
    const r = evaluate(circuit);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const [w1, w2] = circuit.wires;
      expect(r.wireValues[w1.id]).toBe(1);
      expect(r.wireValues[w2.id]).toBe(0);
    }
  });

  it('未连线的输入端口得到 null，沿链路传播（不崩溃、不瞎给值）', () => {
    const b = new CircuitBuilder();
    const a = b.input('A', 1);
    const g = b.gate('AND');
    const out = b.output('F');
    b.connect(a, g, 0).connect(g, out); // g 的端口 1 悬空
    const r = evaluate(b.build());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.outputs[out]).toBeNull();
  });
});

describe('反馈环检测', () => {
  it('直接自环（门输出接回自己的输入）被拒绝', () => {
    const b = new CircuitBuilder();
    const a = b.input('A');
    const g = b.gate('AND');
    const out = b.output('F');
    b.connect(a, g, 0).connect(g, g, 1).connect(g, out);
    const r = evaluate(b.build());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('cycle');
      if (r.error.kind === 'cycle') expect(r.error.path).toContain(g);
    }
  });

  it('锁存器式环：NOT 输出绕回输入，被检测且返回具体环路径', () => {
    const b = new CircuitBuilder();
    const g1 = b.gate('NOT', 200, 0);
    const g2 = b.gate('NOT', 320, 80);
    const out = b.output('F', 460, 40);
    // g1 -> g2 -> g1 形成振荡环；g2 再接一个输出
    b.connect(g1, g2, 0).connect(g2, g1, 0).connect(g2, out);
    const r = evaluate(b.build());
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === 'cycle') {
      expect(new Set(r.error.path)).toEqual(new Set([g1, g2]));
      expect(r.error.message).toContain('反馈环');
    }
  });

  it('更长的多级环（g1->g2->g3->g1）也被检测', () => {
    const b = new CircuitBuilder();
    const g1 = b.gate('AND', 100, 0);
    const g2 = b.gate('OR', 240, 0);
    const g3 = b.gate('NOT', 380, 0);
    const a = b.input('A');
    b.connect(a, g1, 0);
    // 给 g1 第二个输入接 g3 形成环
    b.connect(g1, g2, 0).connect(g2, g3, 0).connect(g3, g1, 1);
    const r = evaluate(b.build());
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === 'cycle') {
      expect(new Set(r.error.path)).toEqual(new Set([g1, g2, g3]));
    }
  });

  it('无环电路不会被误报', () => {
    const b = new CircuitBuilder();
    const a = b.input('A');
    const c = b.input('B');
    const g = b.gate('XOR');
    const out = b.output('F');
    b.connect(a, g, 0).connect(c, g, 1).connect(g, out);
    expect(evaluate(b.build()).ok).toBe(true);
  });
});

describe('结构校验', () => {
  it('输出口接输出口、输入口接输入口方向非法时拒绝', () => {
    // OUTPUT 没有输出端口，从它接线应被拒绝
    const b = new CircuitBuilder();
    const a = b.input('A');
    const o1 = b.output('F');
    const o2 = b.output('G');
    b.connect(a, o1).connect(o1, o2);
    const r = evaluate(b.build());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('validation');
  });

  it('同一输入端口被两条线驱动时拒绝', () => {
    const b = new CircuitBuilder();
    const a = b.input('A');
    const c = b.input('B');
    const g = b.gate('AND');
    const out = b.output('F');
    b.connect(a, g, 0).connect(c, g, 0).connect(g, out);
    const r = evaluate(b.build());
    expect(r.ok).toBe(false);
  });
});
