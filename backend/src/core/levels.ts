/**
 * 教学关卡：每关给定输入个数、输出个数与目标真值表（按最小项列出输出）。
 *
 * 验证绝不比对电路结构 —— 一律把学生电路的全部 2^n 种输入组合送进
 * 同一套拓扑求值内核，逐行与目标真值表比较，完全一致才算通过。
 */

import { evaluate } from './evaluate.js';
import { validateCircuit } from './graph.js';
import { definitionMap } from './definitions.js';
import type { Circuit, DeviceDefinition } from './types.js';

export interface Level {
  id: string;
  title: string;
  description: string;
  hint: string;
  inputCount: number;
  /** 输出名称（单输出关卡长度 1） */
  outputNames: string[];
  /**
   * 目标真值表，长度必须为 2^inputCount；每个元素与 outputNames 对齐，
   * 给出该最小项上每个输出的期望值 0/1。
   */
  target: number[][];
}

export interface LevelVerifyRequest {
  levelId: string;
  circuit: Circuit;
  /** 学生用自定义器件搭电路时随请求带上的器件定义表 */
  definitions?: DeviceDefinition[];
}

export interface LevelVerifyOk {
  ok: true;
  passed: boolean;
  /** 逐行比对结果（不传结构信息，只传求值后的对错） */
  rows: {
    minterm: number;
    expected: number[];
    actual: (0 | 1 | null)[];
    match: boolean;
  }[];
  mismatchCount: number;
  message: string;
}

export interface LevelVerifyErr {
  ok: false;
  message: string;
  cyclePath?: string[];
}

export type LevelVerifyResult = LevelVerifyOk | LevelVerifyErr;

/** 工具函数：用"输出为 1 的最小项"数组构造目标表（单输出） */
function singleOutputTable(inputCount: number, oneMinterms: number[]): number[][] {
  const set = new Set(oneMinterms);
  return Array.from({ length: 2 ** inputCount }, (_, m) => [set.has(m) ? 1 : 0]);
}

export const LEVELS: Level[] = [
  {
    id: 'not-gate',
    title: '第 1 关：非门',
    description: '一个输入 A、一个输出 F，实现逻辑非：F = NOT A。',
    hint: '从左侧拖入一个"非"门，输入开关接它的输入端，输出端接指示灯。',
    inputCount: 1,
    outputNames: ['F'],
    target: singleOutputTable(1, [0])
  },
  {
    id: 'and2',
    title: '第 2 关：二输入与门',
    description: '两个输入 A、B，仅当 A、B 都为 1 时 F 为 1。F = A·B。',
    hint: '一个"与"门即可。',
    inputCount: 2,
    outputNames: ['F'],
    target: singleOutputTable(2, [3])
  },
  {
    id: 'xor-from-universal',
    title: '第 3 关：异或（可直接用异或门）',
    description: '两个输入 A、B，A、B 不同时 F 为 1。F = A⊕B = A·B\' + A\'·B。',
    hint: '可以直接放一个"异或"门；也可以尝试只用与/或/非门搭出来。',
    inputCount: 2,
    outputNames: ['F'],
    target: singleOutputTable(2, [1, 2])
  },
  {
    id: 'majority3',
    title: '第 4 关：三输入多数表决',
    description:
      '三个输入 A、B、C，多数（≥2 个）为 1 时 F 为 1。F = A·B + A·C + B·C。',
    hint: '三个二输入与门分别产生 AB、AC、BC，再用或门合起来；也可以用多输入门。',
    inputCount: 3,
    outputNames: ['F'],
    target: singleOutputTable(3, [3, 5, 6, 7])
  },
  {
    id: 'parity3',
    title: '第 5 关：三输入奇校验',
    description: '三个输入 A、B、C，当其中 1 的个数为奇数时 F 为 1。F = A⊕B⊕C。',
    hint: '两个异或门级联；注意信号要按拓扑顺序一级级传过去。',
    inputCount: 3,
    outputNames: ['F'],
    target: singleOutputTable(3, [1, 2, 4, 7])
  },
  {
    id: 'and3',
    title: '第 6 关：三输入与（只能用二输入门组合）',
    description: '三个输入全部为 1 时输出才为 1。请用二输入门搭出三输入与。',
    hint: 'AND(A, AND(B, C))，想想为什么可以任意结合。',
    inputCount: 3,
    outputNames: ['F'],
    target: singleOutputTable(3, [7])
  },
  {
    id: 'half-adder',
    title: '第 7 关：半加器（双输出）',
    description:
      'A、B 两个一位二进制数相加：S 是和（S = A⊕B），C 是进位（C = A·B）。输出顺序：S、C。',
    hint: '一个异或门得到 S，一个与门得到 C；输出指示灯按顺序分别接好。',
    inputCount: 2,
    outputNames: ['S', 'C'],
    target: [
      // A,B -> [S, C]
      [0, 0],
      [1, 0],
      [1, 0],
      [0, 1]
    ]
  }
];

export function getLevel(id: string): Level | undefined {
  return LEVELS.find((l) => l.id === id);
}

/**
 * 用真实求值判定关卡：
 * 要求学生电路恰好含 inputCount 个 INPUT 元件、outputNames.length 个 OUTPUT
 * 元件（按画面位置排序确定 A,B,... 与 F,... 的对应），随后逐行求值比对。
 */
export function verifyLevel(req: LevelVerifyRequest): LevelVerifyResult {
  const level = getLevel(req.levelId);
  if (!level) return { ok: false, message: `关卡不存在: ${req.levelId}` };

  const circuit: Circuit = req.circuit;
  const defLookup =
    req.definitions && req.definitions.length > 0 ? definitionMap(req.definitions) : undefined;
  const v = validateCircuit(circuit, defLookup);
  if (v) return { ok: false, message: v.message };

  // 按画面位置（先 x 后 y）排序，使变量/输出对应关系可预测
  const inputs = circuit.components
    .filter((c) => c.type === 'INPUT')
    .sort((a, b) => a.x - b.x || a.y - b.y);
  const outputs = circuit.components
    .filter((c) => c.type === 'OUTPUT')
    .sort((a, b) => a.x - b.x || a.y - b.y);

  if (inputs.length !== level.inputCount) {
    return {
      ok: false,
      message: `本关需要恰好 ${level.inputCount} 个输入开关，当前电路有 ${inputs.length} 个。`
    };
  }
  if (outputs.length !== level.outputNames.length) {
    return {
      ok: false,
      message: `本关需要恰好 ${level.outputNames.length} 个输出指示灯（${level.outputNames.join(
        '、'
      )}），当前电路有 ${outputs.length} 个。`
    };
  }

  const inputIds = inputs.map((c) => c.id);
  const outputIds = outputs.map((c) => c.id);
  const n = level.inputCount;

  const rows: LevelVerifyOk['rows'] = [];
  let mismatchCount = 0;

  for (let m = 0; m < 2 ** n; m++) {
    const assignment: Record<string, 0 | 1> = {};
    for (let i = 0; i < n; i++) {
      assignment[inputIds[i]] = ((m >> (n - 1 - i)) & 1) as 0 | 1;
    }
    const result = evaluate(circuit, assignment, req.definitions);
    if (!result.ok) {
      return {
        ok: false,
        message: result.error.message,
        cyclePath: result.error.kind === 'cycle' ? result.error.path : undefined
      };
    }
    const actual = outputIds.map((id) => result.outputs[id] ?? null);
    const expected = level.target[m];
    const match =
      actual.every((a) => a !== null) &&
      actual.every((a, j) => a === expected[j]);
    if (!match) mismatchCount++;
    rows.push({ minterm: m, expected, actual, match });
  }

  const passed = mismatchCount === 0;
  return {
    ok: true,
    passed,
    rows,
    mismatchCount,
    message: passed
      ? `全部 ${rows.length} 行真值表与目标一致，关卡通过！`
      : `有 ${mismatchCount} 行输出与目标真值表不符，继续调整电路。`
  };
}
