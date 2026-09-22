/** 选中元件的属性编辑：改名、多输入门的输入端口数；多选时支持批量删除。 */

import { useEffect, useState } from 'react';
import type { CircuitComponent, DeviceDefinition } from '../lib/types';
import type { EditorAction } from '../lib/editor';

const MULTI_INPUT_GATES = new Set(['AND', 'OR', 'NAND', 'NOR', 'XOR', 'XNOR']);

export function PropertyPanel({
  component,
  selectedIds,
  definitions,
  dispatch
}: {
  component: CircuitComponent | null;
  selectedIds: string[];
  definitions: DeviceDefinition[];
  dispatch: (a: EditorAction) => void;
}) {
  const [label, setLabel] = useState('');

  useEffect(() => {
    setLabel(component?.label ?? '');
  }, [component?.id, component?.label]);

  if (selectedIds.length > 1) {
    return (
      <div className="panel property-panel">
        <h3>属性 · 多选</h3>
        <p className="muted">已选中 {selectedIds.length} 个元件。</p>
        <button
          className="danger-btn"
          onClick={() => dispatch({ type: 'delete-components', ids: selectedIds })}
        >
          删除全部选中
        </button>
      </div>
    );
  }

  if (!component) {
    return (
      <div className="panel property-panel">
        <h3>属性</h3>
        <p className="muted">
          未选中元件。点击元件可选中（再按 Delete 删除）；按住 <b>Shift</b> 拖框可圈选多个元件；
          点击输入开关可在 0/1 间切换。
        </p>
      </div>
    );
  }

  const multi = MULTI_INPUT_GATES.has(component.type);
  const subDef = component.type === 'SUB'
    ? definitions.find((d) => d.id === component.deviceId)
    : undefined;

  const commitLabel = () => {
    const next = label.trim();
    if (next !== (component.label ?? '')) {
      dispatch({ type: 'set-label', id: component.id, label: next });
    }
  };

  return (
    <div className="panel property-panel">
      <h3>
        属性 · {component.type === 'SUB' ? subDef?.name ?? '自定义器件' : component.type}
      </h3>

      {component.type === 'SUB' && subDef && (
        <div className="sub-meta">
          <div className="muted">
            自定义器件实例，内部结构已收起。双击方块或点左侧库中的「钻入」可查看/修改其内部电路；
            修改定义后，画布上所有该器件的实例都会同步更新。
          </div>
          <div className="prop-row">
            <span>输入管脚</span>
            <strong>{subDef.inputPins.length}</strong>
          </div>
          <div className="prop-row">
            <span>输出管脚</span>
            <strong>{subDef.outputPins.length}</strong>
          </div>
          <button className="ghost-btn" onClick={() => dispatch({ type: 'open-definition', definitionId: subDef.id })}>
            钻入内部
          </button>
        </div>
      )}

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
        onClick={() => dispatch({ type: 'delete-components', ids: [component.id] })}
      >
        删除选中{component.type === 'INPUT' || component.type === 'OUTPUT' ? '元件' : component.type === 'SUB' ? '实例' : '门'}
      </button>
    </div>
  );
}

function defaultPlaceholder(c: CircuitComponent): string {
  if (c.type === 'INPUT') return '如 A';
  if (c.type === 'OUTPUT') return '如 F';
  return c.type;
}
