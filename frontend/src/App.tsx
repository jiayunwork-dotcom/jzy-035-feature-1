/**
 * 应用外壳：
 *  左工具栏 / 中画布 / 右 Tab（分析、卡诺图、关卡、属性）；
 *  顶部工具条：撤销、重做、保存 JSON、读取 JSON、清空、缩放复位；
 *  电路每次变化都防抖请求后端 /api/evaluate，实时刷新线色与输出灯；
 *  Ctrl/Cmd+Z 撤销、Ctrl/Cmd+Shift+Z / Ctrl+Y 重做、Delete 删除。
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Toolbar } from './components/Toolbar';
import { Canvas } from './components/Canvas';
import { AnalysisPanel } from './components/AnalysisPanel';
import { KarnaughPanel } from './components/KarnaughPanel';
import { LevelsPanel } from './components/LevelsPanel';
import { PropertyPanel } from './components/PropertyPanel';
import {
  editorReducer,
  initialEditorState,
  type EditorAction
} from './lib/editor';
import { evaluateCircuit } from './lib/api';
import type {
  CircuitComponent,
  ComponentType,
  EvalResult,
  GateType,
  Wire
} from './lib/types';
import { downloadJson, readTextFile, uid } from './lib/utils';
import { snap } from './lib/geometry';

type Tab = 'analysis' | 'kmap' | 'levels' | 'props';

const STORAGE_KEY = 'logiclab-circuit-v1';

export default function App() {
  const [state, dispatch] = useReducer(editorReducer, undefined, () => {
    // 启动时尝试从 localStorage 恢复上次的电路（不入历史）
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const circuit = JSON.parse(saved);
        if (Array.isArray(circuit.components) && Array.isArray(circuit.wires)) {
          return { ...initialEditorState, present: circuit };
        }
      }
    } catch {
      /* ignore */
    }
    return initialEditorState;
  });

  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);
  const [tab, setTab] = useState<Tab>('analysis');
  const evalSeq = useRef(0);

  const circuit = state.present;
  const { components, wires } = circuit;

  // 实时求值：电路变化（结构或开关值）后 120ms 防抖请求后端
  useEffect(() => {
    const seq = ++evalSeq.current;
    const handle = setTimeout(() => {
      evaluateCircuit(circuit)
        .then((r) => {
          if (seq === evalSeq.current) setEvalResult(r);
        })
        .catch(() => {
          if (seq === evalSeq.current) setEvalResult(null);
        });
    }, 120);
    return () => clearTimeout(handle);
  }, [circuit]);

  // 自动保存到 localStorage（不阻塞）
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(circuit));
    } catch {
      /* quota 等情况忽略 */
    }
  }, [circuit]);

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
        if (state.selectedComponentId || state.selectedWireId) {
          e.preventDefault();
          dispatch({ type: 'delete-selected' });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.selectedComponentId, state.selectedWireId]);

  const addComponent = useCallback((type: ComponentType) => {
    // 点击工具栏：放到当前可视区域中央偏右一点（取一个不重叠的网格位置）
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

  const save = () => {
    downloadJson(`logiclab-circuit-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`, circuit);
  };

  const load = async () => {
    try {
      const text = await readTextFile();
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed.components) || !Array.isArray(parsed.wires)) {
        alert('文件格式不正确：缺少 components 或 wires 数组');
        return;
      }
      dispatch({ type: 'replace-all', circuit: parsed });
    } catch (e) {
      alert(`读取失败：${(e as Error).message}`);
    }
  };

  const clearAll = () => {
    if (components.length === 0 && wires.length === 0) return;
    if (confirm('确定清空整张电路？此操作可撤销。')) {
      dispatch({ type: 'replace-all', circuit: { components: [], wires: [] } });
    }
  };

  const selectedComponent = useMemo(
    () => components.find((c) => c.id === state.selectedComponentId) ?? null,
    [components, state.selectedComponentId]
  );

  // 选中元件时用户可切到"属性"页查看/编辑
  const cycleError =
    evalResult && !evalResult.ok && evalResult.error.kind === 'cycle'
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
          <small>组合逻辑电路实验台</small>
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
          <button className="ghost-btn" onClick={save}>💾 保存</button>
          <button className="ghost-btn" onClick={load}>📂 读取</button>
          <button className="ghost-btn danger-text" onClick={clearAll}>清空</button>
        </div>
      </header>

      <div className="main">
        <Toolbar
          onAddGate={(t: GateType) => addComponent(t)}
          onAddIO={(t) => addComponent(t)}
        />

        <main className="canvas-wrap">
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
            evalResult={evalResult}
            selectedComponentId={state.selectedComponentId}
            selectedWireId={state.selectedWireId}
            dispatch={dispatch}
          />
          <div className="canvas-legend">
            <span><i className="line one" /> 信号 1</span>
            <span><i className="line zero" /> 信号 0</span>
            <span><i className="line unk" /> 未确定（输入悬空）</span>
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
              <AnalysisPanel components={components} circuit={circuit} />
            )}
            {tab === 'kmap' && (
              <KarnaughPanel components={components} wires={wires as Wire[]} />
            )}
            {tab === 'levels' && <LevelsPanel circuit={circuit} />}
            {tab === 'props' && (
              <PropertyPanel component={selectedComponent} dispatch={dispatch as (a: EditorAction) => void} />
            )}
          </div>
        </section>
      </div>
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
