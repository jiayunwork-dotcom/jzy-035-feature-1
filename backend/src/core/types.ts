/**
 * 电路领域模型 —— 前后端共享的核心数据结构。
 *
 * 电路是一张有向图：元件(Component)是节点，连线(Wire)从某元件的输出端口
 * 指向另一元件的输入端口。INPUT 元件没有输入端口，OUTPUT 元件没有逻辑输出端口。
 *
 * 分层扩展：
 *  - type 为 'CUSTOM' 的元件是"自定义器件实例"，它引用一份 DeviceDefinition；
 *    在所在层它是个黑盒方块，输入/输出端口数由定义的管脚表决定
 * （自定义器件支持多个输出端口，故连线 from.port 对 CUSTOM 可能 > 0）。
 *  - DeviceDefinition 内部仍是一张普通 Circuit：暴露的输入管脚对应内部的
 *    INPUT 元件，输出管脚对应内部的 OUTPUT 元件；内部电路可以再放 CUSTOM
 *    实例，形成任意深度的嵌套（定义引用图必须无环）。
 *  - Project 把"顶层电路 + 器件定义表"打成一个可存取的工程。
 *    旧文件是不带 definitions 的裸 Circuit（见 normalizeProject），必须照常读写。
 */

export type GateType =
  | 'AND'
  | 'OR'
  | 'NOT'
  | 'NAND'
  | 'NOR'
  | 'XOR'
  | 'XNOR';

export type ComponentType = GateType | 'INPUT' | 'OUTPUT' | 'CUSTOM';

export interface PortRef {
  componentId: string;
  /**
   * 端口序号：
   *  - 普通门/INPUT 的输出端口固定为 0；CUSTOM 实例可为 0..输出管脚数-1
   *  - NOT 门输入为 0，其余门输入从 0 起；INPUT 无输入
   *  - CUSTOM 实例的输入端口对应定义 inputs 的下标
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
  /** CUSTOM 实例引用的器件定义 id */
  definitionId?: string;
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

/** 器件管脚定义：管脚在管脚表中的下标即端口号，componentId 指向定义内部电路里的 INPUT/OUTPUT 元件 */
export interface PinDef {
  id: string;
  /** 管脚显示名（如 A、B、S），缺省由前端用序号补 */
  name?: string;
  /** 该管脚在定义内部电路中对应的 INPUT（输入管脚）或 OUTPUT（输出管脚）元件 id */
  componentId: string;
}

/** 可复用的自定义器件定义：一份带命名管脚的内部电路 */
export interface DeviceDefinition {
  id: string;
  name: string;
  /** 对外输入管脚（下标即实例左侧输入端口号） */
  inputs: PinDef[];
  /** 对外输出管脚（下标即实例右侧输出端口号） */
  outputs: PinDef[];
  /** 内部电路（其中可以再引用其它 DeviceDefinition） */
  circuit: Circuit;
}

/**
 * 工程文件：顶层电路 + 器件定义表。
 * version 缺省/为 1 时是旧版裸 Circuit（只有 components/wires）。
 */
export interface Project {
  version: 2;
  circuit: Circuit;
  definitions: DeviceDefinition[];
}

/** 三值信号：1 / 0 / null(未确定，通常因为输入端口悬空) */
export type Signal = 0 | 1 | null;

export interface CycleError {
  kind: 'cycle';
  /** 构成环的元件 id 序列，首尾不同但逻辑上闭合 */
  path: string[];
  /** 环出现在哪张电路里：null=顶层电路；否则为器件定义 id */
  layer?: string | null;
  message: string;
}

/** 器件定义之间的循环引用（甲定义里用乙、乙定义里又用甲），展开即死循环 */
export interface DefinitionCycleError {
  kind: 'definition-cycle';
  /** 构成环的器件定义 id 序列，末位与首位相同以显式闭合 */
  path: string[];
  message: string;
}

export interface ValidationError {
  kind: 'validation';
  message: string;
}

export type CircuitError = CycleError | DefinitionCycleError | ValidationError;
