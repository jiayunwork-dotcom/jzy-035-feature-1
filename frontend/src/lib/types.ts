/** 与后端 src/core/types.ts 对应的电路模型（HTTP/JSON 传输） */

export type GateType =
  | 'AND'
  | 'OR'
  | 'NOT'
  | 'NAND'
  | 'NOR'
  | 'XOR'
  | 'XNOR';

export type ComponentType = GateType | 'INPUT' | 'OUTPUT';

export interface PortRef {
  componentId: string;
  port: number;
}

export interface CircuitComponent {
  id: string;
  type: ComponentType;
  x: number;
  y: number;
  label?: string;
  value?: 0 | 1;
  inputCount?: number;
}

export interface Wire {
  id: string;
  from: PortRef;
  to: PortRef;
}

export interface Circuit {
  components: CircuitComponent[];
  wires: Wire[];
}

export type Signal = 0 | 1 | null;

export interface EvalResultOk {
  ok: true;
  outputs: Record<string, Signal>;
  wireValues: Record<string, Signal>;
  order: string[];
}

export interface EvalResultErr {
  ok: false;
  error: {
    kind: 'cycle' | 'validation';
    path?: string[];
    message: string;
  };
}

export type EvalResult = EvalResultOk | EvalResultErr;

export interface TruthTableOk {
  ok: true;
  variables: string[];
  outputNames: string[];
  rows: { inputs: number[]; outputs: Signal[]; minterm: number }[];
  rowCount: number;
  warning?: string;
}

export interface ExpressionOk {
  ok: true;
  variables: string[];
  expressions: {
    outputId: string;
    outputName: string;
    minterms: number[];
    sigma: string;
    canonical: string;
    minimal: string;
  }[];
}

export interface KMapGroup {
  term: string;
  minterms: number[];
  runs: { row: number; cols: number[] }[];
}

export interface KMapOk {
  ok: true;
  varCount: number;
  variables: string[];
  outputId: string;
  outputName: string;
  rowBits: number;
  colBits: number;
  rowLabels: string[];
  colLabels: string[];
  cells: { row: number; col: number; minterm: number; value: 0 | 1 }[];
  groups: KMapGroup[];
  minimalExpression: string;
}

export interface GenericErr {
  ok: false;
  message: string;
  cyclePath?: string[];
}

export interface Level {
  id: string;
  title: string;
  description: string;
  hint: string;
  inputCount: number;
  outputNames: string[];
  target: number[][];
}

export interface LevelVerifyOk {
  ok: true;
  passed: boolean;
  rows: { minterm: number; expected: number[]; actual: Signal[]; match: boolean }[];
  mismatchCount: number;
  message: string;
}
