/** 左侧元件工具栏：拖拽或点击均可放置到画布；含内置门与自定义器件库。 */

import type { ComponentType, DeviceDefinition, GateType } from '../lib/types';

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

export const GATE_DND_MIME = 'application/x-gate-type';
export const DEVICE_DND_MIME = 'application/x-device-def';

export function Toolbar({
  onAddGate,
  onAddIO,
  definitions,
  onAddDevice,
  onOpenDevice,
  onDeleteDevice,
  editingDefinition
}: {
  onAddGate: (t: GateType) => void;
  onAddIO: (t: 'INPUT' | 'OUTPUT') => void;
  definitions: DeviceDefinition[];
  onAddDevice: (def: DeviceDefinition) => void;
  onOpenDevice: (id: string) => void;
  onDeleteDevice: (id: string) => void;
  editingDefinition: DeviceDefinition | null;
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

      <div className="toolbar-section-title">
        自定义器件
        <span className="toolbar-count">{definitions.length}</span>
      </div>
      {definitions.length === 0 ? (
        <p className="toolbar-hint">
          还没有自定义器件。在画布上<b>按住 Shift 拖框</b>圈选一坨搭好的电路，
          用顶部「封装为器件」命名管脚即可。
        </p>
      ) : (
        <div className="toolbar-grid custom-devices">
          {definitions.map((def) => (
            <DeviceToolButton
              key={def.id}
              def={def}
              active={editingDefinition?.id === def.id}
              onAdd={() => onAddDevice(def)}
              onOpen={() => onOpenDevice(def.id)}
              onDelete={() => onDeleteDevice(def.id)}
            />
          ))}
        </div>
      )}

      <p className="toolbar-hint">
        拖到画布放置，或点击后自动放到画布中央。
        <br />
        多输入门选中后可在右侧改输入个数；双击自定义器件方块可钻入内部修改。
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
        e.dataTransfer.setData(GATE_DND_MIME, item.type);
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

function DeviceToolButton({
  def,
  active,
  onAdd,
  onOpen,
  onDelete
}: {
  def: DeviceDefinition;
  active: boolean;
  onAdd: () => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`device-tool ${active ? 'active' : ''}`} title="拖到画布放置；双击名称钻入内部编辑">
      <button
        className="tool-button device-button"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DEVICE_DND_MIME, def.id);
          e.dataTransfer.effectAllowed = 'copy';
        }}
        onClick={onAdd}
      >
        <span className="tool-symbol device-symbol">▣</span>
        <span className="tool-name" onDoubleClick={(e) => { e.stopPropagation(); onOpen(); }}>
          {def.name}
        </span>
        <span className="device-pins">
          {def.inputPins.length}入 / {def.outputPins.length}出
        </span>
      </button>
      <div className="device-actions">
        <button title="钻入内部编辑" onClick={onOpen}>钻入</button>
        <button
          title="删除该器件定义（画布上所有其实例一并移除）"
          className="danger-text"
          onClick={() => {
            if (confirm(`删除器件“${def.name}”？画布上引用它的全部实例都会被移除。`)) onDelete();
          }}
        >
          删除
        </button>
      </div>
    </div>
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
    case 'SUB': return '▣';
  }
}
