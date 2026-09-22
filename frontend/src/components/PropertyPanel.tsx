/** 选中元件的属性编辑：改名、多输入门的输入端口数、自定义器件实例信息。 */

import { useEffect, useState } from 'react';
import type { CircuitComponent, DeviceDefinition } from '../lib/types';
import type { EditorAction } from '../lib/editor';

const MULTI_INPUT_GATES = new Set(['AND', 'OR', 'NAND', 'NOR', 'XOR', 'XNOR']);

export function PropertyPanel({
  component,
  definition,
  dispatch
}: {
  component: CircuitComponent | null;
  definition?: DeviceDefinition | null;
  dispatch: (a: EditorAction) => void;
}) {
  const [label, setLabel] = useState('');

  useEffect(() => {
    setLabel(component?.label ?? '');
  }, [component?.id, component?.label]);

  if (!component) {
    return (
      <div className="panel property-panel">
        <h3>属性</h3>
        <p className="muted">
          未选中元件。单击选中、Shift+单击追加、Shift+空白拖拽可框选一坨元件后
          「封装成器件」；双击自定义器件方块可钻入其内部。
        </p>
      </div>
    );
  }

  const multi = MULTI_INPUT_GATES.has(component.type);

  const commitLabel = () => {
    const next = label.trim();
    if (next !== (component.label ?? '')) {
      dispatch({ type: 'set-label', id: component.id, label: next });
    }
  };

  return (
    <div className="panel property-panel">
      <h3>
        属性 · {component.type === 'CUSTOM' && definition ? definition.name : component.type}
      </h3>

      {component.type === 'CUSTOM' && definition && (
        <div className="custom-instance-info">
          <div className="prop-row">
            <span>器件</span>
            <strong>{definition.name}</strong>
          </div>
          <div className="prop-row muted">
            {definition.inputs.length} 个输入管脚 / {definition.outputs.length} 个输出管脚
          </div>
          <p className="muted">
            实例只是引用：双击方块（或点左侧器件库「管理 → 钻入编辑」）修改内部电路后，
            所有同类实例都会一起更新。
          </p>
        </div>
      )}

      {component.type !== 'CUSTOM' && (
        <label className="prop-row">
          <span>名称/变量名</span>
          <input
            value={label}
            placeholder={defaultPlaceholder(component)}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </label>
      )}

      {multi && (
        <label className="prop-row">
          <span>输入端口数</span>
          <select
            value={component.inputCount ?? 2}
            onChange={(e) =>
              dispatch({
                type: 'set-input-count',
                id: component.id,
                inputCount: Number(e.target.value)
              })
            }
          >
            {[2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      )}

      {component.type === 'INPUT' && (
        <div className="prop-row">
          <span>当前值</span>
          <strong className={component.value === 1 ? 'val-one' : 'val-zero'}>
            {component.value ?? 0}
          </strong>
          <span className="muted">（点画布上的开关即可切换）</span>
        </div>
      )}

      <button
        className="danger-btn"
        onClick={() => dispatch({ type: 'delete-selected' })}
      >
        删除选中{component.type === 'INPUT' || component.type === 'OUTPUT' ? '元件' : component.type === 'CUSTOM' ? '实例（定义保留）' : '门'}
      </button>
    </div>
  );
}

function defaultPlaceholder(c: CircuitComponent): string {
  if (c.type === 'INPUT') return '如 A';
  if (c.type === 'OUTPUT') return '如 F';
  return c.type;
}
