/** 左侧元件工具栏：拖拽或点击均可放置到画布。 */

import type { ComponentType, GateType } from '../lib/types';

interface ToolItem {
  type: ComponentType;
  name: string;
  desc: string;
}

const GATES: ToolItem[] = [
  { type: 'AND', name: '与门', desc: 'AND · 全 1 出 1' },
  { type: 'OR', name: '或门', desc: 'OR · 有 1 出 1' },
  { type: 'NOT', name: '非门', desc: 'NOT · 取反' },
  { type: 'NAND', name: '与非门', desc: 'NAND' },
  { type: 'NOR', name: '或非门', desc: 'NOR' },
  { type: 'XOR', name: '异或门', desc: 'XOR · 不同为 1' },
  { type: 'XNOR', name: '同或门', desc: 'XNOR · 相同为 1' }
];

const IOS: ToolItem[] = [
  { type: 'INPUT', name: '输入开关', desc: '点击在 0/1 间切换' },
  { type: 'OUTPUT', name: '输出指示灯', desc: '显示 0/1/未知' }
];

export function Toolbar({
  onAddGate,
  onAddIO
}: {
  onAddGate: (t: GateType) => void;
  onAddIO: (t: 'INPUT' | 'OUTPUT') => void;
}) {
  return (
    <aside className="toolbar">
      <div className="toolbar-section-title">逻辑门</div>
      <div className="toolbar-grid">
        {GATES.map((item) => (
          <ToolButton key={item.type} item={item} onClick={() => onAddGate(item.type as GateType)} />
        ))}
      </div>
      <div className="toolbar-section-title">输入 / 输出</div>
      <div className="toolbar-grid">
        {IOS.map((item) => (
          <ToolButton
            key={item.type}
            item={item}
            onClick={() => onAddIO(item.type as 'INPUT' | 'OUTPUT')}
          />
        ))}
      </div>
      <p className="toolbar-hint">
        拖到画布放置，或点击后自动放到画布中央。
        <br />
        多输入门（与/或/…）选中后可在右侧改输入个数。
      </p>
    </aside>
  );
}

function ToolButton({ item, onClick }: { item: ToolItem; onClick: () => void }) {
  return (
    <button
      className="tool-button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-gate-type', item.type);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={onClick}
      title={item.desc}
    >
      <span className="tool-symbol">{symbolOf(item.type)}</span>
      <span className="tool-name">{item.name}</span>
    </button>
  );
}

function symbolOf(t: ComponentType): string {
  switch (t) {
    case 'AND': return '&';
    case 'OR': return '≥1';
    case 'NOT': return '¬';
    case 'NAND': return '&̄';
    case 'NOR': return '≥̄1';
    case 'XOR': return '⊕';
    case 'XNOR': return '⊙';
    case 'INPUT': return '⇥';
    case 'OUTPUT': return '◉';
  }
}
