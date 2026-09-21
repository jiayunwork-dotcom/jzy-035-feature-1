/**
 * 电路求值层 —— 整个工具正确性的关键。
 *
 * 做法：
 *  1. 结构校验（端口、方向、多重驱动）。
 *  2. 以"连线"构造元件级有向图：src -> dst。
 *  3. Kahn 拓扑排序。能全部入列则无环，按拓扑顺序从 INPUT 一级级向后推；
 *     若有节点剩余，则存在反馈环 —— 用 DFS 在剩余子图中找出一条具体的环
 *     路径返回，绝不死循环，也不给出可能错误的求值结果（标记为环错误）。
 *  4. 悬空输入端口按 null（未确定）传播，连线颜色在前端用虚线表示。
 */

import { buildGraph, inputPortCount, validateCircuit } from './graph.js';
import { evalGate } from './gates.js';
import type {
  Circuit,
  CircuitError,
  CircuitComponent,
  Signal,
  Wire
} from './types.js';

export interface EvalResultOk {
  ok: true;
  /** 每个逻辑元件的输出值（OUTPUT 指示灯记录其显示值；INPUT 记录开关值） */
  outputs: Record<string, Signal>;
  /** 每条连线当前承载的信号 */
  wireValues: Record<string, Signal>;
  /** 拓扑顺序，便于调试/前端理解传播层次 */
  order: string[];
}

export interface EvalResultErr {
  ok: false;
  error: CircuitError;
}

export type EvalResult = EvalResultOk | EvalResultErr;

/** 构造元件级邻接表与入度（输入端口被几个不同上游元件驱动——实际至多 1/端口） */
function buildComponentDeps(circuit: Circuit): {
  adj: Map<string, string[]>;
  indegree: Map<string, number>;
} {
  const adj = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const c of circuit.components) {
    adj.set(c.id, []);
    indegree.set(c.id, 0);
  }
  const seen = new Set<string>();
  for (const w of circuit.wires) {
    const edge = `${w.from.componentId}->${w.to.componentId}`;
    if (seen.has(edge)) continue; // 同一对元件间的多根线只算一条元件级依赖
    seen.add(edge);
    adj.get(w.from.componentId)!.push(w.to.componentId);
    indegree.set(w.to.componentId, (indegree.get(w.to.componentId) ?? 0) + 1);
  }
  return { adj, indegree };
}

/** 在被环卡住的子图中 DFS 找出一条具体的、闭合的环（节点 id 序列） */
function findCyclePath(
  nodes: Set<string>,
  adj: Map<string, string[]>
): string[] {
  const state = new Map<string, 0 | 1 | 2>(); // 0 未访问 1 在栈上 2 完成
  for (const id of nodes) state.set(id, 0);
  const stack: string[] = [];
  /** 记录 DFS 树的前驱，用于把回边补成首尾呼应的完整环 */
  const parent = new Map<string, string | null>();

  const dfs = (u: string): string[] | null => {
    state.set(u, 1);
    stack.push(u);
    for (const v of adj.get(u) ?? []) {
      if (!nodes.has(v)) continue;
      const s = state.get(v);
      if (s === 1) {
        // 回边 u -> v：从栈里截出 v..u，再把 v 追加到末尾闭合
        const start = stack.indexOf(v);
        return [...stack.slice(start), v];
      }
      if (s === 0) {
        parent.set(v, u);
        const found = dfs(v);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(u, 2);
    return null;
  };

  for (const id of nodes) {
    if (state.get(id) === 0) {
      parent.set(id, null);
      const found = dfs(id);
      if (found) return found;
    }
  }
  return [...nodes]; // 理论上不会走到这里
}

/**
 * 拓扑排序 + 传播求值。
 * @param inputValues 可选：覆盖某些 INPUT 元件的开关值（真值表穷举时使用）
 */
export function evaluate(
  circuit: Circuit,
  inputValues?: Record<string, 0 | 1>
): EvalResult {
  const validation = validateCircuit(circuit);
  if (validation) return { ok: false, error: validation };

  const graph = buildGraph(circuit);
  const { adj, indegree } = buildComponentDeps(circuit);

  // Kahn
  const queue = circuit.components
    .filter((c) => (indegree.get(c.id) ?? 0) === 0)
    .map((c) => c.id);
  const order: string[] = [];
  const remain = new Map(indegree);
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const dst of adj.get(id) ?? []) {
      const d = (remain.get(dst) ?? 0) - 1;
      remain.set(dst, d);
      if (d === 0) queue.push(dst);
    }
  }

  if (order.length < circuit.components.length) {
    const cyclic = new Set(
      circuit.components.map((c) => c.id).filter((id) => remain.get(id)! > 0)
    );
    const cyclePath = findCyclePath(cyclic, adj);
    return {
      ok: false,
      error: {
        kind: 'cycle',
        path: cyclePath,
        message: `检测到反馈环（${cyclePath.join(' → ')} → 回到起点）：组合逻辑电路不允许出现环路，它会使输出依赖自身。请断开回绕的连线。`
      }
    };
  }

  // 按拓扑顺序传播
  const outputs: Record<string, Signal> = {};
  for (const id of order) {
    const c = graph.comps.get(id)!;
    outputs[id] = computeComponentOutput(c, graph.driver, outputs, inputValues);
  }

  const wireValues: Record<string, Signal> = {};
  for (const w of circuit.wires) {
    wireValues[w.id] = outputs[w.from.componentId] ?? null;
  }

  return { ok: true, outputs, wireValues, order };
}

function computeComponentOutput(
  c: CircuitComponent,
  driver: Map<string, Wire>,
  outputs: Record<string, Signal>,
  inputValues?: Record<string, 0 | 1>
): Signal {
  if (c.type === 'INPUT') {
    const v = inputValues?.[c.id] ?? c.value ?? 0;
    return v;
  }

  const inputs: Signal[] = [];
  for (let p = 0; p < inputPortCount(c); p++) {
    const w = driver.get(`${c.id}:${p}`);
    inputs.push(w ? (outputs[w.from.componentId] ?? null) : null);
  }

  if (c.type === 'OUTPUT') {
    return inputs[0] ?? null;
  }
  return evalGate(c.type, inputs);
}
