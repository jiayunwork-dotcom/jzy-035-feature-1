/**
 * 分层电路编辑器状态。
 *
 * 一个工程(Project) = 顶层电路 + 器件定义表；任何时刻正在编辑的那一张电路叫
 * "当前层"，由 drillPath 标识：
 *   - 空路径：编辑顶层电路
 *   - ['id1','id2']：沿定义嵌套钻入 id1 -> id2，编辑 id2 的内部电路
 * 所有增删改都作用在当前层；双击 CUSTOM 实例即压栈钻入其定义（定义是共享的，
 * 改完返回后，引用该定义的全部实例立即按新定义求值）。
 *
 * 历史只记录"结构性"编辑（摆放、删除、移动、连线、断开、改名、封装、载入工程
 * 等），最多保留 HISTORY_LIMIT 步；开关取值属于输入激励，不入历史。
 * 钻入/弹出本身只是视图导航，不入历史。
 */

import type {
  Circuit,
  CircuitComponent,
  DeviceDefinition,
  PinDef,
  Project,
  Wire
} from './types';
import { uid } from './utils';
import { CUSTOM_WIDTH, componentHeight, snap } from './geometry';

export const HISTORY_LIMIT = 100;

export interface EditorState {
  project: Project;
  past: Project[];
  future: Project[];
  /** 当前编辑层：空 = 顶层；否则为定义 id 的钻入路径 */
  drillPath: string[];
  /** 多选（单击为单元素集合，框选/Shift 追加可多个）；连线选择与其互斥 */
  selectedComponentIds: string[];
  selectedWireId: string | null;
}

export type EditorAction =
  | { type: 'add-component'; component: CircuitComponent }
  | { type: 'delete-selected' }
  | { type: 'move-component'; id: string; x: number; y: number; commit: boolean; startX?: number; startY?: number }
  | { type: 'add-wire'; wire: Wire }
  | { type: 'delete-wire'; id: string }
  | { type: 'set-switch'; id: string; value: 0 | 1 }
  | { type: 'set-label'; id: string; label: string }
  | { type: 'set-input-count'; id: string; inputCount: number }
  | { type: 'select'; componentIds: string[]; wireId?: string | null }
  | {
      type: 'package-selection';
      name: string;
      /** 被收进定义的全部元件（含内部门、管脚 I/O） */
      internalComponentIds: string[];
      /** 其中作为对外输入管脚的 INPUT 元件（顺序 = 管脚顺序） */
      inputComponentIds: string[];
      /** 其中作为对外输出管脚的 OUTPUT 元件（顺序 = 管脚顺序） */
      outputComponentIds: string[];
      inputPinNames: string[];
      outputPinNames: string[];
    }
  | { type: 'drill-in'; definitionId: string }
  | { type: 'drill-out' }
  | { type: 'drill-jump'; path: string[] }
  | { type: 'delete-definition'; definitionId: string }
  | { type: 'rename-definition'; definitionId: string; name: string }
  | { type: 'clear-current-layer' }
  | { type: 'load-project'; project: Project; track?: boolean }
  | { type: 'undo' }
  | { type: 'redo' };

export const emptyCircuit: Circuit = { components: [], wires: [] };

export const emptyProject: Project = { version: 2, circuit: emptyCircuit, definitions: [] };

export const initialEditorState: EditorState = {
  project: emptyProject,
  past: [],
  future: [],
  drillPath: [],
  selectedComponentIds: [],
  selectedWireId: null
};

function pushHistory(state: EditorState, next: Project): EditorState {
  const past = [...state.past, state.project];
  if (past.length > HISTORY_LIMIT) past.shift();
  return {
    ...state,
    project: next,
    past,
    future: []
  };
}

export function currentCircuitOf(project: Project, path: string[]): Circuit {
  if (path.length === 0) return project.circuit;
  const def = project.definitions.find((d) => d.id === path[path.length - 1]);
  return def ? def.circuit : project.circuit;
}

/** 当前层电路 */
export function currentCircuit(state: EditorState): Circuit {
  return currentCircuitOf(state.project, state.drillPath);
}

/** 当前正在编辑的定义（顶层时为 null） */
export function currentDefinition(state: EditorState): DeviceDefinition | null {
  if (state.drillPath.length === 0) return null;
  return (
    state.project.definitions.find((d) => d.id === state.drillPath[state.drillPath.length - 1]) ??
    null
  );
}

/** 不可变地更新当前层电路，返回新 Project */
function withCurrentCircuit(project: Project, path: string[], updater: (c: Circuit) => Circuit): Project {
  if (path.length === 0) {
    return { ...project, circuit: updater(project.circuit) };
  }
  const targetId = path[path.length - 1];
  const definitions = project.definitions.map((d) =>
    d.id === targetId ? { ...d, circuit: updater(d.circuit) } : d
  );
  return { ...project, definitions };
}

/**
 * 封装：
 * 把当前层选区内的全部元件及"两端都在选区内"的连线抽成一份新 DeviceDefinition，
 * 原选区在当前层替换成一个 CUSTOM 实例。跨边界连线（一头在选区外）无法自动
 * 映射到管脚，按 Logisim 惯例直接丢弃——对外管脚只来自选区内的 INPUT/OUTPUT。
 */
function packageSelection(
  project: Project,
  path: string[],
  args: Extract<EditorAction, { type: 'package-selection' }>
): Project {
  const circuit = currentCircuitOf(project, path);
  const inside = new Set(args.internalComponentIds);
  const defMap = new Map(project.definitions.map((d) => [d.id, d]));

  const innerWires = circuit.wires.filter(
    (w) => inside.has(w.from.componentId) && inside.has(w.to.componentId)
  );
  const innerComponents = circuit.components.filter((c) => inside.has(c.id));

  const definitionId = uid('def');
  const mkPins = (ids: string[], names: string[], prefix: string): PinDef[] =>
    ids.map((componentId, i) => ({
      id: uid(`${prefix}pin`),
      name: names[i]?.trim() || undefined,
      componentId
    }));

  const definition: DeviceDefinition = {
    id: definitionId,
    name: args.name.trim(),
    inputs: mkPins(args.inputComponentIds, args.inputPinNames, 'in'),
    outputs: mkPins(args.outputComponentIds, args.outputPinNames, 'out'),
    circuit: { components: innerComponents, wires: innerWires }
  };

  const selectedComps = circuit.components.filter((c) => inside.has(c.id));
  const minX = Math.min(...selectedComps.map((c) => c.x));
  const minY = Math.min(...selectedComps.map((c) => c.y));
  const maxX = Math.max(
    ...selectedComps.map((c) => c.x + (c.type === 'CUSTOM' ? CUSTOM_WIDTH : 90))
  );
  const maxY = Math.max(...selectedComps.map((c) => c.y + componentHeight(c, defMap)));
  const instance: CircuitComponent = {
    id: uid('c'),
    type: 'CUSTOM',
    definitionId,
    x: snap((minX + maxX) / 2 - CUSTOM_WIDTH / 2),
    y: snap((minY + maxY) / 2 - 35)
  };

  const remaining: Circuit = {
    components: [...circuit.components.filter((c) => !inside.has(c.id)), instance],
    wires: circuit.wires.filter(
      (w) => !inside.has(w.from.componentId) && !inside.has(w.to.componentId)
    )
  };

  return {
    ...withCurrentCircuit(project, path, () => remaining),
    definitions: [...project.definitions, definition]
  };
}

/** 收集一张电路里引用到的全部定义 id */
function collectUsedIds(circuit: Circuit, into: Set<string>): void {
  for (const c of circuit.components) {
    if (c.type === 'CUSTOM' && c.definitionId) into.add(c.definitionId);
  }
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'add-component': {
      const next = withCurrentCircuit(state.project, state.drillPath, (c) => ({
        components: [...c.components, action.component],
        wires: c.wires
      }));
      return {
        ...pushHistory(state, next),
        selectedComponentIds: [action.component.id],
        selectedWireId: null
      };
    }

    case 'delete-selected': {
      if (state.selectedWireId) {
        const next = withCurrentCircuit(state.project, state.drillPath, (c) => ({
          ...c,
          wires: c.wires.filter((w) => w.id !== state.selectedWireId)
        }));
        return {
          ...pushHistory(state, next),
          selectedComponentIds: [],
          selectedWireId: null
        };
      }
      if (state.selectedComponentIds.length === 0) return state;
      const doomed = new Set(state.selectedComponentIds);
      const next = withCurrentCircuit(state.project, state.drillPath, (c) => ({
        components: c.components.filter((x) => !doomed.has(x.id)),
        wires: c.wires.filter(
          (w) => !doomed.has(w.from.componentId) && !doomed.has(w.to.componentId)
        )
      }));
      return {
        ...pushHistory(state, next),
        selectedComponentIds: [],
        selectedWireId: null
      };
    }

    case 'move-component': {
      const current = currentCircuit(state).components.find((c) => c.id === action.id);
      if (current && action.startX === current.x && action.startY === current.y) {
        return state;
      }
      const moved = withCurrentCircuit(state.project, state.drillPath, (c) => ({
        ...c,
        components: c.components.map((x) =>
          x.id === action.id ? { ...x, x: action.x, y: action.y } : x
        )
      }));
      if (!action.commit) return { ...state, project: moved };

      const before = withCurrentCircuit(state.project, state.drillPath, (c) => ({
        ...c,
        components: c.components.map((x) =>
          x.id === action.id
            ? { ...x, x: action.startX ?? x.x, y: action.startY ?? x.y }
            : x
        )
      }));
      const past = [...state.past, before];
      if (past.length > HISTORY_LIMIT) past.shift();
      return { ...state, project: moved, past, future: [] };
    }

    case 'add-wire': {
      const circuit = currentCircuit(state);
      if (
        circuit.wires.some(
          (w) =>
            w.to.componentId === action.wire.to.componentId &&
            w.to.port === action.wire.to.port
        )
      ) {
        return state; // 目标输入口已有驱动
      }
      const next = withCurrentCircuit(state.project, state.drillPath, (c) => ({
        components: c.components,
        wires: [...c.wires, action.wire]
      }));
      return pushHistory(state, next);
    }

    case 'delete-wire': {
      const next = withCurrentCircuit(state.project, state.drillPath, (c) => ({
        ...c,
        wires: c.wires.filter((w) => w.id !== action.id)
      }));
      return {
        ...pushHistory(state, next),
        selectedWireId: state.selectedWireId === action.id ? null : state.selectedWireId
      };
    }

    case 'set-switch': {
      // 输入激励：不入历史
      const next = withCurrentCircuit(state.project, state.drillPath, (c) => ({
        ...c,
        components: c.components.map((x) =>
          x.id === action.id && x.type === 'INPUT' ? { ...x, value: action.value } : x
        )
      }));
      return { ...state, project: next };
    }

    case 'set-label': {
      const next = withCurrentCircuit(state.project, state.drillPath, (c) => ({
        ...c,
        components: c.components.map((x) =>
          x.id === action.id ? { ...x, label: action.label } : x
        )
      }));
      return pushHistory(state, next);
    }

    case 'set-input-count': {
      const next = withCurrentCircuit(state.project, state.drillPath, (c) => ({
        components: c.components.map((x) =>
          x.id === action.id ? { ...x, inputCount: action.inputCount } : x
        ),
        wires: c.wires.filter((w) => {
          if (w.to.componentId !== action.id) return true;
          return w.to.port < action.inputCount;
        })
      }));
      return pushHistory(state, next);
    }

    case 'select':
      return {
        ...state,
        selectedComponentIds: action.componentIds,
        selectedWireId: action.wireId === undefined ? null : action.wireId
      };

    case 'package-selection': {
      if (
        action.internalComponentIds.length === 0 ||
        action.inputComponentIds.length === 0 ||
        action.outputComponentIds.length === 0 ||
        !action.name.trim()
      ) {
        return state;
      }
      const next = packageSelection(state.project, state.drillPath, action);
      return {
        ...pushHistory(state, next),
        selectedComponentIds: [],
        selectedWireId: null
      };
    }

    case 'drill-in': {
      // 正常工程无定义环；防御性地阻止沿同一路径重复钻入
      if (state.drillPath.includes(action.definitionId)) return state;
      return {
        ...state,
        drillPath: [...state.drillPath, action.definitionId],
        selectedComponentIds: [],
        selectedWireId: null
      };
    }

    case 'drill-out': {
      if (state.drillPath.length === 0) return state;
      return {
        ...state,
        drillPath: state.drillPath.slice(0, -1),
        selectedComponentIds: [],
        selectedWireId: null
      };
    }

    case 'drill-jump':
      return {
        ...state,
        drillPath: action.path,
        selectedComponentIds: [],
        selectedWireId: null
      };

    case 'delete-definition': {
      // 还有实例引用（含各定义内部的嵌套引用）时不允许删除
      const used = new Set<string>();
      collectUsedIds(state.project.circuit, used);
      state.project.definitions.forEach((d) => collectUsedIds(d.circuit, used));
      if (used.has(action.definitionId)) return state;
      const next: Project = {
        ...state.project,
        definitions: state.project.definitions.filter((d) => d.id !== action.definitionId)
      };
      const pushed = pushHistory(state, next);
      return {
        ...pushed,
        drillPath: state.drillPath.includes(action.definitionId)
          ? state.drillPath.slice(0, state.drillPath.indexOf(action.definitionId))
          : state.drillPath
      };
    }

    case 'rename-definition': {
      const name = action.name.trim();
      if (!name) return state;
      const next: Project = {
        ...state.project,
        definitions: state.project.definitions.map((d) =>
          d.id === action.definitionId ? { ...d, name } : d
        )
      };
      return pushHistory(state, next);
    }

    case 'clear-current-layer': {
      const next = withCurrentCircuit(state.project, state.drillPath, () => ({
        components: [],
        wires: []
      }));
      return {
        ...pushHistory(state, next),
        selectedComponentIds: [],
        selectedWireId: null
      };
    }

    case 'load-project': {
      if (action.track === false) {
        return { ...initialEditorState, project: action.project };
      }
      return {
        ...pushHistory(state, action.project),
        drillPath: [],
        selectedComponentIds: [],
        selectedWireId: null
      };
    }

    case 'undo': {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return {
        ...state,
        project: previous,
        past: state.past.slice(0, -1),
        future: [state.project, ...state.future].slice(0, HISTORY_LIMIT),
        drillPath: state.drillPath.every((id) => previous.definitions.some((d) => d.id === id))
          ? state.drillPath
          : [],
        selectedComponentIds: [],
        selectedWireId: null
      };
    }

    case 'redo': {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      return {
        ...state,
        project: next,
        future: state.future.slice(1),
        past: [...state.past, state.project].slice(-HISTORY_LIMIT),
        drillPath: state.drillPath.every((id) => next.definitions.some((d) => d.id === id))
          ? state.drillPath
          : [],
        selectedComponentIds: [],
        selectedWireId: null
      };
    }

    default:
      return state;
  }
}
