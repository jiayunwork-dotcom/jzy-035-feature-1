/**
 * 电路求值层（单层）—— 整个工具正确性的关键。
 *
 * 做法：
 *  1. 结构校验（端口、方向、多重驱动）。
 *  2. 以"连线"构造元件级有向图：src -> dst。
 *  3. Kahn 拓扑排序。能全部入列则无环，按拓扑顺序从 INPUT 一级级向后推；
 *     若有节点剩余，则存在反馈环 —— 用 DFS 在剩余子图中找出一条具体的环
 *     路径返回，绝不死循环，也不给出可能错误的求值结果（标记为环错误）。
 *  4. 悬空输入端口按 null（未确定）传播，连线颜色在前端用虚线表示。
 *
 * 分层：本文件只懂"一张表"。表中的 SUB 实例是黑盒，其多输出由外部注入的
 * InstanceResolver 计算（见 hierarchy.ts 的跨层递归求值器）；旧的扁平
 * evaluate() 不带 resolver，行为与升级前完全一致。
 */

import {
  buildGraph,
  inputPortCount,
  outputPortCount,
  validateCircuit,
  type DefinitionLibrary
} from './graph.js';
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
  /**
   * 每个元件"主输出（端口 0）"的值；OUTPUT 指示灯记录其显示值；
   * INPUT 记录开关值。多输出 SUB 的其余端口见 portOutputs。
   */
  outputs: Record<string, Signal>;
  /** "componentId:port" -> 该输出端口的信号（多输出实例需要） */
  portOutputs: Record<string, Signal>;
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

/** 实例求值回调：喂入实例各输入管脚的当前信号，返回其各输出管脚的信号 */
export interface InstanceResolver {
  /** 本张表可见的器件定义库 */
  defs: DefinitionLibrary;
  /**
   * 计算一个 SUB 实例的输出。返回 error 时（如内部环、跨层循环引用）
   * 整个求值立即失败并把错误向上冒泡。
   */
  evalInstance: (
    comp: CircuitComponent,
    inputs: Signal[]
  ) => { ok: true; outputs: Signal[] } | { ok: false; error: CircuitError };
}

export interface EvaluateSheetOptions {
  /** 覆盖某些 INPUT 元件的开关值（真值表穷举时使用） */
  inputValues?: Record<string, 0 | 1>;
  /** 强制为悬空(null)的 INPUT 元件 id（分层求值：实例输入管脚未接线） */
  forcedNullInputs?: ReadonlySet<string>;
  /** 分层求值器；缺省时表中不允许出现 SUB（结构校验即拒绝） */
  resolver?: InstanceResolver;
}

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
function findCyclePath(nodes: Set<string>, adj: Map<string, string[]>): string[] {
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
 * 单张电路表的拓扑排序 + 传播求值（分层内核的单层实现）。
 */
export function evaluateSheet(
  circuit: Circuit,
  options: EvaluateSheetOptions = {}
): EvalResult {
  const { inputValues, forcedNullInputs, resolver } = options;
  const defs = resolver?.defs;
  const validation = validateCircuit(circuit, defs);
  if (validation) return { ok: false, error: validation };

  const hasSub = circuit.components.some((c) => c.type === 'SUB');
  if (hasSub && !resolver) {
    return {
      ok: false,
      error: {
        kind: 'validation',
        message: '电路包含自定义器件实例，但没有提供分层求值器（内部错误）'
      }
    };
  }

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
  const portOutputs: Record<string, Signal> = {};
  const setPort = (id: string, port: number, v: Signal): void => {
    portOutputs[`${id}:${port}`] = v;
  };

  const driverInputs = (c: CircuitComponent): Signal[] => {
    const inputs: Signal[] = [];
    for (let p = 0; p < inputPortCount(c, defs); p++) {
      const w = graph.driver.get(`${c.id}:${p}`);
      inputs.push(w ? portOutputs[`${w.from.componentId}:${w.from.port}`] ?? null : null);
    }
    return inputs;
  };

  for (const id of order) {
    const c = graph.comps.get(id)!;

    if (c.type === 'INPUT') {
      const v = forcedNullInputs?.has(c.id) ? null : inputValues?.[c.id] ?? c.value ?? 0;
      setPort(id, 0, v);
      continue;
    }

    const inputs = driverInputs(c);

    if (c.type === 'OUTPUT') {
      setPort(id, 0, inputs[0] ?? null);
      continue;
    }

    if (c.type === 'SUB') {
      const result = resolver!.evalInstance(c, inputs);
      if (!result.ok) return { ok: false, error: result.error };
      const expected = outputPortCount(c, defs);
      if (result.outputs.length !== expected) {
        return {
          ok: false,
          error: {
            kind: 'validation',
            message: `实例 ${c.id} 的定义 ${c.deviceId} 输出管脚数（${expected}）与求值结果（${result.outputs.length}）不一致`
          }
        };
      }
      result.outputs.forEach((v, p) => setPort(id, p, v));
      continue;
    }

    setPort(id, 0, evalGate(c.type, inputs));
  }

  // 兼容旧结果形态：outputs 取每个元件的 0 号端口（门/开关/指示灯语义不变）
  const outputs: Record<string, Signal> = {};
  for (const c of circuit.components) outputs[c.id] = portOutputs[`${c.id}:0`] ?? null;

  const wireValues: Record<string, Signal> = {};
  for (const w of circuit.wires) {
    wireValues[w.id] = portOutputs[`${w.from.componentId}:${w.from.port}`] ?? null;
  }

  return { ok: true, outputs, portOutputs, wireValues, order };
}

/**
 * 扁平电路求值（升级前的入口，签名与行为保持不变）。
 * @param inputValues 可选：覆盖某些 INPUT 元件的开关值（真值表穷举时使用）
 */
export function evaluate(
  circuit: Circuit,
  inputValues?: Record<string, 0 | 1>
): EvalResult {
  return evaluateSheet(circuit, { inputValues });
}

/** 供旧代码/测试引用的单元件计算辅助（扁平场景） */
export function computeComponentOutput(
  c: CircuitComponent,
  driver: Map<string, Wire>,
  outputs: Record<string, Signal>,
  inputValues?: Record<string, 0 | 1>
): Signal {
  if (c.type === 'INPUT') {
    return inputValues?.[c.id] ?? c.value ?? 0;
  }
  const inputs: Signal[] = [];
  for (let p = 0; p < inputPortCount(c); p++) {
    const w = driver.get(`${c.id}:${p}`);
    inputs.push(w ? (outputs[w.from.componentId] ?? null) : null);
  }
  if (c.type === 'OUTPUT') return inputs[0] ?? null;
  if (c.type === 'SUB') return null;
  return evalGate(c.type, inputs);
}
