/** 各类逻辑门、输入开关、输出灯的 SVG 图形。
 *  宽度固定 90；多输入门高度由 Canvas 按输入数传入，右侧用半椭圆收束。 */

import { memo } from 'react';
import type { ComponentType } from '../lib/types';

interface SymbolProps {
  type: ComponentType;
  active?: boolean; // 当前输出值为 1
  selected?: boolean;
  dimmed?: boolean; // 处于错误环上时高亮
  height?: number;
}

const STROKE = '#c9d4e3';
const STROKE_ACTIVE = '#4da3ff';
const FILL = '#1c2735';

/** 各门主体路径（不含端口圆点，端口在 Canvas 中统一绘制） */
function gatePath(type: ComponentType, h: number): string {
  const mid = h / 2;
  const top = 6;
  const bottom = h - 6;
  switch (type) {
    case 'AND':
      return `M 2 ${top} H 48 Q 72 ${top} 72 ${mid} Q 72 ${bottom} 48 ${bottom} H 2 Z`;
    case 'OR':
      return `M 2 ${top} Q 34 ${top} 60 ${mid} Q 34 ${bottom} 2 ${bottom} Q 22 ${mid} 2 ${top} Z`;
    case 'NOT':
      return `M 2 8 L 56 ${mid} L 2 ${h - 8} Z M 56 ${mid} m -6 0 a 6 6 0 1 0 12 0 a 6 6 0 1 0 -12 0`;
    case 'NAND':
      return `M 2 ${top} H 44 Q 66 ${top} 66 ${mid} Q 66 ${bottom} 44 ${bottom} H 2 Z M 66 ${mid} m -6 0 a 6 6 0 1 0 12 0 a 6 6 0 1 0 -12 0`;
    case 'NOR':
      return `M 2 ${top} Q 28 ${top} 52 ${mid} Q 28 ${bottom} 2 ${bottom} Q 20 ${mid} 2 ${top} Z M 54 ${mid} m -6 0 a 6 6 0 1 0 12 0 a 6 6 0 1 0 -12 0`;
    case 'XOR':
      return `M 2 ${top} Q 12 ${mid} 2 ${bottom} M 10 ${top} Q 36 ${top} 60 ${mid} Q 36 ${bottom} 10 ${bottom} Q 28 ${mid} 10 ${top} Z`;
    case 'XNOR':
      return `M 2 ${top} Q 12 ${mid} 2 ${bottom} M 10 ${top} Q 34 ${top} 54 ${mid} Q 34 ${bottom} 10 ${bottom} Q 28 ${mid} 10 ${top} Z M 56 ${mid} m -6 0 a 6 6 0 1 0 12 0 a 6 6 0 1 0 -12 0`;
    default:
      return '';
  }
}

function gateLabel(type: ComponentType): string {
  switch (type) {
    case 'AND': return '&';
    case 'OR': return '≥1';
    case 'NOT': return '';
    case 'NAND': return '&';
    case 'NOR': return '≥1';
    case 'XOR': return '=1';
    case 'XNOR': return '=1';
    default: return '';
  }
}

export const GateSymbol = memo(function GateSymbol({
  type,
  active,
  selected,
  dimmed,
  height
}: SymbolProps) {
  const h = height ?? 56;
  const stroke = dimmed ? '#ff6b6b' : selected ? '#ffd166' : active ? STROKE_ACTIVE : STROKE;
  return (
    <g>
      <path
        d={gatePath(type, h)}
        fill={FILL}
        stroke={stroke}
        strokeWidth={selected || dimmed ? 2.4 : 1.6}
        strokeLinejoin="round"
      />
      {gateLabel(type) && (
        <text
          x={type === 'NOT' ? 30 : 36}
          y={h / 2 + 5}
          textAnchor="middle"
          fontSize={15}
          fill={stroke}
          fontFamily="'Times New Roman', serif"
          fontStyle="italic"
        >
          {gateLabel(type)}
        </text>
      )}
    </g>
  );
});

export const InputSwitchSymbol = memo(function InputSwitchSymbol({
  value,
  selected
}: {
  value: 0 | 1;
  selected?: boolean;
}) {
  const on = value === 1;
  return (
    <g>
      <rect
        x={0}
        y={8}
        width={52}
        height={40}
        rx={8}
        fill={on ? '#114a2b' : '#2a2f3a'}
        stroke={selected ? '#ffd166' : on ? '#3ddc84' : STROKE}
        strokeWidth={selected ? 2.4 : 1.6}
      />
      <circle cx={on ? 38 : 14} cy={28} r={9} fill={on ? '#3ddc84' : '#7b8698'} />
      <text x={26} y={60} textAnchor="middle" fontSize={11} fill="#9fb0c3">
        {on ? '1' : '0'}
      </text>
    </g>
  );
});

export const OutputLampSymbol = memo(function OutputLampSymbol({
  signal,
  selected
}: {
  signal: 0 | 1 | null;
  selected?: boolean;
}) {
  const on = signal === 1;
  return (
    <g>
      <circle
        cx={26}
        cy={26}
        r={20}
        fill={on ? '#3ddc84' : signal === null ? '#333a45' : '#2c333d'}
        stroke={selected ? '#ffd166' : on ? '#7CFFB2' : STROKE}
        strokeWidth={selected ? 2.4 : 1.6}
        style={on ? { filter: 'drop-shadow(0 0 6px #3ddc84)' } : undefined}
      />
      <text
        x={26}
        y={31}
        textAnchor="middle"
        fontSize={14}
        fill={on ? '#06281a' : '#9fb0c3'}
        fontWeight="bold"
      >
        {signal === null ? '?' : signal}
      </text>
    </g>
  );
});

/**
 * 自定义器件实例方块：内部细节收起，只显示器件名与管脚。
 * 管脚圆点仍由 Canvas 统一绘制，这里只画方块、标题与管脚名。
 */
export const CustomDeviceSymbol = memo(function CustomDeviceSymbol({
  name,
  inputNames,
  outputNames,
  active,
  selected
}: {
  name: string;
  inputNames: string[];
  outputNames: string[];
  /** 第 0 个输出管脚是否为 1（整体高亮） */
  active?: boolean;
  selected?: boolean;
}) {
  const width = 110;
  const pinGap = 22;
  const padTop = 34;
  const minHeight = 70;
  const height = Math.max(minHeight, padTop + Math.max(inputNames.length, outputNames.length) * pinGap + 12);
  const stroke = selected ? '#ffd166' : active ? STROKE_ACTIVE : STROKE;
  return (
    <g>
      <rect
        x={1}
        y={1}
        width={width - 2}
        height={height - 2}
        rx={8}
        fill="#202c3d"
        stroke={stroke}
        strokeWidth={selected ? 2.4 : 1.8}
      />
      <line x1={1} y1={padTop - 8} x2={width - 1} y2={padTop - 8} stroke="#33415a" strokeWidth={1} />
      <text
        x={width / 2}
        y={18}
        textAnchor="middle"
        fontSize={12}
        fontWeight="bold"
        fill={active ? '#7cc0ff' : '#dbe6f5'}
        style={{ userSelect: 'none' }}
      >
        {name.length > 10 ? name.slice(0, 9) + '…' : name}
      </text>
      {inputNames.map((n, i) => {
        const y = inputNames.length <= 1 ? height / 2 : padTop + i * pinGap + pinGap / 2;
        return (
          <text
            key={`in-${i}`}
            x={8}
            y={y + 4}
            fontSize={11}
            fill="#9fb0c3"
            style={{ userSelect: 'none' }}
          >
            {n}
          </text>
        );
      })}
      {outputNames.map((n, i) => {
        const y = outputNames.length <= 1 ? height / 2 : padTop + i * pinGap + pinGap / 2;
        return (
          <text
            key={`out-${i}`}
            x={width - 8}
            y={y + 4}
            textAnchor="end"
            fontSize={11}
            fill="#9fb0c3"
            style={{ userSelect: 'none' }}
          >
            {n}
          </text>
        );
      })}
    </g>
  );
});
