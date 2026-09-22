/**
 * 分层电路求值层 —— 整个工具正确性的关键。
 *
 * 分层语义：
 *  一个 CUSTOM 实例在它所在的那一层是个黑盒。外层按拓扑序排到该实例时，
 *  取当前驱动在它各输入管脚上的信号，灌入它引用的那份器件定义的内部电路
 *  （内部 INPUT 元件得到对应管脚值），在内部再跑一遍完整的拓扑求值，
 *  再把内部 OUTPUT 元件的值回填为实例各输出管脚的信号，外层继续向后传播。
 *  定义可以嵌套定义，整个过程随拓扑递归向下；求值前先由 definitions 模块
 *  保证"定义引用图"无环，因此递归必然终止，不会爆栈。
 *
 * 与旧版扁平求值的关系：
 *  definitions 缺省（空表）时整张电路不可能有 CUSTOM 元件，全部行为与
 *  分层改造前逐字节一致；悬空输入仍按 null 传播（含跨层：管脚悬空 -> 内部 null）。
 *
 * 每层内部：
 *  1. 结构校验（端口、方向、多重驱动）。
 *  2. 以"连线"构造元件级有向图：src -> dst。
 *  3. Kahn 拓扑排序。能全部入列则无环，按拓扑顺序从 INPUT 一级级向后推；
 *     若有节点剩余，则存在层内反馈环 —— 用 DFS 在剩余子图中找出一条具体的
 *     环路径返回，绝不死循环，也不给出可能错误的求值结果。
 */

import { buildGraph, inputPortCount, validateCircuit, type DefinitionLookup } from './graph.js';
import { evalGate } from './gates.js';
import {
  definitionMap,
  findDefinitionCycle,
  formatDefinitionCycle,
  validateDefinitions
} from './definitions.js';
import type {
  Circuit,
  CircuitError,
  CircuitComponent,
  DeviceDefinition,
  Project,
  Signal,
  Wire
} from './types.js';

export interface EvalResultOk {
  ok: true;
  /**
   * 每个元件的输出值（OUTPUT 指示灯记录其显示值；INPUT 记录开关值；
   * CUSTOM 实例记录其第 0 个输出管脚的值——多管脚明细见 instanceOutputs）
   */
  outputs: Record<string, Signal>;
  /** CUSTOM 实例的各输出管脚信号（下标对齐定义的 outputs 管脚表） */
  instanceOutputs: Record<string, Signal[]>;
  /** 每条连线当前承载的信号（CUSTOM 多输出口按对应管脚取值） */
  wireValues: Record<string, Signal>;
  /** 顶层拓扑顺序，便于调试/前端理解传播层次 */
  order: string[];
}

export interface EvalResultErr {
  ok: false;
  error: CircuitError;
}

export type EvalResult = EvalResultOk | EvalResultErr;

type InstanceResult =
  | { ok: true; signals: Signal[] }
  | { ok: false; error: CircuitError };

/** 构造元件级邻接表与入度（同一对元件间的多根线只算一条元件级依赖） */
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
    if (seen.has(edge)) continue;
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
      const found = dfs(id);
      if (found) return found;
    }
  }
  return [...nodes]; // 理论上不会走到这里
}

/**
 * 分层求值器：持有器件定义表，并为"定义 × 输入组合"做记忆化——
 * 同一层里摆放多个相同实例、或多个实例输入一致时，内部电路只跑一次。
 * 每次顶层 evaluate 新建一个实例，故缓存不会跨编辑复用陈旧结果。
 */
class LayerEvaluator {
  private readonly cache = new Map<string, InstanceResult>();

  constructor(private readonly defs: DefinitionLookup) {}

  /** 把一份定义当黑盒求值：输入管脚信号 -> 输出管脚信号（按管脚表顺序） */
  private evalInstance(def: DeviceDefinition, pinInputs: Signal[]): InstanceResult {
    const key = `${def.id}|${pinInputs.map((v) => (v === null ? 'x' : v)).join(',')}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    // 逐管脚写入外部驱动值；未连线的管脚显式置 null —— 不能落回内部
    // INPUT 元件自带的 0 默认值，否则"悬空"会被偷偷当成 0。
    const overrides: Record<string, Signal> = {};
    def.inputs.forEach((pin, i) => {
      overrides[pin.componentId] = i < pinInputs.length ? (pinInputs[i] ?? null) : null;
    });

    const inner = this.evalLayer(def.circuit, overrides, def.id);
    const result: InstanceResult = !inner.ok
      ? { ok: false, error: inner.error }
      : {
          ok: true,
          signals: def.outputs.map((pin) => inner.outputs[pin.componentId] ?? null)
        };
    this.cache.set(key, result);
    return result;
  }

  /** 单层（顶层或某定义内部）拓扑传播求值；CUSTOM 实例递归展开 */
  evalLayer(
    circuit: Circuit,
    inputValues: Record<string, Signal> | undefined,
    layer: string | null
  ): EvalResult {
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
          layer,
          message: layer
            ? `器件定义「${layer}」的内部电路存在反馈环（${cyclePath.join(' → ')} → 回到起点）：组合逻辑不允许环路，请断开回绕连线。`
            : `检测到反馈环（${cyclePath.join(' → ')} → 回到起点）：组合逻辑电路不允许出现环路，它会使输出依赖自身。请断开回绕的连线。`
        }
      };
    }

    // 按拓扑顺序传播
    const outputs: Record<string, Signal> = {};
    const instanceOutputs: Record<string, Signal[]> = {};
    for (const id of order) {
      const c = graph.comps.get(id)!;
      const computed = this.computeComponent(c, graph.driver, outputs, instanceOutputs, inputValues);
      if ('error' in computed) return { ok: false, error: computed.error };
      outputs[id] = computed.signal;
      if (c.type === 'CUSTOM') instanceOutputs[id] = computed.allSignals;
    }

    const wireValues: Record<string, Signal> = {};
    for (const w of circuit.wires) {
      const src = graph.comps.get(w.from.componentId)!;
      if (src.type === 'CUSTOM') {
        wireValues[w.id] = instanceOutputs[src.id]?.[w.from.port] ?? null;
      } else {
        wireValues[w.id] = outputs[w.from.componentId] ?? null;
      }
    }

    return { ok: true, outputs, instanceOutputs, wireValues, order };
  }

  private computeComponent(
    c: CircuitComponent,
    driver: Map<string, Wire>,
    outputs: Record<string, Signal>,
    instanceOutputs: Record<string, Signal[]>,
    inputValues: Record<string, Signal> | undefined
  ): { signal: Signal; allSignals: Signal[] } | { error: CircuitError } {
    if (c.type === 'INPUT') {
      // 注意必须按"键是否存在"取值：跨层求值会用 null 显式表示管脚悬空，
      // 用 ?? 会把 null 当成缺省而错误地落回开关自带的 0 值。
      const v =
        inputValues && Object.prototype.hasOwnProperty.call(inputValues, c.id)
          ? inputValues[c.id]
          : (c.value ?? 0);
      return { signal: v, allSignals: [v] };
    }

    const def = c.type === 'CUSTOM' ? this.defs.get(c.definitionId!) : undefined;
    const portCount = inputPortCount(c, def);

    const inputs: Signal[] = [];
    for (let p = 0; p < portCount; p++) {
      const w = driver.get(`${c.id}:${p}`);
      if (!w) {
        inputs.push(null); // 悬空管脚：跨层传播 null
      } else if (instanceOutputs[w.from.componentId]) {
        inputs.push(instanceOutputs[w.from.componentId][w.from.port] ?? null);
      } else {
        inputs.push(outputs[w.from.componentId] ?? null);
      }
    }

    if (c.type === 'OUTPUT') {
      return { signal: inputs[0] ?? null, allSignals: [inputs[0] ?? null] };
    }

    if (c.type === 'CUSTOM') {
      // 结构校验已保证定义存在，这里防御性兜底
      if (!def) {
        return {
          error: {
            kind: 'validation',
            message: `实例 ${c.id} 引用的器件定义不存在: ${c.definitionId ?? '(空)'}`
          }
        };
      }
      const result = this.evalInstance(def, inputs);
      if (!result.ok) return { error: result.error };
      return { signal: result.signals[0] ?? null, allSignals: result.signals };
    }

    const signal = evalGate(c.type, inputs);
    return { signal, allSignals: [signal] };
  }
}

/**
 * 拓扑排序 + 跨层递归传播求值（顶层入口）。
 * @param inputValues 可选：覆盖某些 INPUT 元件的开关值（真值表穷举时使用）
 * @param definitions 器件定义表；缺省/为空时即旧版扁平电路求值
 */
export function evaluate(
  circuit: Circuit,
  inputValues?: Record<string, 0 | 1>,
  definitions?: readonly DeviceDefinition[]
): EvalResult {
  const defs: DefinitionLookup = definitions ? definitionMap(definitions) : new Map();

  const validation = validateCircuit(circuit, defs);
  if (validation) return { ok: false, error: validation };

  if (definitions && definitions.length > 0) {
    const defValidation = validateDefinitions(definitions);
    if (defValidation) return { ok: false, error: defValidation };

    const cyclePath = findDefinitionCycle(definitions);
    if (cyclePath) {
      const nameOf = (id: string) => defs.get(id)?.name ?? id;
      return {
        ok: false,
        error: {
          kind: 'definition-cycle',
          path: cyclePath,
          message: formatDefinitionCycle(cyclePath, nameOf)
        }
      };
    }
  }

  return new LayerEvaluator(defs).evalLayer(circuit, inputValues, null);
}

/** 工程求值便捷入口 */
export function evaluateProject(
  project: Project,
  inputValues?: Record<string, 0 | 1>
): EvalResult {
  return evaluate(project.circuit, inputValues, project.definitions);
}
