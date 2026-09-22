/**
 * "封装成器件"对话框：
 * 列出选区里的输入开关/输出灯（顺序即管脚顺序，可上下调整），
 * 允许为器件和每个管脚命名；确认后派发 package-selection。
 * 跨边界连线会在封装时断开，对话框里明确提示。
 */

import { useMemo, useState } from 'react';
import type { CircuitComponent } from '../lib/types';

export interface PackageConfig {
  name: string;
  inputs: { id: string; pinName: string }[];
  outputs: { id: string; pinName: string }[];
}

export function PackageDialog({
  inputs,
  outputs,
  crossingWireCount,
  onCancel,
  onConfirm
}: {
  inputs: CircuitComponent[];
  outputs: CircuitComponent[];
  /** 一头在选区外、封装后会被断开的连线数 */
  crossingWireCount: number;
  onCancel: () => void;
  onConfirm: (cfg: PackageConfig) => void;
}) {
  const defaultName = useMemo(() => `自定义器件 ${new Date().toLocaleTimeString()}`, []);
  const [name, setName] = useState(defaultName);
  const [inPins, setInPins] = useState(
    inputs.map((c, i) => ({ id: c.id, pinName: c.label?.trim() || String.fromCharCode(65 + i) }))
  );
  const [outPins, setOutPins] = useState(
    outputs.map((c, i) => ({ id: c.id, pinName: c.label?.trim() || `Y${i}` }))
  );
  const [error, setError] = useState<string | null>(null);

  const compLabel = (id: string) =>
    inputs.find((c) => c.id === id)?.label || outputs.find((c) => c.id === id)?.label || id.slice(-4);

  const move = (
    list: { id: string; pinName: string }[],
    setList: (v: { id: string; pinName: string }[]) => void,
    index: number,
    delta: number
  ) => {
    const j = index + delta;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[index], next[j]] = [next[j], next[index]];
    setList(next);
  };

  const confirm = () => {
    if (!name.trim()) {
      setError('请给器件起个名字');
      return;
    }
    const names = [...inPins.map((p) => p.pinName.trim()), ...outPins.map((p) => p.pinName.trim())];
    if (names.some((n) => !n)) {
      setError('每个管脚都要有名字');
      return;
    }
    if (new Set(names).size !== names.length) {
      setError('管脚名字不能重复');
      return;
    }
    onConfirm({ name: name.trim(), inputs: inPins, outputs: outPins });
  };

  return (
    <div className="modal-backdrop" onPointerDown={onCancel}>
      <div className="modal package-dialog" onPointerDown={(e) => e.stopPropagation()}>
        <h3>封装成自定义器件</h3>
        <p className="muted">
          选中的 {inputs.length + outputs.length}+ 个元件及其内部连线将收进一个黑盒器件，
          之后可从左侧器件库反复拖放；双击实例可钻入修改，所有实例共享同一份定义。
        </p>

        <label className="prop-row">
          <span>器件名称</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="如：半加器、四位加法器" />
        </label>

        <div className="pin-columns">
          <PinColumn
            title={`输入管脚（${inPins.length}）`}
            pins={inPins}
            compLabel={compLabel}
            onChange={(index, pinName) =>
              setInPins(inPins.map((p, i) => (i === index ? { ...p, pinName } : p)))
            }
            onMove={(i, d) => move(inPins, setInPins, i, d)}
          />
          <PinColumn
            title={`输出管脚（${outPins.length}）`}
            pins={outPins}
            compLabel={compLabel}
            onChange={(index, pinName) =>
              setOutPins(outPins.map((p, i) => (i === index ? { ...p, pinName } : p)))
            }
            onMove={(i, d) => move(outPins, setOutPins, i, d)}
          />
        </div>

        {crossingWireCount > 0 && (
          <div className="warning">
            有 {crossingWireCount} 根连线一端连在选区之外，封装后无法自动保留，将被断开
            （对外信号请通过上面的管脚在封装后重新接线）。
          </div>
        )}

        {error && <div className="error">{error}</div>}

        <div className="modal-actions">
          <button className="ghost-btn" onClick={onCancel}>取消</button>
          <button className="primary-btn" onClick={confirm}>封装</button>
        </div>
      </div>
    </div>
  );
}

function PinColumn({
  title,
  pins,
  compLabel,
  onChange,
  onMove
}: {
  title: string;
  pins: { id: string; pinName: string }[];
  compLabel: (id: string) => string;
  onChange: (index: number, pinName: string) => void;
  onMove: (index: number, delta: number) => void;
}) {
  return (
    <div className="pin-column">
      <div className="selector-title">{title}</div>
      {pins.map((p, i) => (
        <div key={p.id} className="pin-row">
          <span className="pin-source" title="内部元件">{compLabel(p.id)}</span>
          <span className="pin-arrow">→</span>
          <input
            value={p.pinName}
            onChange={(e) => onChange(i, e.target.value)}
            placeholder={`管脚 ${i + 1}`}
          />
          <span className="pin-order">
            <button type="button" className="mini-btn" onClick={() => onMove(i, -1)} disabled={i === 0}>↑</button>
            <button type="button" className="mini-btn" onClick={() => onMove(i, 1)} disabled={i === pins.length - 1}>↓</button>
          </span>
        </div>
      ))}
    </div>
  );
}
