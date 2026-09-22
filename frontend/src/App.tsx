/**
 * 应用外壳：
 *  左工具栏（内置门 + 自定义器件库）/ 中画布（顶层或某个器件内部）/
 *  右 Tab（分析、卡诺图、关卡、属性）；
 *  顶部：撤销、重做、保存/读取工程、清空、缩放复位，以及"封装为器件"；
 *  面包屑显示当前位于顶层还是某个自定义器件内部（双击实例可钻入）。
 *
 * 工程每次变化都防抖请求后端 /api/evaluate（携带 definitions），实时刷新
 * 线色与输出灯；跨层循环引用会在求值前被后端拒绝并红条提示。
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Toolbar } from './components/Toolbar';
import { Canvas } from './components/Canvas';
import { AnalysisPanel } from './components/AnalysisPanel';
import { KarnaughPanel } from './components/KarnaughPanel';
import { LevelsPanel } from './components/LevelsPanel';
import { PropertyPanel } from './components/PropertyPanel';
import { PackageDialog } from './components/PackageDialog';
import {
  activeCircuit,
  activeDefinition,
  editorReducer,
  initialEditorState,
  type EditorAction
} from './lib/editor';
import { evaluateCircuit } from './lib/api';
import type {
  Circuit,
  CircuitComponent,
  DeviceDefinition,
  EvalResult,
  GateType,
  Project
} from './lib/types';
import { downloadJson, readTextFile, uid } from './lib/utils';
import { snap } from './lib/geometry';
import { makeInstance, selectedIO } from './lib/packaging';

type Tab = 'analysis' | 'kmap' | 'levels' | 'props';

const STORAGE_KEY = 'logiclab-project-v2';
const LEGACY_STORAGE_KEY = 'logiclab-circuit-v1';

/** 归一化读取的 JSON：兼容旧版 {components,wires} 扁平文件 */
function parseProject(data: unknown): { project: Project; error?: string } {
  if (!data || typeof data !== 'object') return { project: initialEditorState.project, error: '文件不是合法 JSON 对象' };
  const obj = data as Record<string, unknown>;
  if (obj.circuit && Array.isArray((obj.circuit as Circuit).components) && Array.isArray((obj.circuit as Circuit).wires)) {
    return {
      project: {
        version: 2,
        circuit: obj.circuit as Circuit,
        definitions: Array.isArray(obj.definitions) ? (obj.definitions as DeviceDefinition[]) : []
      }
    };
  }
  if (Array.isArray(obj.components) && Array.isArray(obj.wires)) {
    return {
      project: { version: 2, circuit: obj as unknown as Circuit, definitions: [] }
    };
  }
  return { project: initialEditorState.project, error: '文件格式不正确：缺少 components/wires（旧版）或 circuit（新版工程）' };
}

/** 启动初始状态：优先恢复 v2 工程；只有 v1 扁平暂存时迁移 */
function createInitialState(): typeof initialEditorState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const { project } = parseProject(JSON.parse(saved));
      return { ...initialEditorState, project };
    }
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy);
      if (Array.isArray(parsed.components) && Array.isArray(parsed.wires)) {
        return {
          ...initialEditorState,
          project: { version: 2, circuit: parsed, definitions: [] }
        };
      }
    }
  } catch {
    /* ignore */
  }
  return initialEditorState;
}

export default function App() {
  const [state, dispatch] = useReducer(editorReducer, undefined, createInitialState);

  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);
  const [tab, setTab] = useState<Tab>('analysis');
  const [packaging, setPackaging] = useState(false);
  const evalSeq = useRef(0);

  const { project, activeDefinitionId } = state;
  const definitions = project.definitions;
  const circuit = activeCircuit(state);
  const editingDef = activeDefinition(state);
  const { components, wires } = circuit;

  // 实时求值：当前表（含完整定义库）变化后 120ms 防抖请求后端
  useEffect(() => {
    const seq = ++evalSeq.current;
    const handle = setTimeout(() => {
      evaluateCircuit(circuit, definitions)
        .then((r) => {
          if (seq === evalSeq.current) setEvalResult(r);
        })
        .catch(() => {
          if (seq === evalSeq.current) setEvalResult(null);
        });
    }, 120);
    return () => clearTimeout(handle);
  }, [circuit, definitions]);

  // 自动保存工程到 localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    } catch {
      /* quota 等情况忽略 */
    }
  }, [project]);

  // 键盘快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') {
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        dispatch({ type: 'redo' });
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.selectedComponentIds.length > 0 || state.selectedWireId) {
          e.preventDefault();
          dispatch({ type: 'delete-components', ids: state.selectedComponentIds });
        }
      } else if (e.key === 'Escape') {
        dispatch({ type: 'open-definition', definitionId: null });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.selectedComponentIds, state.selectedWireId]);

  const addComponent = useCallback((type: GateType | 'INPUT' | 'OUTPUT') => {
    const comp: CircuitComponent = {
      id: uid('c'),
      type,
      x: snap(240 + Math.random() * 120),
      y: snap(120 + Math.random() * 160),
      value: type === 'INPUT' ? 0 : undefined,
      inputCount:
        type !== 'INPUT' && type !== 'OUTPUT' && type !== 'NOT' ? 2 : undefined
    };
    dispatch({ type: 'add-component', component: comp });
  }, []);

  const addDeviceInstance = useCallback((def: DeviceDefinition) => {
    const comp = makeInstance(def, snap(240 + Math.random() * 120), snap(120 + Math.random() * 160));
    dispatch({ type: 'add-component', component: comp });
  }, []);

  const save = () => {
    const payload: Project = { version: 2, circuit: project.circuit, definitions };
    downloadJson(
      `logiclab-project-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`,
      payload
    );
  };

  const load = async () => {
    try {
      const text = await readTextFile();
      const { project: loaded, error } = parseProject(JSON.parse(text));
      if (error) {
        alert(error);
        return;
      }
      dispatch({ type: 'replace-project', project: loaded, activeDefinitionId: null });
    } catch (e) {
      alert(`读取失败：${(e as Error).message}`);
    }
  };

  const clearAll = () => {
    if (components.length === 0 && wires.length === 0) return;
    const scope = editingDef ? `器件“${editingDef.name}”的内部电路` : '当前画布';
    if (confirm(`确定清空${scope}？此操作可撤销。`)) {
      if (editingDef) {
        dispatch({
          type: 'update-definition',
          definition: { ...editingDef, circuit: { components: [], wires: [] } }
        });
      } else {
        dispatch({
          type: 'replace-project',
          project: { ...project, circuit: { components: [], wires: [] } }
        });
      }
    }
  };

  const selectedComponent = useMemo(
    () => components.find((c) => c.id === state.selectedComponentIds[0]) ?? null,
    [components, state.selectedComponentIds]
  );

  // 封装按钮可用性
  const selectionIO = useMemo(
    () => selectedIO(circuit, state.selectedComponentIds),
    [circuit, state.selectedComponentIds]
  );
  const canPackage =
    state.selectedComponentIds.length > 0 && selectionIO.outputs.length > 0;

  const cycleError =
    evalResult && !evalResult.ok && evalResult.error.kind === 'cycle'
      ? evalResult.error
      : null;
  const definitionCycleError =
    evalResult && !evalResult.ok && evalResult.error.kind === 'definition-cycle'
      ? evalResult.error
      : null;
  const validationError =
    evalResult && !evalResult.ok && evalResult.error.kind === 'validation'
      ? evalResult.error
      : null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">▣</span> LogicLab
          <small>分层组合逻辑电路实验台</small>
        </div>
        <div className="top-actions">
          <button
            className="ghost-btn"
            disabled={state.past.length === 0}
            onClick={() => dispatch({ type: 'undo' })}
            title="撤销 (Ctrl+Z)"
          >
            ↶ 撤销
          </button>
          <button
            className="ghost-btn"
            disabled={state.future.length === 0}
            onClick={() => dispatch({ type: 'redo' })}
            title="重做 (Ctrl+Shift+Z)"
          >
            ↷ 重做
          </button>
          <span className="history-count">
            历史 {state.past.length}/{state.past.length + state.future.length}
          </span>
          <span className="divider" />
          <button
            className="accent-btn"
            disabled={!canPackage}
            onClick={() => setPackaging(true)}
            title={canPackage ? '把圈选的电路封装成自定义器件' : '先 Shift+拖框 圈选含输出灯的电路'}
          >
            📦 封装为器件{state.selectedComponentIds.length > 0 ? `（${state.selectedComponentIds.length}）` : ''}
          </button>
          <span className="divider" />
          <button className="ghost-btn" onClick={save}>💾 保存</button>
          <button className="ghost-btn" onClick={load}>📂 读取</button>
          <button className="ghost-btn danger-text" onClick={clearAll}>清空</button>
        </div>
      </header>

      {/* 层级面包屑：顶层 / 器件内部 */}
      <div className="breadcrumb">
        <button
          className={activeDefinitionId === null ? 'crumb active' : 'crumb'}
          onClick={() => dispatch({ type: 'open-definition', definitionId: null })}
        >
          顶层电路
        </button>
        {editingDef && (
          <>
            <span className="crumb-sep">/</span>
            <span className="crumb active" title="正在编辑该器件的内部电路">
              📦 {editingDef.name}
              <small>（修改后所有实例同步；Esc 返回顶层）</small>
            </span>
          </>
        )}
        <span className="breadcrumb-spacer" />
        <span className="muted small">
          {editingDef
            ? `内部视图：${components.length} 个元件`
            : `器件库 ${definitions.length} 个自定义器件`}
        </span>
      </div>

      <div className="main">
        <Toolbar
          onAddGate={(t: GateType) => addComponent(t)}
          onAddIO={(t) => addComponent(t)}
          definitions={definitions}
          onAddDevice={addDeviceInstance}
          onOpenDevice={(id) => dispatch({ type: 'open-definition', definitionId: id })}
          onDeleteDevice={(id) => dispatch({ type: 'delete-definition', id })}
          editingDefinition={editingDef}
        />

        <main className="canvas-wrap">
          {definitionCycleError && (
            <div className="banner error-banner">
              ⛔ {definitionCycleError.message}
            </div>
          )}
          {cycleError && (
            <div className="banner error-banner">
              ⚠ {cycleError.message}
            </div>
          )}
          {validationError && (
            <div className="banner warn-banner">
              ⚠ {validationError.message}
            </div>
          )}
          <Canvas
            components={components}
            wires={wires}
            definitions={definitions}
            evalResult={evalResult}
            selectedComponentIds={state.selectedComponentIds}
            selectedWireId={state.selectedWireId}
            dispatch={dispatch as (a: EditorAction) => void}
            onOpenInstance={(deviceId) =>
              dispatch({ type: 'open-definition', definitionId: deviceId })
            }
          />
          <div className="canvas-legend">
            <span><i className="line one" /> 信号 1</span>
            <span><i className="line zero" /> 信号 0</span>
            <span><i className="line unk" /> 未确定（输入悬空）</span>
            <span className="legend-tip">Shift+拖框 圈选 · 双击方块 钻入</span>
          </div>
        </main>

        <section className="sidebar">
          <nav className="tabs">
            <TabButton id="analysis" current={tab} onClick={setTab}>真值表/表达式</TabButton>
            <TabButton id="kmap" current={tab} onClick={setTab}>卡诺图</TabButton>
            <TabButton id="levels" current={tab} onClick={setTab}>关卡</TabButton>
            <TabButton id="props" current={tab} onClick={setTab}>
              属性{selectedComponent ? ' ●' : ''}
            </TabButton>
          </nav>
          <div className="tab-body">
            {tab === 'analysis' && (
              <AnalysisPanel components={components} circuit={circuit} definitions={definitions} />
            )}
            {tab === 'kmap' && (
              <KarnaughPanel components={components} wires={wires} definitions={definitions} />
            )}
            {tab === 'levels' && (
              <LevelsPanel circuit={circuit} definitions={definitions} />
            )}
            {tab === 'props' && (
              <PropertyPanel
                component={selectedComponent}
                selectedIds={state.selectedComponentIds}
                definitions={definitions}
                dispatch={dispatch as (a: EditorAction) => void}
              />
            )}
          </div>
        </section>
      </div>

      {packaging && (
        <PackageDialog
          circuit={circuit}
          selectedComponentIds={state.selectedComponentIds}
          existingNames={definitions.map((d) => d.name)}
          onCancel={() => setPackaging(false)}
          onConfirm={(def) => {
            if (definitions.some((d) => d.name === def.name)) {
              alert(`已存在同名器件“${def.name}”，请换个名字`);
              return;
            }
            dispatch({ type: 'add-definition', definition: def });
            setPackaging(false);
            // 封装完成后不跳转页面，用户可立即从左侧库拖出新实例
          }}
        />
      )}
    </div>
  );
}

function TabButton({
  id,
  current,
  onClick,
  children
}: {
  id: Tab;
  current: Tab;
  onClick: (t: Tab) => void;
  children: React.ReactNode;
}) {
  return (
    <button className={`tab ${current === id ? 'active' : ''}`} onClick={() => onClick(id)}>
      {children}
    </button>
  );
}
