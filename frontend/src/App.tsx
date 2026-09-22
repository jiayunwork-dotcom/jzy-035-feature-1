/**
 * 应用外壳：
 *  左器件库（内置门 + 自定义器件）/ 中分层画布 / 右 Tab（分析、卡诺图、关卡、属性）；
 *  顶部工具条：撤销、重做、保存、读取、清空、封装成器件、钻入面包屑；
 *  电路每次变化都防抖请求后端 /api/evaluate（随请求带上全部器件定义），
 *  实时刷新线色与输出灯；Ctrl/Cmd+Z 撤销、Ctrl/Cmd+Shift+Z 重做、Delete 删除。
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Toolbar } from './components/Toolbar';
import { Canvas } from './components/Canvas';
import { AnalysisPanel } from './components/AnalysisPanel';
import { KarnaughPanel } from './components/KarnaughPanel';
import { LevelsPanel } from './components/LevelsPanel';
import { PropertyPanel } from './components/PropertyPanel';
import { PackageDialog, type PackageConfig } from './components/PackageDialog';
import { DefinitionsManager } from './components/DefinitionsManager';
import {
  currentCircuit,
  currentDefinition,
  editorReducer,
  initialEditorState,
  type EditorAction
} from './lib/editor';
import { evaluateCircuit } from './lib/api';
import type {
  CircuitComponent,
  ComponentType,
  DeviceDefinition,
  EvalResult,
  GateType,
  Project,
  Wire
} from './lib/types';
import { downloadJson, readTextFile, uid } from './lib/utils';
import { snap } from './lib/geometry';
import { asProject, classifySelection, isLegacyDoc } from './lib/project';

type Tab = 'analysis' | 'kmap' | 'levels' | 'props';

const STORAGE_KEY = 'logiclab-project-v2';
const LEGACY_STORAGE_KEY = 'logiclab-circuit-v1';

export default function App() {
  const [state, dispatch] = useReducer(editorReducer, undefined, () => {
    // 启动恢复：优先读 v2 工程；没有则尝试把 v1 裸电路迁移为 v2
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const project = asProject(parsed);
        if (!('error' in project)) {
          return { ...initialEditorState, project };
        }
      }
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        const parsed = JSON.parse(legacy);
        if (isLegacyDoc(parsed)) {
          const project = asProject(parsed);
          if (!('error' in project)) {
            return { ...initialEditorState, project };
          }
        }
      }
    } catch {
      /* ignore */
    }
    return initialEditorState;
  });

  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);
  const [tab, setTab] = useState<Tab>('analysis');
  const [showPackage, setShowPackage] = useState(false);
  const [showDefsManager, setShowDefsManager] = useState(false);
  const evalSeq = useRef(0);

  const project: Project = state.project;
  const circuit = currentCircuit(state);
  const { components, wires } = circuit;
  const definitions = project.definitions;
  const editingDef = currentDefinition(state);
  const defMap = useMemo(
    () => new Map(definitions.map((d) => [d.id, d])),
    [definitions]
  );

  // 实时求值：当前层变化（结构或开关值）后 120ms 防抖，带上全部器件定义
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

  // 自动保存 v2 工程（不阻塞）
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
      if (e.key === 'Escape') {
        if (state.selectedComponentIds.length > 0 || state.selectedWireId) {
          dispatch({ type: 'select', componentIds: [], wireId: null });
        } else if (state.drillPath.length > 0) {
          dispatch({ type: 'drill-out' });
        }
      } else if (mod && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        if (canPackage) setShowPackage(true);
      } else if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        dispatch({ type: 'redo' });
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.selectedComponentIds.length > 0 || state.selectedWireId) {
          e.preventDefault();
          dispatch({ type: 'delete-selected' });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.selectedComponentIds, state.selectedWireId, state.drillPath.length]);

  const addComponent = useCallback((type: ComponentType) => {
    const comp: CircuitComponent = {
      id: uid('c'),
      type,
      x: snap(240 + Math.random() * 120),
      y: snap(120 + Math.random() * 160),
      value: type === 'INPUT' ? 0 : undefined,
      inputCount:
        type !== 'INPUT' && type !== 'OUTPUT' && type !== 'NOT' && type !== 'CUSTOM' ? 2 : undefined
    };
    dispatch({ type: 'add-component', component: comp });
  }, []);

  const addInstance = useCallback((def: DeviceDefinition) => {
    const comp: CircuitComponent = {
      id: uid('c'),
      type: 'CUSTOM',
      definitionId: def.id,
      x: snap(240 + Math.random() * 120),
      y: snap(120 + Math.random() * 160)
    };
    dispatch({ type: 'add-component', component: comp });
  }, []);

  const save = () => {
    downloadJson(
      `logiclab-project-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`,
      project
    );
  };

  const load = async () => {
    try {
      const text = await readTextFile();
      const parsed = JSON.parse(text);
      const projectOrErr = asProject(parsed);
      if ('error' in projectOrErr) {
        alert(`文件格式不正确：${projectOrErr.error}`);
        return;
      }
      dispatch({ type: 'load-project', project: projectOrErr });
    } catch (e) {
      alert(`读取失败：${(e as Error).message}`);
    }
  };

  const clearAll = () => {
    if (components.length === 0 && wires.length === 0) return;
    if (confirm('确定清空当前这一层？（器件定义保留；此操作可撤销）')) {
      dispatch({ type: 'clear-current-layer' });
    }
  };

  // 封装对话框所需的选区分类
  const selection = useMemo(
    () => classifySelection(circuit, state.selectedComponentIds),
    [circuit, state.selectedComponentIds]
  );
  const canPackage =
    selection.inputs.length > 0 && selection.outputs.length > 0 && selection.all.length >= 2;

  const crossingWireCount = useMemo(() => {
    const inside = new Set(selection.all.map((c) => c.id));
    return wires.filter(
      (w) => inside.has(w.from.componentId) !== inside.has(w.to.componentId)
    ).length;
  }, [wires, selection.all]);

  const confirmPackage = (cfg: PackageConfig) => {
    dispatch({
      type: 'package-selection',
      name: cfg.name,
      internalComponentIds: selection.all.map((c) => c.id),
      inputComponentIds: cfg.inputs.map((p) => p.id),
      outputComponentIds: cfg.outputs.map((p) => p.id),
      inputPinNames: cfg.inputs.map((p) => p.pinName),
      outputPinNames: cfg.outputs.map((p) => p.pinName)
    });
    setShowPackage(false);
  };

  const selectedComponent =
    state.selectedComponentIds.length === 1
      ? components.find((c) => c.id === state.selectedComponentIds[0]) ?? null
      : null;
  const selectedDef =
    selectedComponent?.type === 'CUSTOM' && selectedComponent.definitionId
      ? defMap.get(selectedComponent.definitionId) ?? null
      : null;

  const cycleError =
    evalResult && !evalResult.ok && evalResult.error.kind === 'cycle'
      ? evalResult.error
      : null;
  const defCycleError =
    evalResult && !evalResult.ok && evalResult.error.kind === 'definition-cycle'
      ? evalResult.error
      : null;
  const validationError =
    evalResult && !evalResult.ok && evalResult.error.kind === 'validation'
      ? evalResult.error
      : null;

  // 面包屑：顶层 / 甲 / 乙
  const breadcrumbs: { label: string; path: string[] }[] = [
    { label: '顶层电路', path: [] }
  ];
  state.drillPath.forEach((id, i) => {
    const d = defMap.get(id);
    breadcrumbs.push({ label: d?.name ?? id, path: state.drillPath.slice(0, i + 1) });
  });

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
          <button className="primary-btn" disabled={!canPackage} onClick={() => setShowPackage(true)} title="把选中电路封装成自定义器件 (Ctrl+G)">
            📦 封装成器件{state.selectedComponentIds.length > 0 ? `（${state.selectedComponentIds.length}）` : ''}
          </button>
          <span className="divider" />
          <button className="ghost-btn" onClick={save}>💾 保存</button>
          <button className="ghost-btn" onClick={load}>📂 读取</button>
          <button className="ghost-btn danger-text" onClick={clearAll}>清空本层</button>
        </div>
      </header>

      <nav className="breadcrumb">
        {breadcrumbs.map((b, i) => (
          <span key={i} className="crumb-wrap">
            {i > 0 && <span className="crumb-sep">/</span>}
            <button
              className={`crumb ${i === breadcrumbs.length - 1 ? 'current' : ''}`}
              onClick={() =>
                i === breadcrumbs.length - 1
                  ? undefined
                  : dispatch({ type: 'drill-jump', path: b.path })
              }
            >
              {b.label}
            </button>
          </span>
        ))}
        {state.drillPath.length > 0 && (
          <button className="ghost-btn crumb-out" onClick={() => dispatch({ type: 'drill-out' })}>
            ← 返回上一层
          </button>
        )}
      </nav>

      <div className="main">
        <Toolbar
          onAddGate={(t: GateType) => addComponent(t)}
          onAddIO={(t) => addComponent(t)}
          definitions={definitions}
          onAddInstance={addInstance}
          onManageDefinitions={() => setShowDefsManager(true)}
        />

        <main className="canvas-wrap">
          {defCycleError && (
            <div className="banner error-banner">⚠ {defCycleError.message}</div>
          )}
          {cycleError && (
            <div className="banner error-banner">
              ⚠ {cycleError.message}
              {cycleError.layer ? `（位于器件「${cycleError.layer}」内部）` : ''}
            </div>
          )}
          {validationError && (
            <div className="banner warn-banner">⚠ {validationError.message}</div>
          )}
          {editingDef && (
            <div className="banner info-banner">
              正在编辑器件「{editingDef.name}」的内部电路 —— 修改的是共享定义，保存后所有引用它的实例都会更新。
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
          />
          <div className="canvas-legend">
            <span><i className="line one" /> 信号 1</span>
            <span><i className="line zero" /> 信号 0</span>
            <span><i className="line unk" /> 未确定（输入悬空）</span>
            <span className="hint-shift">Shift+拖拽空白框选 · 双击方块钻入</span>
          </div>
        </main>

        <section className="sidebar">
          <nav className="tabs">
            <TabButton id="analysis" current={tab} onClick={setTab}>真值表/表达式</TabButton>
            <TabButton id="kmap" current={tab} onClick={setTab}>卡诺图</TabButton>
            <TabButton id="levels" current={tab} onClick={setTab}>关卡</TabButton>
            <TabButton id="props" current={tab} onClick={setTab}>
              属性{state.selectedComponentIds.length > 0 ? ' ●' : ''}
            </TabButton>
          </nav>
          <div className="tab-body">
            {tab === 'analysis' && (
              <AnalysisPanel components={components} circuit={circuit} definitions={definitions} />
            )}
            {tab === 'kmap' && (
              <KarnaughPanel components={components} wires={wires as Wire[]} definitions={definitions} />
            )}
            {tab === 'levels' && <LevelsPanel circuit={circuit} definitions={definitions} />}
            {tab === 'props' && (
              <PropertyPanel
                component={selectedComponent}
                definition={selectedDef}
                dispatch={dispatch as (a: EditorAction) => void}
              />
            )}
          </div>
        </section>
      </div>

      {showPackage && (
        <PackageDialog
          inputs={selection.inputs}
          outputs={selection.outputs}
          crossingWireCount={crossingWireCount}
          onCancel={() => setShowPackage(false)}
          onConfirm={confirmPackage}
        />
      )}
      {showDefsManager && (
        <DefinitionsManager
          project={project}
          onClose={() => setShowDefsManager(false)}
          dispatch={dispatch as (a: EditorAction) => void}
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
