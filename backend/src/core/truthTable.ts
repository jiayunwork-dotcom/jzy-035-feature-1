/**
 * 真值表穷举：
 * 选定 n 个输入开关后枚举全部 2^n 种组合（按二进制 0..2^n-1，
 * 第 0 个变量为最高位），逐行代入同一套拓扑求值内核，
 * 收集选定输出灯的值。
 *
 * 变量较多时行数爆炸，故：
 *  - n > 10（1024 行）返回 warning，仍然生成；
 *  - n > MAX_TRUTH_TABLE_VARS 直接拒绝，避免后端做数亿次求值。
 */

import { evaluate } from './evaluate.js';
import { validateCircuit } from './graph.js';
import type { Circuit, Signal } from './types.js';

export const TRUTH_TABLE_WARN_VARS = 10;
export const MAX_TRUTH_TABLE_VARS = 20;

export interface TruthTableRequest {
  circuit: Circuit;
  inputIds: string[];
  outputIds: string[];
}

export interface TruthTableRow {
  /** 与 inputIds 对齐的 0/1 */
  inputs: number[];
  /** 与 outputIds 对齐的 0/1/null（正常组合电路里不会有 null，除非悬空） */
  outputs: Signal[];
  /** 本行输入组合对应的最小项编号（MSB = 第一个变量） */
  minterm: number;
}

export interface TruthTableOk {
  ok: true;
  variables: string[];
  outputNames: string[];
  rows: TruthTableRow[];
  rowCount: number;
  warning?: string;
}

export interface TruthTableErr {
  ok: false;
  message: string;
  /** 环错误时携带环路径，供前端高亮 */
  cyclePath?: string[];
}

export type TruthTableResult = TruthTableOk | TruthTableErr;

export function buildTruthTable(req: TruthTableRequest): TruthTableResult {
  const { circuit, inputIds, outputIds } = req;
  const v = validateCircuit(circuit);
  if (v) return { ok: false, message: v.message };

  const compById = new Map(circuit.components.map((c) => [c.id, c]));

  for (const id of inputIds) {
    const c = compById.get(id);
    if (!c) return { ok: false, message: `输入元件不存在: ${id}` };
    if (c.type !== 'INPUT') return { ok: false, message: `变量 ${id} 不是输入开关` };
  }
  for (const id of outputIds) {
    const c = compById.get(id);
    if (!c) return { ok: false, message: `输出元件不存在: ${id}` };
    if (c.type !== 'OUTPUT') return { ok: false, message: `${id} 不是输出指示灯` };
  }
  if (new Set(inputIds).size !== inputIds.length) {
    return { ok: false, message: '输入变量有重复' };
  }
  if (new Set(outputIds).size !== outputIds.length) {
    return { ok: false, message: '输出有重复' };
  }
  if (inputIds.length === 0) return { ok: false, message: '请至少选择一个输入开关' };
  if (outputIds.length === 0) return { ok: false, message: '请至少选择一个输出指示灯' };

  const n = inputIds.length;
  if (n > MAX_TRUTH_TABLE_VARS) {
    return {
      ok: false,
      message: `最多支持 ${MAX_TRUTH_TABLE_VARS} 个输入变量（${2 ** MAX_TRUTH_TABLE_VARS} 行），当前为 ${n} 个`
    };
  }

  const total = 2 ** n;
  const rows: TruthTableRow[] = [];

  for (let m = 0; m < total; m++) {
    const inputAssignment: Record<string, 0 | 1> = {};
    const bits: number[] = [];
    for (let i = 0; i < n; i++) {
      // i=0 是第一个变量，作为最高位
      const bit = (m >> (n - 1 - i)) & 1;
      bits.push(bit);
      inputAssignment[inputIds[i]] = bit as 0 | 1;
    }

    const result = evaluate(circuit, inputAssignment);
    if (!result.ok) {
      return {
        ok: false,
        message: result.error.kind === 'cycle'
          ? result.error.message
          : result.error.message,
        cyclePath: result.error.kind === 'cycle' ? result.error.path : undefined
      };
    }

    rows.push({
      inputs: bits,
      outputs: outputIds.map((id) => result.outputs[id] ?? null),
      minterm: m
    });
  }

  const variables = inputIds.map((id, i) => compById.get(id)!.label?.trim() || defaultVarName(i));
  const outputNames = outputIds.map((id) => compById.get(id)!.label?.trim() || 'F');

  const warning =
    n > TRUTH_TABLE_WARN_VARS
      ? `共有 ${n} 个输入变量，真值表达 ${total} 行，规模较大（${total} 次电路求值），生成与展示可能较慢。`
      : undefined;

  return { ok: true, variables, outputNames, rows, rowCount: total, warning };
}

/** 默认变量名 A, B, ..., Z */
export function defaultVarName(index: number): string {
  return String.fromCharCode(65 + index);
}

/** 将真值表结果导出为 CSV 文本 */
export function truthTableToCsv(result: TruthTableOk): string {
  const header = [...result.variables, ...result.outputNames.map((n) => `${n}(输出)`)];
  const lines = [header.join(',')];
  for (const row of result.rows) {
    lines.push([
      ...row.inputs.map(String),
      ...row.outputs.map((s) => (s === null ? 'x' : String(s)))
    ].join(','));
  }
  return lines.join('\n');
}
