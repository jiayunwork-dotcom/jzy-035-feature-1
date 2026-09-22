/**
 * 网格画布：
 *  - 滚轮缩放（以光标为中心）、空白处拖拽平移；
 *  - 工具栏 HTML5 拖入放置新元件（内置门或自定义器件实例）；
 *  - 点元件拖动（网格吸附）移动、点开关直接翻转；
 *  - 从输出口（实例可有多输出口）按下拖到合法输入口松手才连线；
 *  - Shift + 空白拖框可圈选多个元件；Shift+点元件增减选择；
 *  - 双击自定义器件实例钻入其定义内部；
 *  - 连线为曼哈顿折线，按信号着色（1 绿、0 灰蓝、未知虚灰）。
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type {
  CircuitComponent,
  ComponentType,
  DeviceDefinition,
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
  componentInRect,
  componentWidth,
  hitTestInputPort,
  hitTestOutputPort,
  inputPortCount,
  outputPortCount,
  portPosition,
  routeWire,
  snap,
  type DefLookup
} from '../lib/geometry';
import { uid } from '../lib/utils';
import { makeInstance } from '../lib/packaging';
import {
  GateSymbol,
  InputSwitchSymbol,
  InstanceSymbol,
  OutputLampSymbol
} from './GateSymbols';
import { DEVICE_DND_MIME, GATE_DND_MIME } from './Toolbar';

interface CanvasProps {
  components: CircuitComponent[];
  wires: Wire[];
  definitions: DeviceDefinition[];
  evalResult: EvalResult | null;
  selectedComponentIds: string[];
  selectedWireId: string | null;
  dispatch: (a: EditorAction) => void;
  onOpenInstance: (deviceId: string) => void;
}

interface View {
  scale: number;
  tx: number;
  ty: number;
}

interface Wiring {
  fromId: string;
  fromPort: number;
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

interface Marquee {
  start: { x: number; y: number };
  current: { x: number; y: number };
}

const MIN_SCALE = 0.4;
const MAX_SCALE = 2.2;

function wireStyle(signal: Signal): { stroke: string; dash?: string } {
  if (signal === 1) return { stroke: '#3ddc84' };
  if (signal === 0) return { stroke: '#5b7186' };
  return { stroke: '#8a93a3', dash: '6 5' };
}

export function Canvas(props: CanvasProps) {
  const {
    components,
    wires,
    definitions,
    evalResult,
    selectedComponentIds,
    selectedWireId,
    dispatch,
    onOpenInstance
  } = props;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [view, setView] = useState<View>({ scale: 1, tx: 40, ty: 40 });
  const [wiring, setWiring] = useState<Wiring | null>(null);
  const draggingRef = useRef<Dragging | null>(null);
  const panningRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const marqueeRef = useRef<Marquee | null>(null);
  const [marqueeTick, setMarqueeTick] = useState(0);
  const [, forceTick] = useState(0);

  const defs: DefLookup = useMemo(
    () => new Map(definitions.map((d) => [d.id, d])),
    [definitions]
  );
  const selectionSet = useMemo(() => new Set(selectedComponentIds), [selectedComponentIds]);

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
      const wx = (mx - v.tx) / v.scale;
      const wy = (my - v.ty) / v.scale;
      return { scale, tx: mx - wx * scale, ty: my - wy * scale };
    });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const world = toWorld(e.clientX, e.clientY);

    // 1. 是否点在输出端口上 -> 开始拉线
    const outPort = hitTestOutputPort(components, world, 12, defs);
    if (outPort) {
      const c = components.find((x) => x.id === outPort.componentId)!;
      setWiring({
        fromId: c.id,
        fromPort: outPort.port,
        fromPos: portPosition(c, 'out', outPort.port, defs),
        cursor: world,
        hoverPort: null
      });
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    // 2. 是否点在元件体上
    const hit = componentAt(components, world, defs);
    if (hit) {
      if (e.shiftKey) {
        // Shift+点：增减选择，不开始拖动
        const next = selectionSet.has(hit.id)
          ? selectedComponentIds.filter((id) => id !== hit.id)
          : [...selectedComponentIds, hit.id];
        dispatch({ type: 'select', componentIds: next, wireId: null });
      } else {
        if (!selectionSet.has(hit.id)) {
          dispatch({ type: 'select', componentIds: [hit.id], wireId: null });
        }
        draggingRef.current = {
          id: hit.id,
          pointerStart: { x: e.clientX, y: e.clientY },
          compStart: { x: hit.x, y: hit.y },
          moved: false
        };
      }
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      return;
    }

    // 3. 点空白：Shift 拖框圈选；普通拖动平移
    if (e.shiftKey) {
      marqueeRef.current = { start: world, current: world };
      setMarqueeTick((n) => n + 1);
    } else {
      dispatch({ type: 'select', componentIds: [], wireId: null });
      panningRef.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
    }
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const world = toWorld(e.clientX, e.clientY);

    if (wiring) {
      const hover = hitTestInputPort(components, world, 12, defs);
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

    if (marqueeRef.current) {
      marqueeRef.current.current = world;
      setMarqueeTick((n) => n + 1);
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
          from: { componentId: wiring.fromId, port: wiring.fromPort },
          to: { componentId: wiring.hoverPort.componentId, port: wiring.hoverPort.port }
        };
        dispatch({ type: 'add-wire', wire });
      }
      setWiring(null);
      return;
    }

    if (marqueeRef.current) {
      const { start, current } = marqueeRef.current;
      const rect = {
        x: Math.min(start.x, current.x),
        y: Math.min(start.y, current.y),
        w: Math.abs(current.x - start.x),
        h: Math.abs(current.y - start.y)
      };
      marqueeRef.current = null;
      setMarqueeTick((n) => n + 1);
      // 小于阈值视为单击空白：清空选择
      if (rect.w < 6 && rect.h < 6) {
        dispatch({ type: 'select', componentIds: [], wireId: null });
        return;
      }
      const ids = components.filter((c) => componentInRect(c, rect, defs)).map((c) => c.id);
      dispatch({ type: 'select', componentIds: ids, wireId: null });
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
    const world = toWorld(e.clientX, e.clientY);

    const deviceId = e.dataTransfer.getData(DEVICE_DND_MIME);
    if (deviceId) {
      const def = defs.get(deviceId);
      if (def) {
        const comp = makeInstance(def, snap(world.x - 55), snap(world.y - 30));
        dispatch({ type: 'add-component', component: comp });
      }
      return;
    }

    const type = e.dataTransfer.getData(GATE_DND_MIME) as ComponentType;
    if (!type) return;
    const comp: CircuitComponent = {
      id: uid('c'),
      type,
      x: snap(world.x - COMP_WIDTH / 2),
      y: snap(world.y - COMP_HEIGHT / 2),
      value: type === 'INPUT' ? 0 : undefined,
      inputCount:
        type !== 'INPUT' && type !== 'OUTPUT' && type !== 'NOT' && type !== 'SUB' ? 2 : undefined
    };
    dispatch({ type: 'add-component', component: comp });
  };

  const signalOf = (w: Wire): Signal =>
    evalResult?.ok ? evalResult.wireValues[w.id] ?? null : null;

  const cycleSet = new Set(
    evalResult && !evalResult.ok && evalResult.error.kind === 'cycle'
      ? evalResult.error.path ?? []
      : []
  );

  const marquee = marqueeRef.current;
  void marqueeTick;

  return (
    <svg
      ref={svgRef}
      className={`canvas ${marquee ? 'marqueeing' : ''}`}
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
            const p1 = portPosition(from, 'out', w.from.port, defs);
            const p2 = portPosition(to, 'in', w.to.port, defs);
            const s = signalOf(w);
            const st = wireStyle(s);
            const isSel = w.id === selectedWireId;
            return (
              <g key={w.id}>
                <path
                  d={routeWire(p1, p2)}
                  stroke="transparent"
                  strokeWidth={12}
                  style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    dispatch({ type: 'select', componentIds: [], wireId: w.id });
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
          Array.from({ length: inputPortCount(c, defs) }, (_, port) => {
            const pos = portPosition(c, 'in', port, defs);
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
          const selected = selectionSet.has(c.id);
          const inCycle = cycleSet.has(c.id);
          const h = componentHeight(c, defs);
          const w = componentWidth(c);
          return (
            <g
              key={c.id}
              transform={`translate(${c.x} ${c.y})`}
              style={{ cursor: c.type === 'INPUT' ? 'pointer' : 'move' }}
              onDoubleClick={() => {
                if (c.type === 'SUB' && c.deviceId) onOpenInstance(c.deviceId);
              }}
            >
              {selected && (
                <rect
                  x={-4}
                  y={-4}
                  width={w + 8}
                  height={h + (c.type === 'INPUT' || c.type === 'OUTPUT' ? 22 : 8)}
                  rx={8}
                  fill="none"
                  stroke="#ffd166"
                  strokeWidth={1.4}
                  strokeDasharray="4 3"
                  style={{ pointerEvents: 'none' }}
                />
              )}
              <ComponentBody
                c={c}
                defs={defs}
                selected={selected}
                dimmed={inCycle}
                signal={evalResult?.ok ? evalResult.outputs[c.id] ?? null : null}
              />
              {c.type !== 'INPUT' && c.type !== 'OUTPUT' && c.type !== 'SUB' && (
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
              {c.type === 'SUB' && (
                <text
                  x={w / 2}
                  y={h + 14}
                  textAnchor="middle"
                  fontSize={10}
                  fill="#6f8299"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  双击钻入
                </text>
              )}
              {(c.type === 'INPUT' || c.type === 'OUTPUT') && (
                <text
                  x={26}
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

        {/* 输出端口圆点（实例逐个输出端口绘制） */}
        {components.map((c) => {
          const n = outputPortCount(c, defs);
          if (n === 0) return null;
          return Array.from({ length: n }, (_, port) => {
            const pos = portPosition(c, 'out', port, defs);
            const isWiringSource = wiring?.fromId === c.id && wiring.fromPort === port;
            return (
              <circle
                key={`out-${c.id}-${port}`}
                cx={pos.x}
                cy={pos.y}
                r={isWiringSource ? 6.5 : 5}
                fill="#0f1620"
                stroke={isWiringSource ? '#3ddc84' : '#c9d4e3'}
                strokeWidth={1.6}
                style={{ cursor: 'crosshair' }}
              />
            );
          });
        })}

        {/* 拉线时高亮合法目标端口 */}
        {wiring?.hoverPort &&
          (() => {
            const c = components.find((x) => x.id === wiring.hoverPort!.componentId)!;
            const pos = portPosition(c, 'in', wiring.hoverPort!.port, defs);
            return <circle cx={pos.x} cy={pos.y} r={11} fill="none" stroke="#3ddc84" strokeWidth={1.5} strokeDasharray="3 3" />;
          })()}

        {/* 框选矩形 */}
        {marquee &&
          (() => {
            const r = {
              x: Math.min(marquee.start.x, marquee.current.x),
              y: Math.min(marquee.start.y, marquee.current.y),
              w: Math.abs(marquee.current.x - marquee.start.x),
              h: Math.abs(marquee.current.y - marquee.start.y)
            };
            return (
              <rect
                x={r.x}
                y={r.y}
                width={r.w}
                height={r.h}
                fill="rgba(77,163,255,0.12)"
                stroke="#4da3ff"
                strokeWidth={1}
                strokeDasharray="4 3"
                style={{ pointerEvents: 'none' }}
              />
            );
          })()}
      </g>
    </svg>
  );
}

const GRID_PX = 20;

function ComponentBody({
  c,
  defs,
  selected,
  dimmed,
  signal
}: {
  c: CircuitComponent;
  defs: DefLookup;
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
  if (c.type === 'SUB') {
    const def = c.deviceId ? defs.get(c.deviceId) : undefined;
    if (!def) {
      // 定义缺失：红框占位
      return (
        <rect
          x={1}
          y={1}
          width={108}
          height={62}
          rx={8}
          fill="#2a1414"
          stroke="#ff6b6b"
          strokeWidth={2}
        />
      );
    }
    return (
      <InstanceSymbol
        def={def}
        height={componentHeight(c, defs)}
        selected={selected}
        active={signal === 1}
      />
    );
  }
  return <GateSymbol type={c.type} active={signal === 1} selected={selected} dimmed={dimmed} height={componentHeight(c, defs)} />;
}
