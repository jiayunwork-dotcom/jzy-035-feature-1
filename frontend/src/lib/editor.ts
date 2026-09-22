/**
 * 工程编辑器状态：顶层画布 + 自定义器件定义库 + 当前钻入的定义，
 * 以及元件/连线/定义的增删改与撤销/重做。
 *
 * 历史快照是整个 Project（连同当前打开的定义 id）：无论在顶层还是在某个
 * 定义内部做的结构性编辑都可以撤销，最多保留 HISTORY_LIMIT 步。输入开关的
 * 当前取值属于输入激励，不入历史。求值结果不进历史，由上层在工程变化时
 * 重新请求后端。
 *
 * "当前编辑的表" activeSheet：
 *  - null  -> project.circuit（顶层画布）
 *  - <id>  -> project.definitions 中该定义的内部电路（双击实例钻入）
 */

import type {
  Circuit,
  CircuitComponent,
  DeviceDefinition,
  Project,
  Wire
} from './types';

export const HISTORY_LIMIT = 100;

export interface EditorState {
  project: Project;
  /** null = 顶层；string = 正在内部编辑的定义 id */
  activeDefinitionId: string | null;
  past: Snapshot[];
  future: Snapshot[];
  /** 框选支持多选；单选时数组长度为 1 */
  selectedComponentIds: string[];
  selectedWireId: string | null;
}

interface Snapshot {
  project: Project;
  activeDefinitionId: string | null;
}

export type EditorAction =
  | { type: 'add-component'; component: CircuitComponent }
  | { type: 'delete-components'; ids: string[] }
  | { type: 'delete-wire'; id: string }
  | { type: 'move-component'; id: string; x: number; y: number; commit: boolean; startX?: number; startY?: number }
  | { type: 'add-wire'; wire: Wire }
  | { type: 'set-switch'; id: string; value: 0 | 1 }
  | { type: 'set-label'; id: string; label: string }
  | { type: 'set-input-count'; id: string; inputCount: number }
  | { type: 'replace-project'; project: Project; activeDefinitionId?: string | null; track?: boolean }
  | { type: 'select'; componentIds: string[] | null; wireId?: string | null }
  | { type: 'open-definition'; definitionId: string | null }
  | { type: 'add-definition'; definition: DeviceDefinition }
  | { type: 'update-definition'; definition: DeviceDefinition }
  | { type: 'rename-definition'; id: string; name: string }
  | { type: 'delete-definition'; id: string }
  | { type: 'undo' }
  | { type: 'redo' };

export const emptyProject: Project = {
  version: 2,
  circuit: { components: [], wires: [] },
  definitions: []
};

export const initialEditorState: EditorState = {
  project: emptyProject,
  activeDefinitionId: null,
  past: [],
  future: [],
  selectedComponentIds: [],
  selectedWireId: null
};

/** 当前正在编辑的电路表（顶层或某个定义的内部） */
export function activeCircuit(state: EditorState): Circuit {
  if (state.activeDefinitionId) {
    const def = state.project.definitions.find((d) => d.id === state.activeDefinitionId);
    if (def) return def.circuit;
  }
  return state.project.circuit;
}

export function activeDefinition(state: EditorState): DeviceDefinition | null {
  if (!state.activeDefinitionId) return null;
  return state.project.definitions.find((d) => d.id === state.activeDefinitionId) ?? null;
}

function snapshot(state: EditorState): Snapshot {
  return { project: state.project, activeDefinitionId: state.activeDefinitionId };
}

function pushHistory(state: EditorState, project: Project): EditorState {
  const past = [...state.past, snapshot(state)];
  if (past.length > HISTORY_LIMIT) past.shift();
  return {
    ...state,
    project,
    past,
    future: []
  };
}

/** 在当前活动表上做一次不可变更新，返回新的 Project */
function mapActiveCircuit(project: Project, activeId: string | null, fn: (c: Circuit) => Circuit): Project {
  if (!activeId) return { ...project, circuit: fn(project.circuit) };
  return {
    ...project,
    definitions: project.definitions.map((d) =>
      d.id === activeId ? { ...d, circuit: fn(d.circuit) } : d
    )
  };
}

function removeComponentsFromCircuit(circuit: Circuit, ids: string[]): Circuit {
  const idset = new Set(ids);
  return {
    components: circuit.components.filter((c) => !idset.has(c.id)),
    wires: circuit.wires.filter(
      (w) => !idset.has(w.from.componentId) && !idset.has(w.to.componentId)
    )
  };
}

/**
 * 删除一个器件定义：从所有表（顶层 + 其余每个定义内部）移除引用它的实例
 * 及其连线，保证删除后工程仍然结构合法。
 */
function purgeDefinitionInstances(project: Project, deviceId: string): Project {
  const purge = (circuit: Circuit): Circuit => {
    const doomed = new Set(
      circuit.components.filter((c) => c.type === 'SUB' && c.deviceId === deviceId).map((c) => c.id)
    );
    if (doomed.size === 0) return circuit;
    return {
      components: circuit.components.filter((c) => !doomed.has(c.id)),
      wires: circuit.wires.filter(
        (w) => !doomed.has(w.from.componentId) && !doomed.has(w.to.componentId)
      )
    };
  };
  return {
    version: 2,
    circuit: purge(project.circuit),
    definitions: project.definitions
      .filter((d) => d.id !== deviceId)
      .map((d) => ({ ...d, circuit: purge(d.circuit) }))
  };
}

/** 工程内某张表上每个 SUB 实例的输入端口数（结构校验/连线合法性用） */
export function inputPortCountFor(
  c: CircuitComponent,
  project: Project
): number {
  if (c.type === 'INPUT') return 0;
  if (c.type === 'OUTPUT') return 1;
  if (c.type === 'NOT') return 1;
  if (c.type === 'SUB') {
    return project.definitions.find((d) => d.id === c.deviceId)?.inputPins.length ?? 0;
  }
  return c.inputCount ?? 2;
}

export function outputPortCountFor(
  c: CircuitComponent,
  project: Project
): number {
  if (c.type === 'OUTPUT') return 0;
  if (c.type === 'SUB') {
    return project.definitions.find((d) => d.id === c.deviceId)?.outputPins.length ?? 0;
  }
  return 1;
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'add-component': {
      const next = mapActiveCircuit(state.project, state.activeDefinitionId, (c) => ({
        components: [...c.components, action.component],
        wires: c.wires
      }));
      return {
        ...pushHistory(state, next),
        selectedComponentIds: [action.component.id],
        selectedWireId: null
      };
    }

    case 'delete-components': {
      if (action.ids.length === 0 && !state.selectedWireId) return state;
      let next = state.project;
      if (state.selectedWireId) {
        next = mapActiveCircuit(next, state.activeDefinitionId, (c) => ({
          ...c,
          wires: c.wires.filter((w) => w.id !== state.selectedWireId)
        }));
      }
      if (action.ids.length > 0) {
        next = mapActiveCircuit(next, state.activeDefinitionId, (c) =>
          removeComponentsFromCircuit(c, action.ids)
        );
      }
      return {
        ...pushHistory(state, next),
        selectedComponentIds: [],
        selectedWireId: null
      };
    }

    case 'delete-wire': {
      const next = mapActiveCircuit(state.project, state.activeDefinitionId, (c) => ({
        ...c,
        wires: c.wires.filter((w) => w.id !== action.id)
      }));
      return {
        ...pushHistory(state, next),
        selectedWireId: state.selectedWireId === action.id ? null : state.selectedWireId
      };
    }

    case 'move-component': {
      const current = activeCircuit(state).components.find((c) => c.id === action.id);
      if (current && action.startX === current.x && action.startY === current.y) {
        return state;
      }
      const moved = mapActiveCircuit(state.project, state.activeDefinitionId, (c) => ({
        ...c,
        components: c.components.map((x) =>
          x.id === action.id ? { ...x, x: action.x, y: action.y } : x
        )
      }));
      if (!action.commit) return { ...state, project: moved };

      // 松手提交：把"拖动起点"的版本压入历史，一次拖动只占一步
      const before = mapActiveCircuit(state.project, state.activeDefinitionId, (c) => ({
        ...c,
        components: c.components.map((x) =>
          x.id === action.id
            ? { ...x, x: action.startX ?? x.x, y: action.startY ?? x.y }
            : x
        )
      }));
      const past = [...state.past, { project: before, activeDefinitionId: state.activeDefinitionId }];
      if (past.length > HISTORY_LIMIT) past.shift();
      return { ...state, project: moved, past, future: [] };
    }

    case 'add-wire': {
      const circuit = activeCircuit(state);
      if (
        circuit.wires.some(
          (w) =>
            w.to.componentId === action.wire.to.componentId &&
            w.to.port === action.wire.to.port
        )
      ) {
        return state; // 目标输入口已有驱动
      }
      const next = mapActiveCircuit(state.project, state.activeDefinitionId, (c) => ({
        components: c.components,
        wires: [...c.wires, action.wire]
      }));
      return pushHistory(state, next);
    }

    case 'set-switch': {
      // 输入激励：不入历史
      const project = mapActiveCircuit(state.project, state.activeDefinitionId, (c) => ({
        ...c,
        components: c.components.map((x) =>
          x.id === action.id && x.type === 'INPUT' ? { ...x, value: action.value } : x
        )
      }));
      return { ...state, project };
    }

    case 'set-label': {
      const project = mapActiveCircuit(state.project, state.activeDefinitionId, (c) => ({
        ...c,
        components: c.components.map((x) =>
          x.id === action.id ? { ...x, label: action.label } : x
        )
      }));
      return pushHistory(state, project);
    }

    case 'set-input-count': {
      // 缩小输入数时，删除落在范围外的连线
      const project = mapActiveCircuit(state.project, state.activeDefinitionId, (c) => ({
        components: c.components.map((x) =>
          x.id === action.id ? { ...x, inputCount: action.inputCount } : x
        ),
        wires: c.wires.filter((w) => {
          if (w.to.componentId !== action.id) return true;
          return w.to.port < action.inputCount;
        })
      }));
      return pushHistory(state, project);
    }

    case 'replace-project': {
      const next = action.project;
      const activeDefinitionId = action.activeDefinitionId ?? null;
      if (action.track === false) {
        return {
          ...state,
          project: next,
          activeDefinitionId,
          selectedComponentIds: [],
          selectedWireId: null
        };
      }
      return {
        ...pushHistory(state, next),
        activeDefinitionId,
        selectedComponentIds: [],
        selectedWireId: null
      };
    }

    case 'select':
      return {
        ...state,
        selectedComponentIds: action.componentIds ?? [],
        selectedWireId: action.wireId === undefined ? null : action.wireId
      };

    case 'open-definition': {
      // 钻入/钻出：清选择，历史不动（视图切换不是结构编辑）
      return {
        ...state,
        activeDefinitionId: action.definitionId,
        selectedComponentIds: [],
        selectedWireId: null
      };
    }

    case 'add-definition': {
      if (state.project.definitions.some((d) => d.id === action.definition.id)) return state;
      const project: Project = {
        ...state.project,
        definitions: [...state.project.definitions, action.definition]
      };
      return pushHistory(state, project);
    }

    case 'update-definition': {
      const project: Project = {
        ...state.project,
        definitions: state.project.definitions.map((d) =>
          d.id === action.definition.id ? action.definition : d
        )
      };
      return pushHistory(state, project);
    }

    case 'rename-definition': {
      const project: Project = {
        ...state.project,
        definitions: state.project.definitions.map((d) =>
          d.id === action.id ? { ...d, name: action.name } : d
        )
      };
      return pushHistory(state, project);
    }

    case 'delete-definition': {
      const purged = purgeDefinitionInstances(state.project, action.id);
      const next: EditorState = {
        ...pushHistory(state, purged),
        activeDefinitionId:
          state.activeDefinitionId === action.id ? null : state.activeDefinitionId,
        selectedComponentIds: [],
        selectedWireId: null
      };
      return next;
    }

    case 'undo': {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return {
        ...state,
        project: previous.project,
        activeDefinitionId: previous.activeDefinitionId,
        past: state.past.slice(0, -1),
        future: [snapshot(state), ...state.future].slice(0, HISTORY_LIMIT),
        selectedComponentIds: [],
        selectedWireId: null
      };
    }

    case 'redo': {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      return {
        ...state,
        project: next.project,
        activeDefinitionId: next.activeDefinitionId,
        future: state.future.slice(1),
        past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
        selectedComponentIds: [],
        selectedWireId: null
      };
    }

    default:
      return state;
  }
}
