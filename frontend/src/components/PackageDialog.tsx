/**
 * "封装为自定义器件"对话框：
 * 展示当前圈选到的输入开关/输出灯（它们会成为对外管脚），
 * 让用户命名器件、调整管脚名，确认后生成 DeviceDefinition。
 */

import { useMemo, useState } from 'react';
import type { Circuit, CircuitComponent, DeviceDefinition } from '../lib/types';
import { packageSelection, selectedIO, validatePackageInput } from '../lib/packaging';

export function PackageDialog({
  circuit,
  selectedComponentIds,
  existingNames,
  onConfirm,
  onCancel
}: {
  circuit: Circuit;
  selectedComponentIds: string[];
  existingNames: string[];
  onConfirm: (def: DeviceDefinition) => void;
  onCancel: () => void;
}) {
  const io = useMemo(
    () => selectedIO(circuit, selectedComponentIds),
    [circuit, selectedComponentIds]
  );
  const [name, setName] = useState('');
  const [inputNames, setInputNames] = useState<Record<string, string>>({});
  const [outputNames, setOutputNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const selectedCount = selectedComponentIds.length;

  const confirm = () => {
    const selected: CircuitComponent[] = circuit.components.filter((c) =>
      selectedComponentIds.includes(c.id)
    );
    const problem = validatePackageInput(name, selected, existingNames);
    if (problem) {
      setError(problem);
      return;
    }
    const { definition } = packageSelection({
      circuit,
      selectedComponentIds,
      name,
      inputPinNames: inputNames,
      outputPinNames: outputNames
    });
    onConfirm(definition);
  };

  return (
    <div className="modal-backdrop" onPointerDown={onCancel}>
      <div className="modal package-dialog" onPointerDown={(e) => e.stopPropagation()}>
        <h3>封装为自定义器件</h3>
        <p className="muted">
          已圈选 <b>{selectedCount}</b> 个元件（{io.gates.length} 个门、
          {io.instances.length} 个器件实例、{io.inputs.length} 个输入开关、
          {io.outputs.length} 个输出灯）。选区内输入开关和输出灯将成为新器件的对外管脚。
        </p>

        <label className="prop-row">
          <span>器件名称</span>
          <input
            autoFocus
            value={name}
            placeholder="如：半加器、二位选择器"
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && confirm()}
          />
        </label>

        {io.inputs.length > 0 && (
          <div className="pin-editor">
            <div className="pin-editor-title">输入管脚（{io.inputs.length}）</div>
            {io.inputs.map((c, i) => (
              <label key={c.id} className="pin-row">
                <span className="pin-index">{i + 1}</span>
                <span className="pin-source">{c.label || `开关 ${c.id.slice(-4)}`}</span>
                <input
                  value={inputNames[c.id] ?? c.label ?? `I${i + 1}`}
                  onChange={(e) => setInputNames((m) => ({ ...m, [c.id]: e.target.value }))}
                />
              </label>
            ))}
          </div>
        )}

        <div className="pin-editor">
          <div className="pin-editor-title">输出管脚（{io.outputs.length}）</div>
          {io.outputs.map((c, i) => (
            <label key={c.id} className="pin-row">
              <span className="pin-index">{i + 1}</span>
              <span className="pin-source">{c.label || `输出灯 ${c.id.slice(-4)}`}</span>
              <input
                value={outputNames[c.id] ?? c.label ?? `O${i + 1}`}
                onChange={(e) => setOutputNames((m) => ({ ...m, [c.id]: e.target.value }))}
              />
            </label>
          ))}
        </div>

        {error && <div className="error">{error}</div>}

        <div className="modal-actions">
          <button className="ghost-btn" onClick={onCancel}>取消</button>
          <button className="primary-btn" onClick={confirm}>生成器件</button>
        </div>
      </div>
    </div>
  );
}
