/**
 * 卡诺图（Karnaugh map）。
 *
 * 仅支持 2~4 个输入变量：
 *   2 变量：1 行 × 4 格，列 Gray 码 00 01 11 10（变量 A=行? 这里采用：
 *           变量放行/列见 buildKarnaugh 中的布局说明）
 *   3 变量：2 行 × 4 列，行变量 1 个，列变量 2 个（Gray 码）
 *   4 变量：4 行 × 4 列，行、列各 2 个变量（均 Gray 码）
 *
 * 化简直接复用 minimizer 的质蕴含项/最小覆盖；groups 中给出每个被选中
 * 乘积项所覆盖的最小项以及它们在环面上的最大矩形行程，供前端画圈。
 */

import {
  minimizeSop,
  primeImplicants,
  minimumCover,
  termToString,
  type Term
} from './minimizer.js';
import { buildTruthTable, type TruthTableResult } from './truthTable.js';
import type { Circuit, DeviceDefinition } from './types.js';

export const KMAP_MIN_VARS = 2;
export const KMAP_MAX_VARS = 4;

export interface KMapCell {
  row: number;
  col: number;
  minterm: number;
  value: 0 | 1;
}

export interface KMapGroup {
  term: string;
  minterms: number[];
  /**
   * 该组在环面网格上的矩形行程：每行元素为
   *   { row, cols:[连续列...] }（行列均已展开环绕，cols 可能超过网格宽度）
   * 前端按每个 run 画一个矩形即可表现环绕分组。
   */
  runs: { row: number; cols: number[] }[];
}

export interface KMapResultOk {
  ok: true;
  varCount: number;
  variables: string[];
  outputId: string;
  outputName: string;
  rowBits: number;
  colBits: number;
  rowLabels: string[];
  colLabels: string[];
  cells: KMapCell[];
  groups: KMapGroup[];
  minimalExpression: string;
}

export interface KMapResultErr {
  ok: false;
  message: string;
  cyclePath?: string[];
}

export type KMapResult = KMapResultOk | KMapResultErr;

/** 标准 Gray 码：0,1,3,2（2 位）、0,1（1 位） */
function grayCodes(bits: number): number[] {
  const count = 1 << bits;
  return Array.from({ length: count }, (_, i) => i ^ (i >> 1));
}

export interface KMapRequest {
  circuit: Circuit;
  inputIds: string[];
  outputId: string;
  definitions?: DeviceDefinition[];
}

export function buildKarnaugh(req: KMapRequest): KMapResult {
  const outputIds = [req.outputId];
  const tt: TruthTableResult = buildTruthTable({
    circuit: req.circuit,
    inputIds: req.inputIds,
    outputIds,
    definitions: req.definitions
  });
  if (!tt.ok) {
    return { ok: false, message: tt.message, cyclePath: tt.cyclePath };
  }

  const n = tt.variables.length;
  if (n < KMAP_MIN_VARS || n > KMAP_MAX_VARS) {
    return {
      ok: false,
      message:
        n > KMAP_MAX_VARS
          ? `卡诺图只支持 ${KMAP_MIN_VARS}~${KMAP_MAX_VARS} 个变量：${KMAP_MAX_VARS} 变量已是 4×4=16 格的环面布局，超过 4 个变量后无法在二维平面上保持"相邻格只差一位"，图解法失效（请改用 QM 等列表化简法）。`
          : '单变量函数无需卡诺图，直接看表达式即可。'
    };
  }

  const variables = tt.variables;
  // 变量切分：行取前 1（3 变量）或前 2（2/4 变量）个；
  // 2 变量时布局为 2 行 × 2 列（各 1 位），更对称。
  const rowBits = n === 3 ? 1 : 2 === n ? 1 : 2;
  const colBits = n - rowBits;

  const rowGray = grayCodes(rowBits);
  const colGray = grayCodes(colBits);
  const rowVars = variables.slice(0, rowBits);
  const colVars = variables.slice(rowBits);

  const rowLabels = rowGray.map((code) => formatBits(code, rowBits, rowVars));
  const colLabels = colGray.map((code) => formatBits(code, colBits, colVars));

  const valueByMinterm = new Map<number, 0 | 1>();
  for (const row of tt.rows) {
    valueByMinterm.set(row.minterm, (row.outputs[0] ?? 0) as 0 | 1);
  }

  const cells: KMapCell[] = [];
  for (let r = 0; r < rowGray.length; r++) {
    for (let c = 0; c < colGray.length; c++) {
      const minterm = (rowGray[r] << colBits) | colGray[c];
      cells.push({
        row: r,
        col: c,
        minterm,
        value: valueByMinterm.get(minterm) ?? 0
      });
    }
  }

  const ones = tt.rows.filter((r) => r.outputs[0] === 1).map((r) => r.minterm);
  let chosen: Term[] | null;
  if (ones.length === 0) {
    chosen = null;
  } else if (ones.length === tt.rows.length) {
    chosen = [];
  } else {
    // 用与表达式模块完全相同的化简内核，保证两边结果一致
    chosen = minimizeSop(ones, [], n) ?? [];
  }

  const groups: KMapGroup[] = (chosen ?? [])
    .map((term) => buildGroup(term, n, rowBits, colBits, rowGray, colGray, variables))
    .sort((a, b) => b.minterms.length - a.minterms.length || a.term.localeCompare(b.term));

  const minimalExpression =
    chosen === null ? '0' : chosen.length === 0 ? '1' : groups.map((g) => g.term).join(' + ');

  return {
    ok: true,
    varCount: n,
    variables,
    outputId: req.outputId,
    outputName: tt.outputNames[0],
    rowBits,
    colBits,
    rowLabels,
    colLabels,
    cells,
    groups,
    minimalExpression
  };
}

function formatBits(code: number, bits: number, vars: string[]): string {
  if (bits === 0) return '';
  let s = '';
  for (let i = 0; i < bits; i++) {
    s += (code >> (bits - 1 - i)) & 1;
  }
  return `${vars.join('')}=${s}`;
}

/**
 * 求一个乘积项覆盖网格的形状：被消去的行/列变量产生整行/整列的跨越。
 * 返回 runs，每个 run 是一行上的连续列序列（已展开环绕重复）。
 */
function buildGroup(
  term: Term,
  n: number,
  rowBits: number,
  colBits: number,
  rowGray: number[],
  colGray: number[],
  variables: string[]
): KMapGroup {
  // 变量 i 位于二进制位 n-1-i；行变量是 i<rowBits
  let termRowMask = 0;
  let termRowValue = 0;
  for (let i = 0; i < rowBits; i++) {
    const bit = n - 1 - i;
    if (term.mask & (1 << bit)) {
      termRowMask |= 1 << (rowBits - 1 - i);
      if (term.value & (1 << bit)) termRowValue |= 1 << (rowBits - 1 - i);
    }
  }
  let termColMask = 0;
  let termColValue = 0;
  for (let i = 0; i < colBits; i++) {
    const vi = rowBits + i;
    const bit = n - 1 - vi;
    if (term.mask & (1 << bit)) {
      termColMask |= 1 << (colBits - 1 - i);
      if (term.value & (1 << bit)) termColValue |= 1 << (colBits - 1 - i);
    }
  }

  const matchingRows = rowGray
    .map((code, idx) => ({ code, idx }))
    .filter(({ code }) => (code & termRowMask) === termRowValue)
    .map(({ idx }) => idx);
  const matchingCols = colGray
    .map((code, idx) => ({ code, idx }))
    .filter(({ code }) => (code & termColMask) === termColValue)
    .map(({ idx }) => idx);

  // 在 Gray 环上把匹配坐标展开为若干连续行程
  const rowRuns = cyclicRuns(matchingRows, rowGray.length);
  const colRuns = cyclicRuns(matchingCols, colGray.length);

  const runs: KMapGroup['runs'] = [];
  const mintermSet = new Set<number>();
  for (const rr of rowRuns) {
    for (const r of rr) {
      const cols = colRuns.flat();
      runs.push({ row: r, cols });
      for (const c of cols) {
        mintermSet.add((rowGray[r] << colBits) | colGray[c]);
      }
    }
  }

  return {
    term: termToString(term, variables),
    minterms: [...mintermSet].sort((a, b) => a - b),
    runs
  };
}

/**
 * 把环上的一组坐标展开为连续行程。
 * 例如 4 列 Gray 网格中匹配 [0,1,3] -> [[3,0],[1]]（3→0 为跨边界环绕段，
 * 列号用重复值表示，前端识别到列号越界即画溢出矩形）；
 * 匹配全部坐标 -> [[0,1,...,size-1]]。
 */
function cyclicRuns(coords: number[], size: number): number[][] {
  const set = new Set(coords);
  if (set.size === size) return [Array.from({ length: size }, (_, i) => i)];

  const runs: number[][] = [];
  for (let start = 0; start < size; start++) {
    if (!set.has(start)) continue;
    const prev = (start - 1 + size) % size;
    if (set.has(prev)) continue; // 不是某段的起点
    const run: number[] = [];
    let cur = start;
    while (set.has(cur)) {
      run.push(cur);
      cur = (cur + 1) % size;
      if (run.length > size) break;
    }
    runs.push(run);
  }
  return runs;
}

/** 供测试/复用：直接对最小项集合求质蕴含项 */
export function karnaughPrimeImplicants(
  ones: number[],
  varCount: number
): Term[] {
  return primeImplicants(ones, [], varCount);
}

export function karnaughMinimumCover(ones: number[], varCount: number): Term[] {
  const primes = primeImplicants(ones, [], varCount);
  return minimumCover(ones, primes);
}
