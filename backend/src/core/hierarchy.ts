/**
 * 分层电路语义：自定义器件定义库校验、定义之间的跨层循环引用检测，
 * 以及"实例黑盒"的跨层递归求值引擎。
 *
 * 与扁平求值（evaluate.ts）职责分离：
 *  - evaluate.ts 只对一张扁平表做 Kahn 拓扑传播，遇到 SUB 实例时回调本模块；
 *  - 本模块负责把外部管脚信号映射进定义内部的 INPUT 元件，在内部再跑一遍
 *    完整求值（内部还可能嵌套更深的实例，由此自然递归），再把内部 OUTPUT
 *    的值收集回实例输出管脚。
 *
 * 两类环必须区分：
 *  - 层内反馈环：某一层内部输出绕回输入，由 evaluateSheet 的 Kahn 检测继续负责；
 *  - 跨层循环引用：甲的定义里用了乙、乙的定义里（直接或间接）又用了甲，
 *    展开后是无法求值的递归死循环。求值之前先在"定义引用图"上用 DFS 三色
 *    标记一次性查掉，明确报成 definition-cycle，绝不靠递归爆栈来发现。
 */

import {
  validateCircuit,
  type DefinitionLibrary
} from './graph.js';
import { evaluateSheet, type EvalResult } from './evaluate.js';
import type {
  Circuit,
  CircuitComponent,
  CircuitError,
  DeviceDefinition,
  Project,
  Signal,
  ValidationError
} from './types.js';

/** 递归深度兜底（正常教学电路远小于此；仅用于防御畸形数据导致的栈消耗） */
export const MAX_INSTANCE_DEPTH = 200;

/** 定义校验错误：结构/管脚问题（区别于定义间循环引用） */
export type DefinitionValidationError = ValidationError;

/** 校验结果（不做跨层环检测时用） */
export type LibraryValidationResult =
  | { ok: true; defs: DefinitionLibrary }
  | { ok: false; error: CircuitError };

function validation(message: string): ValidationError {
  return { kind: 'validation', message };
}

/** 把定义数组构造成 id -> 定义 的查找表 */
export function buildLibrary(definitions: DeviceDefinition[]): DefinitionLibrary {
  return new Map(definitions.map((d) => [d.id, d]));
}

/**
 * 逐份校验定义库：
 *  id/name 非空且唯一、管脚非空且指向的内部元件类型正确、
 *  管脚不重复、至少一个输出管脚；每份内部电路通过单层结构校验。
 * 注意这里不检查定义间循环引用（交给 detectDefinitionCycle 单独报告）。
 */
export function validateDefinitions(
  definitions: DeviceDefinition[]
): DefinitionValidationError | null {
  if (!Array.isArray(definitions)) return validation('definitions 必须是数组');

  const ids = new Set<string>();
  const names = new Set<string>();

  for (const def of definitions) {
    if (!def || typeof def.id !== 'string' || def.id.length === 0) {
      return validation('存在缺少 id 的自定义器件定义');
    }
    if (ids.has(def.id)) return validation(`自定义器件 id 重复: ${def.id}`);
    ids.add(def.id);

    const name = def.name?.trim();
    if (!name) return validation(`自定义器件 ${def.id} 没有名字`);
    if (names.has(name)) return validation(`自定义器件重名: “${name}”`);
    names.add(name);

    if (!Array.isArray(def.inputPins) || !Array.isArray(def.outputPins)) {
      return validation(`自定义器件 “${name}” 的管脚列表必须是数组`);
    }
    if (def.outputPins.length === 0) {
      return validation(`自定义器件 “${name}” 至少需要暴露一个输出管脚`);
    }

    const checkPins = (pins: DeviceDefinition['inputPins'], kind: string): ValidationError | null => {
      const seen = new Set<string>();
      for (const pin of pins) {
        if (!pin || typeof pin.componentId !== 'string' || pin.componentId.length === 0) {
          return validation(`自定义器件 “${name}” 存在不完整的${kind}管脚`);
        }
        if (!pin.name?.trim()) {
          return validation(`自定义器件 “${name}” 有${kind}管脚没起名字（绑定元件 ${pin.componentId}）`);
        }
        if (seen.has(pin.componentId)) {
          return validation(`自定义器件 “${name}” 的元件 ${pin.componentId} 被重复暴露为管脚`);
        }
        seen.add(pin.componentId);
      }
      return null;
    };

    const pinErr = checkPins(def.inputPins, '输入') ?? checkPins(def.outputPins, '输出');
    if (pinErr) return pinErr;

    if (!def.circuit) {
      return validation(`自定义器件 “${name}” 缺少内部电路`);
    }

    // 内部电路先按"除自身以外的已收集定义"做结构校验；自身定义里引用自己
    // （直接自引用）在结构上是合法的，跨层环由 detectDefinitionCycle 报告。
    const partial = new Map(definitions.map((d) => [d.id, d]));
    const structural = validateCircuit(def.circuit, partial);
    if (structural) {
      return validation(`自定义器件 “${name}” 的内部电路不合法：${structural.message}`);
    }

    const comps = new Map(def.circuit.components.map((c) => [c.id, c]));
    for (const pin of def.inputPins) {
      const c = comps.get(pin.componentId);
      if (!c) {
        return validation(`自定义器件 “${name}” 的输入管脚 “${pin.name}” 绑定的内部元件不存在: ${pin.componentId}`);
      }
      if (c.type !== 'INPUT') {
        return validation(`自定义器件 “${name}” 的输入管脚 “${pin.name}” 必须绑定一个输入开关（当前是 ${c.type}）`);
      }
    }
    for (const pin of def.outputPins) {
      const c = comps.get(pin.componentId);
      if (!c) {
        return validation(`自定义器件 “${name}” 的输出管脚 “${pin.name}” 绑定的内部元件不存在: ${pin.componentId}`);
      }
      if (c.type !== 'OUTPUT') {
        return validation(`自定义器件 “${name}” 的输出管脚 “${pin.name}” 必须绑定一个输出指示灯（当前是 ${c.type}）`);
      }
    }
  }

  return null;
}

/** 收集一份定义的内部电路直接引用到的全部器件定义 id（含自引用） */
export function directReferences(def: DeviceDefinition): string[] {
  const refs: string[] = [];
  const seen = new Set<string>();
  for (const c of def.circuit.components) {
    if (c.type === 'SUB' && c.deviceId && !seen.has(c.deviceId)) {
      seen.add(c.deviceId);
      refs.push(c.deviceId);
    }
  }
  return refs;
}

/**
 * 在"定义引用图"上检测跨层循环引用（DFS 三色标记）。
 * 单看每层内部无环并不能保证可求值：甲内部用乙、乙内部用甲，
 * 展开后就是无限递归。这里在任何求值发生之前一次性查掉。
 *
 * @returns 检测到环时返回定义 id 的闭合序列（如 [甲, 乙, 甲]）；无环返回 null
 */
export function detectDefinitionCycle(definitions: DeviceDefinition[]): string[] | null {
  const byId = new Map(definitions.map((d) => [d.id, d]));
  const state = new Map<string, 0 | 1 | 2>(); // 0 未访问 1 在当前 DFS 栈上 2 完成
  for (const id of byId.keys()) state.set(id, 0);

  const dfs = (id: string, stack: string[]): string[] | null => {
    state.set(id, 1);
    stack.push(id);
    const def = byId.get(id);
    if (def) {
      for (const ref of directReferences(def)) {
        if (!byId.has(ref)) continue; // 悬空引用已在结构校验阶段报错
        const s = state.get(ref);
        if (s === 1) {
          // 回边：从栈中截出 ref..id，再补 ref 闭合
          const start = stack.indexOf(ref);
          return [...stack.slice(start), ref];
        }
        if (s === 0) {
          const found = dfs(ref, stack);
          if (found) return found;
        }
      }
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };

  for (const id of byId.keys()) {
    if (state.get(id) === 0) {
      const found = dfs(id, []);
      if (found) return found;
    }
  }
  return null;
}

function definitionCycleError(path: string[], defs: DefinitionLibrary): CircuitError {
  const names = path.map((id) => defs.get(id)?.name?.trim() || id);
  return {
    kind: 'definition-cycle',
    path,
    message:
      `检测到自定义器件之间存在跨层循环引用：${names.join(' → ')}。` +
      '器件定义不允许（直接或间接）引用自身，否则展开求值会无限递归。请打开其中某个器件的内部电路，去掉回指的实例。'
  };
}

/** 校验定义库 + 跨层环检测；全部通过才返回库 */
export function validateLibrary(
  definitions: DeviceDefinition[]
): LibraryValidationResult {
  const bad = validateDefinitions(definitions);
  if (bad) return { ok: false, error: bad };
  const defs = buildLibrary(definitions);
  const cycle = detectDefinitionCycle(definitions);
  if (cycle) return { ok: false, error: definitionCycleError(cycle, defs) };
  return { ok: true, defs };
}

export interface HierarchyEngine {
  defs: DefinitionLibrary;
  /** 对（可能含实例的）任意一张表做完整跨层求值 */
  evaluate: (
    circuit: Circuit,
    inputValues?: Record<string, 0 | 1>
  ) => EvalResult;
}

interface CacheEntry {
  /** "输入管脚信号拼成的串" -> 输出管脚信号 */
  byInput: Map<string, Signal[]>;
}

/**
 * 创建跨层求值引擎：
 *  1. 定义库结构校验；
 *  2. 定义引用图跨层环检测（求值前拒绝，不靠递归爆栈发现）；
 *  3. 返回的 evaluate() 在对外层做拓扑传播时，每排到一个 SUB 实例，
 *     就把喂到其输入管脚的信号绑定到内部 INPUT，递归求内部电路，
 *     取内部 OUTPUT 的值回填实例输出管脚，外层再继续传播。
 */
export function createHierarchyEngine(
  definitions: DeviceDefinition[]
):
  | { ok: true; engine: HierarchyEngine }
  | { ok: false; error: CircuitError } {
  const checked = validateLibrary(definitions);
  if (!checked.ok) return { ok: false, error: checked.error };
  const defs = checked.defs;

  // 同一器件定义在同一次外部求值中的结果缓存：相同输入不重复递归，
  // 也让扇出到多个相同实例的电路求值更省。
  const caches = new Map<string, CacheEntry>();

  const evalInstance =
    (activeStack: string[], depth: number) =>
    (
      comp: CircuitComponent,
      inputs: Signal[]
    ): { ok: true; outputs: Signal[] } | { ok: false; error: CircuitError } => {
      const deviceId = comp.deviceId!;
      const def = defs.get(deviceId);
      if (!def) {
        return {
          ok: false,
          error: validation(`实例 ${comp.id} 引用的自定义器件不存在: ${deviceId}`)
        };
      }
      if (depth >= MAX_INSTANCE_DEPTH) {
        return {
          ok: false,
          error: validation(`器件嵌套深度超过 ${MAX_INSTANCE_DEPTH} 层，请检查是否存在异常引用`)
        };
      }
      // 防御性活动栈检查：正常情况下环已在求值前被 detectDefinitionCycle 拒绝，
      // 这里保证任何漏网路径也只会得到干净错误而不是栈溢出。
      if (activeStack.includes(deviceId)) {
        const cycle = [...activeStack.slice(activeStack.indexOf(deviceId)), deviceId];
        return { ok: false, error: definitionCycleError(cycle, defs) };
      }

      const key = inputs.map((v) => (v === null ? 'x' : String(v))).join('/');
      let cache = caches.get(deviceId);
      if (!cache) {
        cache = { byInput: new Map() };
        caches.set(deviceId, cache);
      }
      const cached = cache.byInput.get(key);
      if (cached) return { ok: true, outputs: cached };

      // 把外部管脚信号绑定到内部输入开关：
      //  - 对外输入管脚 i 的信号就是其 INPUT 元件的激励；管脚悬空（null）时
      //    必须强制为未确定，不能回落到开关自身的默认值；
      //  - 未被暴露为管脚的内部 INPUT 保留自身开关值（交互编辑时的本地激励）。
      const inputValues: Record<string, 0 | 1> = {};
      const forcedNull = new Set<string>();
      def.inputPins.forEach((pin, i) => {
        const v = inputs[i] ?? null;
        if (v === null) forcedNull.add(pin.componentId);
        else inputValues[pin.componentId] = v;
      });

      const childStack = [...activeStack, deviceId];
      const inner = evaluateSheet(def.circuit, {
        inputValues,
        forcedNullInputs: forcedNull,
        resolver: { defs, evalInstance: evalInstance(childStack, depth + 1) }
      });
      if (!inner.ok) return { ok: false, error: inner.error };

      // 内部输入管脚悬空时，求值结果可能为 null；悬空输入开关在穷举场景
      // 不会出现（外层真值表每次都灌确定值），实时编辑时按三值如实上抛。
      const outputs = def.outputPins.map(
        (pin) => inner.portOutputs[`${pin.componentId}:0`] ?? null
      );
      cache.byInput.set(key, outputs);
      return { ok: true, outputs };
    };

  return {
    ok: true,
    engine: {
      defs,
      evaluate(circuit, inputValues) {
        caches.clear();
        return evaluateSheet(circuit, {
          inputValues,
          resolver: { defs, evalInstance: evalInstance([], 0) }
        });
      }
    }
  };
}

/** 便捷入口：对整个工程（顶层电路 + 定义库）求值 */
export function evaluateProject(
  project: Project,
  inputValues?: Record<string, 0 | 1>
): EvalResult {
  const created = createHierarchyEngine(project.definitions ?? []);
  if (!created.ok) return { ok: false, error: created.error };
  return created.engine.evaluate(project.circuit, inputValues);
}

/** 从可能为旧版（纯 Circuit）或新版（Project）的数据中取出定义列表 */
export function definitionsOf(data: unknown): DeviceDefinition[] {
  if (
    data &&
    typeof data === 'object' &&
    Array.isArray((data as Project).definitions)
  ) {
    return (data as Project).definitions;
  }
  return [];
}
