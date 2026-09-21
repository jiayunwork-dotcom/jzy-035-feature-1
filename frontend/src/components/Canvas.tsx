/**
 * 网格画布：
 *  - 滚轮缩放（以光标为中心）、空白处拖拽平移；
 *  - 工具栏 HTML5 拖入放置新元件；
 *  - 点元件拖动（网格吸附）移动、点开关直接翻转；
 *  - 从输出口按下拖到合法输入口松手才连线，非法连线松手即取消；
 *  - 点击选中元件/线，Delete/Backspace 删除；
 *  - 连线为曼哈顿折线，按信号着色（1 绿、0 灰蓝、未知虚灰）。
 */

import { useCallback, useRef, useState } from 'react';
import type {
  CircuitComponent,
  ComponentType,
  EvalResult,
  Signal,
  Wire
} from '../lib/types';
import type { EditorAction } from '../lib/editor';
import {
  COMP_HEIGHT,
  COMP_WIDTH,
  componentAt,
  componentHeight,
  hitTestInputPort,
  hitTestOutputPort,
  inputPortCount,
  outputPortCount,
  portPosition,
  routeWire,
  snap
} from '../lib/geometry';
import { uid } from '../lib/utils';
import {
  GateSymbol,
  InputSwitchSymbol,
  OutputLampSymbol
} from './GateSymbols';

interface CanvasProps {
  components: CircuitComponent[];
  wires: Wire[];
  evalResult: EvalResult | null;
  selectedComponentId: string | null;
  selectedWireId: string | null;
  dispatch: (a: EditorAction) => void;
}

interface View {
  scale: number;
  tx: number;
  ty: number;
}

interface Wiring {
  fromId: string;
  fromPos: { x: number; y: number };
  cursor: { x: number; y: number };
  hoverPort: { componentId: string; port: number } | null;
}

interface Dragging {
  id: string;
  pointerStart: { x: number; y: number };
  compStart: { x: number; y: number };
  moved: boolean;
}

const MIN_SCALE = 0.4;
const MAX_SCALE = 2.2;

function wireStyle(signal: Signal): { stroke: string; dash?: string } {
  if (signal === 1) return { stroke: '#3ddc84' };
  if (signal === 0) return { stroke: '#5b7186' };
  return { stroke: '#8a93a3', dash: '6 5' };
}

export function Canvas(props: CanvasProps) {
  const { components, wires, evalResult, selectedComponentId, selectedWireId, dispatch } = props;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [view, setView] = useState<View>({ scale: 1, tx: 40, ty: 40 });
  const [wiring, setWiring] = useState<Wiring | null>(null);
  const draggingRef = useRef<Dragging | null>(null);
  const panningRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const [, forceTick] = useState(0);

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current!.getBoundingClientRect();
      return {
        x: (clientX - rect.left - view.tx) / view.scale,
        y: (clientY - rect.top - view.ty) / view.scale
      };
    },
    [view]
  );

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = svgRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setView((v) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
      // 以光标为缩放中心
      const wx = (mx - v.tx) / v.scale;
      const wy = (my - v.ty) / v.scale;
      return { scale, tx: mx - wx * scale, ty: my - wy * scale };
    });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const world = toWorld(e.clientX, e.clientY);

    // 1. 是否点在输出端口上 -> 开始拉线
    const outPort = hitTestOutputPort(components, world);
    if (outPort) {
      const c = components.find((x) => x.id === outPort.componentId)!;
      setWiring({
        fromId: c.id,
        fromPos: portPosition(c, 'out'),
        cursor: world,
        hoverPort: null
      });
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    // 2. 是否点在元件体上
    const hit = componentAt(components, world);
    if (hit) {
      dispatch({ type: 'select', componentId: hit.id, wireId: null });
      // 输入开关：点击即翻转（按下时不翻转，交给 click，避免拖动误触）
      draggingRef.current = {
        id: hit.id,
        pointerStart: { x: e.clientX, y: e.clientY },
        compStart: { x: hit.x, y: hit.y },
        moved: false
      };
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      return;
    }

    // 3. 点空白：开始平移并清空选择（不立即清，拖动才算平移；单击空白也清）
    dispatch({ type: 'select', componentId: null, wireId: null });
    panningRef.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const world = toWorld(e.clientX, e.clientY);

    if (wiring) {
      const hover = hitTestInputPort(components, world);
      const legal =
        hover &&
        hover.componentId !== wiring.fromId &&
        !wires.some(
          (w) => w.to.componentId === hover.componentId && w.to.port === hover.port
        );
      setWiring({ ...wiring, cursor: world, hoverPort: legal ? hover : null });
      return;
    }

    const d = draggingRef.current;
    if (d) {
      const dx = (e.clientX - d.pointerStart.x) / view.scale;
      const dy = (e.clientY - d.pointerStart.y) / view.scale;
      if (Math.abs(e.clientX - d.pointerStart.x) + Math.abs(e.clientY - d.pointerStart.y) > 3) {
        d.moved = true;
      }
      dispatch({
        type: 'move-component',
        id: d.id,
        x: snap(d.compStart.x + dx),
        y: snap(d.compStart.y + dy),
        commit: false
      });
      forceTick((n) => n + 1);
      return;
    }

    const p = panningRef.current;
    if (p) {
      setView((v) => ({ ...v, tx: p.tx + (e.clientX - p.x), ty: p.ty + (e.clientY - p.y) }));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (wiring) {
      if (wiring.hoverPort) {
        const wire: Wire = {
          id: uid('w'),
          from: { componentId: wiring.fromId, port: 0 },
          to: { componentId: wiring.hoverPort.componentId, port: wiring.hoverPort.port }
        };
        dispatch({ type: 'add-wire', wire });
      }
      // 落歪：直接取消，无任何变化
      setWiring(null);
      return;
    }

    const d = draggingRef.current;
    if (d) {
      if (d.moved) {
        dispatch({
          type: 'move-component',
          id: d.id,
          x: snap(d.compStart.x + (e.clientX - d.pointerStart.x) / view.scale),
          y: snap(d.compStart.y + (e.clientY - d.pointerStart.y) / view.scale),
          commit: true,
          startX: d.compStart.x,
          startY: d.compStart.y
        });
      } else {
        // 没有发生移动：若是输入开关则翻转 0/1
        const c = components.find((x) => x.id === d.id);
        if (c?.type === 'INPUT') {
          dispatch({ type: 'set-switch', id: c.id, value: c.value === 1 ? 0 : 1 });
        }
      }
      draggingRef.current = null;
    }
    panningRef.current = null;
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('application/x-gate-type') as ComponentType;
    if (!type) return;
    const world = toWorld(e.clientX, e.clientY);
    const comp: CircuitComponent = {
      id: uid('c'),
      type,
      x: snap(world.x - COMP_WIDTH / 2),
      y: snap(world.y - COMP_HEIGHT / 2),
      value: type === 'INPUT' ? 0 : undefined,
      inputCount:
        type !== 'INPUT' && type !== 'OUTPUT' && type !== 'NOT' ? 2 : undefined
    };
    dispatch({ type: 'add-component', component: comp });
  };

  const signalOf = (w: Wire): Signal => {
    const r: EvalResult | null = evalResult;
    return r?.ok ? r.wireValues[w.id] ?? null : null;
  };

  const cycleSet = new Set(
    evalResult && !evalResult.ok && evalResult.error.kind === 'cycle'
      ? evalResult.error.path ?? []
      : []
  );

  const selectedComp = components.find((c) => c.id === selectedComponentId) ?? null;

  return (
    <svg
      ref={svgRef}
      className="canvas"
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <defs>
        <pattern id="grid-small" width={GRID_PX} height={GRID_PX} patternUnits="userSpaceOnUse">
          <path d={`M ${GRID_PX} 0 L 0 0 0 ${GRID_PX}`} fill="none" stroke="#141c28" strokeWidth="0.6" />
        </pattern>
      </defs>

      <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
        <rect x={-4000} y={-4000} width={8000} height={8000} fill="url(#grid-small)" />

        {/* 连线层 */}
        <g fill="none">
          {wires.map((w) => {
            const from = components.find((c) => c.id === w.from.componentId);
            const to = components.find((c) => c.id === w.to.componentId);
            if (!from || !to) return null;
            const p1 = portPosition(from, 'out', w.from.port);
            const p2 = portPosition(to, 'in', w.to.port);
            const s = signalOf(w);
            const st = wireStyle(s);
            const isSel = w.id === selectedWireId;
            return (
              <g key={w.id}>
                {/* 宽一点的透明线，方便点选 */}
                <path
                  d={routeWire(p1, p2)}
                  stroke="transparent"
                  strokeWidth={12}
                  style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    dispatch({ type: 'select', componentId: null, wireId: w.id });
                  }}
                />
                <path
                  d={routeWire(p1, p2)}
                  stroke={st.stroke}
                  strokeWidth={isSel ? 3.4 : 2.2}
                  strokeDasharray={st.dash}
                  style={{
                    transition: 'stroke 0.12s linear',
                    filter: s === 1 ? 'drop-shadow(0 0 3px rgba(61,220,132,.7))' : undefined
                  }}
                />
              </g>
            );
          })}

          {/* 正在拉的临时线 */}
          {wiring && (
            <path
              d={routeWire(wiring.fromPos, wiring.cursor)}
              stroke={wiring.hoverPort ? '#3ddc84' : '#8a93a3'}
              strokeWidth={2}
              strokeDasharray="6 5"
            />
          )}
        </g>

        {/* 输入端口圆点 */}
        {components.map((c) =>
          Array.from({ length: inputPortCount(c) }, (_, port) => {
            const pos = portPosition(c, 'in', port);
            const driven = wires.some(
              (w) => w.to.componentId === c.id && w.to.port === port
            );
            const isHover =
              wiring?.hoverPort?.componentId === c.id && wiring.hoverPort.port === port;
            return (
              <circle
                key={`in-${c.id}-${port}`}
                cx={pos.x}
                cy={pos.y}
                r={isHover ? 7 : 4.5}
                fill={isHover ? '#3ddc84' : driven ? '#26303d' : '#0f1620'}
                stroke={isHover ? '#b6ffd8' : driven ? '#5b7186' : '#c9d4e3'}
                strokeWidth={1.4}
              />
            );
          })
        )}

        {/* 元件层 */}
        {components.map((c) => {
          const selected = c.id === selectedComponentId;
          const inCycle = cycleSet.has(c.id);
          return (
            <g
              key={c.id}
              transform={`translate(${c.x} ${c.y})`}
              style={{ cursor: c.type === 'INPUT' ? 'pointer' : 'move' }}
            >
              <ComponentBody
                c={c}
                selected={selected}
                dimmed={inCycle}
                signal={evalResult?.ok ? evalResult.outputs[c.id] ?? null : null}
              />
              {/* 可编辑标签 */}
              {c.type !== 'INPUT' && c.type !== 'OUTPUT' && (
                <text
                  x={COMP_WIDTH / 2}
                  y={-6}
                  textAnchor="middle"
                  fontSize={11}
                  fill="#7d93ab"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {c.label || c.type}
                </text>
              )}
              {(c.type === 'INPUT' || c.type === 'OUTPUT') && (
                <text
                  x={c.type === 'INPUT' ? 26 : 26}
                  y={c.type === 'INPUT' ? COMP_HEIGHT + 14 : -8}
                  textAnchor="middle"
                  fontSize={12}
                  fill="#c9d4e3"
                  fontWeight="bold"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {c.label || (c.type === 'INPUT' ? 'IN' : 'OUT')}
                </text>
              )}
            </g>
          );
        })}

        {/* 输出端口圆点（盖在最上面） */}
        {components.map((c) => {
          if (outputPortCount(c) === 0) return null;
          const pos = portPosition(c, 'out');
          const isWiringSource = wiring?.fromId === c.id;
          return (
            <circle
              key={`out-${c.id}`}
              cx={pos.x}
              cy={pos.y}
              r={isWiringSource ? 6.5 : 5}
              fill="#0f1620"
              stroke={isWiringSource ? '#3ddc84' : '#c9d4e3'}
              strokeWidth={1.6}
              style={{ cursor: 'crosshair' }}
            />
          );
        })}

        {/* 拉线时高亮合法目标端口的提示环 */}
        {wiring?.hoverPort &&
          (() => {
            const c = components.find((x) => x.id === wiring.hoverPort!.componentId)!;
            const pos = portPosition(c, 'in', wiring.hoverPort!.port);
            return <circle cx={pos.x} cy={pos.y} r={11} fill="none" stroke="#3ddc84" strokeWidth={1.5} strokeDasharray="3 3" />;
          })()}

        {selectedComp && selectedWireId === null && null}
      </g>
    </svg>
  );
}

const GRID_PX = 20;

function ComponentBody({
  c,
  selected,
  dimmed,
  signal
}: {
  c: CircuitComponent;
  selected: boolean;
  dimmed: boolean;
  signal: Signal;
}) {
  if (c.type === 'INPUT') {
    return <InputSwitchSymbol value={c.value ?? 0} selected={selected} />;
  }
  if (c.type === 'OUTPUT') {
    return <OutputLampSymbol signal={signal} selected={selected} />;
  }
  return <GateSymbol type={c.type} active={signal === 1} selected={selected} dimmed={dimmed} height={componentHeight(c)} />;
}
