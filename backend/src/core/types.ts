/**
 * 电路领域模型 —— 前后端共享的核心数据结构。
 *
 * 电路是一张有向图：元件(Component)是节点，连线(Wire)从某元件的输出端口
 * 指向另一元件的输入端口。INPUT 元件没有输入端口，OUTPUT 元件没有逻辑输出端口。
 *
 * 分层扩展：
 *  - 'SUB' 类型元件是"自定义器件实例"，通过 deviceId 引用一份 DeviceDefinition；
 *  - 实例的输入端口数 = 定义输入管脚数，输出端口数 = 定义输出管脚数（可多输出，
 *    故连线的 from.port 对实例可以大于 0）；
 *  - DeviceDefinition 内部仍是一张普通 Circuit，从而支持任意层级嵌套。
 */

export type GateType =
  | 'AND'
  | 'OR'
  | 'NOT'
  | 'NAND'
  | 'NOR'
  | 'XOR'
  | 'XNOR';

export type ComponentType = GateType | 'INPUT' | 'OUTPUT' | 'SUB';

export interface PortRef {
  componentId: string;
  /**
   * 端口序号：
   *  - 输出侧：门/INPUT 固定为 0，SUB 实例为 0..输出管脚数-1；
   *  - 输入侧：NOT 为 0，其余门输入从 0 起，SUB 为 0..输入管脚数-1，INPUT 无输入。
   */
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
  /** type === 'SUB' 时引用的自定义器件定义 id */
  deviceId?: string;
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

/** 自定义器件的对外管脚：绑定定义内部电路中的一个 INPUT/OUTPUT 元件 */
export interface DevicePin {
  /** 内部被暴露为管脚的元件 id（输入管脚对应 INPUT，输出管脚对应 OUTPUT） */
  componentId: string;
  /** 对外管脚名（实例方块上显示） */
  name: string;
}

/** 可复用的自定义器件定义：名字 + 命名管脚 + 内部电路 */
export interface DeviceDefinition {
  id: string;
  name: string;
  /** 对外输入管脚，顺序即实例左侧输入端口从上到下的顺序 */
  inputPins: DevicePin[];
  /** 对外输出管脚，顺序即实例右侧输出端口从上到下的顺序；至少 1 个 */
  outputPins: DevicePin[];
  /** 内部电路（其中还可以放别的自定义器件实例，形成层级嵌套） */
  circuit: Circuit;
}

/** 整张工程：顶层画布 + 器件定义库。旧文件只有 Circuit，读取时按 defs=[] 归一化 */
export interface Project {
  version: 2;
  circuit: Circuit;
  definitions: DeviceDefinition[];
}

/** 三值信号：1 / 0 / null(未确定，通常因为输入端口悬空) */
export type Signal = 0 | 1 | null;

export interface CycleError {
  kind: 'cycle';
  /** 构成环的元件 id 序列，首尾不同但逻辑上闭合（同一层内的反馈环） */
  path: string[];
  message: string;
}

export interface ValidationError {
  kind: 'validation';
  message: string;
}

export interface DefinitionCycleError {
  kind: 'definition-cycle';
  /** 构成跨层循环引用的器件定义 id 序列（首尾呼应），如 甲 → 乙 → 甲 */
  path: string[];
  message: string;
}

export type CircuitError = CycleError | ValidationError | DefinitionCycleError;
