/**
 * 卡诺图面板：选择 2~4 个输入开关和 1 个输出灯，
 * 调后端 /api/karnaugh，画 Gray 码网格并把每个质蕴含项分组用彩色圆角矩形圈出，
 * 支持环绕边界（runs 中越界的列号直接按连续坐标画，矩形跨到网格外侧）。
 */

import { useState } from 'react';
import { fetchKarnaugh } from '../lib/api';
import type {
  CircuitComponent,
  GenericErr,
  KMapGroup,
  KMapOk
} from '../lib/types';

const CELL = 58;
const PAD_X = 92; // 左侧留给行标签
const PAD_Y = 46; // 顶部留给列标签

const GROUP_COLORS = [
  '#ff6b6b',
  '#4da3ff',
  '#f7b500',
  '#b388ff',
  '#26c6da',
  '#ff8a65',
  '#9ccc65'
];

export function KarnaughPanel({
  components,
  wires
}: {
  components: CircuitComponent[];
  wires: import('../lib/types').Wire[];
}) {
  const inputs = components.filter((c) => c.type === 'INPUT');
  const outputs = components.filter((c) => c.type === 'OUTPUT');

  const [chosenInputs, setChosenInputs] = useState<string[]>([]);
  const [chosenOutput, setChosenOutput] = useState<string | null>(null);
  const [kmap, setKmap] = useState<KMapOk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggleInput = (id: string) => {
    setKmap(null);
    setError(null);
    setChosenInputs((list) =>
      list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
    );
  };

  const run = async () => {
    if (chosenInputs.length < 2 || chosenInputs.length > 4) {
      setError('卡诺图需要选择 2~4 个输入开关。');
      return;
    }
    if (!chosenOutput) {
      setError('请选择 1 个输出指示灯。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const inputIds = chosenInputs
        .map((id) => components.find((c) => c.id === id)!)
        .sort((a, b) => a.x - b.x || a.y - b.y)
        .map((c) => c.id);
      const result = await fetchKarnaugh(
        { components, wires },
        inputIds,
        chosenOutput
      );
      if (!result.ok) {
        const e = result as GenericErr;
        setError(e.message);
        setKmap(null);
      } else {
        setKmap(result);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <h3>卡诺图化简</h3>

      <div className="selector">
        <div className="selector-title">输入（选 2~4 个，当前 {chosenInputs.length} 个）</div>
        <div className="chips">
          {inputs.map((c) => (
            <button
              key={c.id}
              className={`chip ${chosenInputs.includes(c.id) ? 'active' : ''}`}
              onClick={() => toggleInput(c.id)}
            >
              {c.label || c.id.slice(-4)}
            </button>
          ))}
          {inputs.length === 0 && <span className="muted">画布上还没有输入开关</span>}
        </div>
      </div>

      <div className="selector">
        <div className="selector-title">输出（选 1 个）</div>
        <div className="chips">
          {outputs.map((c) => (
            <button
              key={c.id}
              className={`chip ${chosenOutput === c.id ? 'active' : ''}`}
              onClick={() => {
                setChosenOutput(c.id);
                setKmap(null);
              }}
            >
              {c.label || c.id.slice(-4)}
            </button>
          ))}
          {outputs.length === 0 && <span className="muted">画布上还没有输出指示灯</span>}
        </div>
      </div>

      <button className="primary-btn" disabled={busy} onClick={run}>
        {busy ? '计算中…' : '生成卡诺图'}
      </button>

      {error && <div className="error">{error}</div>}

      {kmap && <KMapView kmap={kmap} />}
    </div>
  );
}

function KMapView({ kmap }: { kmap: KMapOk }) {
  const rows = kmap.rowLabels.length;
  const cols = kmap.colLabels.length;
  const width = PAD_X + cols * CELL + 10;
  const height = PAD_Y + rows * CELL + 10;

  const valueAt = new Map(kmap.cells.map((c) => [`${c.row}:${c.col}`, c.value]));

  return (
    <div className="kmap-block">
      <p className="kmap-hint">
        行变量 {kmap.variables.slice(0, kmap.rowBits).join('、')}，列变量{' '}
        {kmap.variables.slice(kmap.rowBits).join('、')}；相邻格只差一个变量，网格在
        上下、左右方向上都是环绕的。
      </p>

      <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="kmap-svg">
        {/* 列标签 */}
        {kmap.colLabels.map((label, col) => (
          <text
            key={`cl-${col}`}
            x={PAD_X + col * CELL + CELL / 2}
            y={PAD_Y - 18}
            textAnchor="middle"
            fontSize={11}
            fill="#9fb0c3"
          >
            {label}
          </text>
        ))}
        {/* 行标签 */}
        {kmap.rowLabels.map((label, row) => (
          <text
            key={`rl-${row}`}
            x={PAD_X - 8}
            y={PAD_Y + row * CELL + CELL / 2 + 4}
            textAnchor="end"
            fontSize={11}
            fill="#9fb0c3"
          >
            {label}
          </text>
        ))}

        {/* 格子 */}
        {Array.from({ length: rows }, (_, row) =>
          Array.from({ length: cols }, (_, col) => {
            const v = valueAt.get(`${row}:${col}`) ?? 0;
            return (
              <g key={`${row}-${col}`}>
                <rect
                  x={PAD_X + col * CELL}
                  y={PAD_Y + row * CELL}
                  width={CELL}
                  height={CELL}
                  fill={v === 1 ? 'rgba(61,220,132,0.10)' : 'transparent'}
                  stroke="#3a4757"
                  strokeWidth={1}
                />
                <text
                  x={PAD_X + col * CELL + CELL / 2}
                  y={PAD_Y + row * CELL + CELL / 2 + 5}
                  textAnchor="middle"
                  fontSize={17}
                  fill={v === 1 ? '#3ddc84' : '#5c6b7d'}
                  fontWeight={v === 1 ? 'bold' : 'normal'}
                >
                  {v}
                </text>
                <text
                  x={PAD_X + col * CELL + 5}
                  y={PAD_Y + row * CELL + 13}
                  fontSize={8.5}
                  fill="#465666"
                >
                  {kmap.cells.find((c) => c.row === row && c.col === col)?.minterm}
                </text>
              </g>
            );
          })
        )}

        {/* 分组圈 */}
        {kmap.groups.map((group, gi) => (
          <GroupRect key={`${group.term}-${gi}`} group={group} colorIndex={gi} />
        ))}
      </svg>

      <div className="kmap-legend">
        {kmap.groups.map((g, gi) => (
          <span key={g.term} className="legend-item">
            <i style={{ background: GROUP_COLORS[gi % GROUP_COLORS.length] }} />
            {g.term}
          </span>
        ))}
      </div>

      <div className="kmap-result">
        最简表达式：<code>{kmap.outputName} = {kmap.minimalExpression}</code>
      </div>
    </div>
  );
}

/** 一个分组：对每行的连续列段画圆角矩形；越界列号会让矩形跨出网格边界（环绕组） */
function GroupRect({ group, colorIndex }: { group: KMapGroup; colorIndex: number }) {
  const color = GROUP_COLORS[colorIndex % GROUP_COLORS.length];
  const inset = 7 + (colorIndex % 3) * 2;
  return (
    <g fill="none" stroke={color} strokeWidth={2.4} strokeLinejoin="round">
      {group.runs.map((run, ri) => {
        // run.cols 已按连续顺序展开，可能含 size..2*size-1 表示环绕到对侧
        const minCol = Math.min(...run.cols);
        const maxCol = Math.max(...run.cols);
        const top = PAD_Y + run.row * CELL + inset;
        const left = PAD_X + minCol * CELL + inset;
        const w = (maxCol - minCol + 1) * CELL - inset * 2;
        const h = CELL - inset * 2;
        return <rect key={ri} x={left} y={top} width={w} height={h} rx={10} opacity={0.9} />;
      })}
    </g>
  );
}
