/**
 * 电路领域模型 —— 前后端共享的核心数据结构。
 *
 * 电路是一张有向图：元件(Component)是节点，连线(Wire)从某元件的输出端口
 * 指向另一元件的输入端口。INPUT 元件没有输入端口，OUTPUT 元件没有逻辑输出端口。
 */

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
  /** 端口序号：输出端口固定为 0；NOT 门输入为 0，其余门输入从 0 起；INPUT 无输入 */
  port: number;
}

export interface CircuitComponent {
  id: string;
  type: ComponentType;
  x: number;
  y: number;
  label?: string;
  /** 输入开关当前值（0/1） */
  value?: 0 | 1;
  /** 多输入门（AND/OR/...）的输入个数，默认 2；NOT 恒为 1 */
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

/** 三值信号：1 / 0 / null(未确定，通常因为输入端口悬空) */
export type Signal = 0 | 1 | null;

export interface CycleError {
  kind: 'cycle';
  /** 构成环的元件 id 序列，首尾不同但逻辑上闭合 */
  path: string[];
  message: string;
}

export interface ValidationError {
  kind: 'validation';
  message: string;
}

export type CircuitError = CycleError | ValidationError;
