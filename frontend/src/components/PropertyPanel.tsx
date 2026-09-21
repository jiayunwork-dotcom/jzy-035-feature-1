/** 选中元件的属性编辑：改名、多输入门的输入端口数。 */

import { useEffect, useState } from 'react';
import type { CircuitComponent } from '../lib/types';
import type { EditorAction } from '../lib/editor';

const MULTI_INPUT_GATES = new Set(['AND', 'OR', 'NAND', 'NOR', 'XOR', 'XNOR']);

export function PropertyPanel({
  component,
  dispatch
}: {
  component: CircuitComponent | null;
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
          未选中元件。点击元件可选中（再按 Delete 删除）；点击输入开关可在 0/1 间切换。
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
      <h3>属性 · {component.type}</h3>
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
        删除选中{component.type === 'INPUT' || component.type === 'OUTPUT' ? '元件' : '门'}
      </button>
    </div>
  );
}

function defaultPlaceholder(c: CircuitComponent): string {
  if (c.type === 'INPUT') return '如 A';
  if (c.type === 'OUTPUT') return '如 F';
  return c.type;
}
