/**
 * 电路编辑器状态：元件/连线的增删改 + 撤销/重做。
 *
 * 历史只记录"结构性"编辑（摆放、删除、移动、连线、断开、改名、改输入数），
 * 最多保留 HISTORY_LIMIT 步；输入开关的当前取值属于输入激励而非结构，
 * 不入历史。求值结果不进历史，由上层在电路变化时重新请求后端。
 */

import type { Circuit, CircuitComponent, Wire } from './types';

export const HISTORY_LIMIT = 100;

export interface EditorState {
  present: Circuit;
  past: Circuit[];
  future: Circuit[];
  selectedComponentId: string | null;
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
  | { type: 'replace-all'; circuit: Circuit; track?: boolean }
  | { type: 'select'; componentId: string | null; wireId?: string | null }
  | { type: 'undo' }
  | { type: 'redo' };

export const emptyCircuit: Circuit = { components: [], wires: [] };

export const initialEditorState: EditorState = {
  present: emptyCircuit,
  past: [],
  future: [],
  selectedComponentId: null,
  selectedWireId: null
};

function pushHistory(state: EditorState, next: Circuit): EditorState {
  const past = [...state.past, state.present];
  if (past.length > HISTORY_LIMIT) past.shift();
  return {
    ...state,
    present: next,
    past,
    future: []
  };
}

function removeComponent(circuit: Circuit, id: string): Circuit {
  return {
    components: circuit.components.filter((c) => c.id !== id),
    wires: circuit.wires.filter(
      (w) => w.from.componentId !== id && w.to.componentId !== id
    )
  };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'add-component': {
      const next: Circuit = {
        components: [...state.present.components, action.component],
        wires: state.present.wires
      };
      return { ...pushHistory(state, next), selectedComponentId: action.component.id, selectedWireId: null };
    }

    case 'delete-selected': {
      if (!state.selectedComponentId && !state.selectedWireId) return state;
      let next = state.present;
      if (state.selectedWireId) {
        next = { ...next, wires: next.wires.filter((w) => w.id !== state.selectedWireId) };
      }
      if (state.selectedComponentId) {
        next = removeComponent(next, state.selectedComponentId);
      }
      return {
        ...pushHistory(state, next),
        selectedComponentId: null,
        selectedWireId: null
      };
    }

    case 'move-component': {
      // 松手时 commit:true，并把拖动起点位置 startX/startY 重建成"上一状态"入历史，
      // 保证一次拖动在 undo 里只占一步；位置未变（只是单击）则不入历史。
      // 比较"拖动起点位置"与"当前 present 位置"：相同说明只是一次单击、
      // 元件根本没动过，不入历史。
      const current = state.present.components.find((c) => c.id === action.id);
      if (current && action.startX === current.x && action.startY === current.y) {
        return state;
      }
      const moved = state.present.components.map((c) =>
        c.id === action.id ? { ...c, x: action.x, y: action.y } : c
      );
      const next = { ...state.present, components: moved };
      if (!action.commit) return { ...state, present: next };

      const before: Circuit = {
        ...state.present,
        components: state.present.components.map((c) =>
          c.id === action.id
            ? { ...c, x: action.startX ?? c.x, y: action.startY ?? c.y }
            : c
        )
      };
      const past = [...state.past, before];
      if (past.length > HISTORY_LIMIT) past.shift();
      return { ...state, present: next, past, future: [] };
    }

    case 'add-wire': {
      if (
        state.present.wires.some(
          (w) =>
            w.to.componentId === action.wire.to.componentId &&
            w.to.port === action.wire.to.port
        )
      ) {
        return state; // 目标输入口已有驱动
      }
      const next: Circuit = {
        components: state.present.components,
        wires: [...state.present.wires, action.wire]
      };
      return pushHistory(state, next);
    }

    case 'delete-wire': {
      const next: Circuit = {
        ...state.present,
        wires: state.present.wires.filter((w) => w.id !== action.id)
      };
      return {
        ...pushHistory(state, next),
        selectedWireId: state.selectedWireId === action.id ? null : state.selectedWireId
      };
    }

    case 'set-switch': {
      // 输入激励：不入历史
      const components = state.present.components.map((c) =>
        c.id === action.id && c.type === 'INPUT' ? { ...c, value: action.value } : c
      );
      return { ...state, present: { ...state.present, components } };
    }

    case 'set-label': {
      const components = state.present.components.map((c) =>
        c.id === action.id ? { ...c, label: action.label } : c
      );
      return pushHistory(state, { ...state.present, components });
    }

    case 'set-input-count': {
      // 缩小输入数时，删除落在范围外的连线
      const components = state.present.components.map((c) =>
        c.id === action.id ? { ...c, inputCount: action.inputCount } : c
      );
      const wires = state.present.wires.filter((w) => {
        if (w.to.componentId !== action.id) return true;
        return w.to.port < action.inputCount;
      });
      return pushHistory(state, { components, wires });
    }

    case 'replace-all': {
      const next = action.circuit;
      if (action.track === false) {
        return {
          ...state,
          present: next,
          selectedComponentId: null,
          selectedWireId: null
        };
      }
      return {
        ...pushHistory(state, next),
        selectedComponentId: null,
        selectedWireId: null
      };
    }

    case 'select':
      return {
        ...state,
        selectedComponentId: action.componentId,
        selectedWireId: action.wireId === undefined ? null : action.wireId
      };

    case 'undo': {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return {
        ...state,
        present: previous,
        past: state.past.slice(0, -1),
        future: [state.present, ...state.future].slice(0, HISTORY_LIMIT),
        selectedComponentId: null,
        selectedWireId: null
      };
    }

    case 'redo': {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      return {
        ...state,
        present: next,
        future: state.future.slice(1),
        past: [...state.past, state.present].slice(-HISTORY_LIMIT),
        selectedComponentId: null,
        selectedWireId: null
      };
    }

    default:
      return state;
  }
}
