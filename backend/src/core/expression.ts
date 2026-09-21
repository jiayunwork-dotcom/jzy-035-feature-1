/**
 * 布尔表达式提取（SOP）。
 *
 * 对每个选定输出：先用求值内核穷举真值表，取输出为 1 的最小项，
 * 再分别给出
 *   - 标准 SOP（规范积之和：每个最小项一项、含全部变量，即 Σm 的展开）
 *   - 最简 SOP（Quine–McCluskey 化简）
 * 并同时给出 Σm 最小项列表。
 * 恒 0 -> "0"，恒 1 -> "1"。
 */

import { minimizeSop, termToString, termsToString, type Term } from './minimizer.js';
import {
  buildTruthTable,
  defaultVarName,
  type TruthTableResult
} from './truthTable.js';
import type { Circuit } from './types.js';

export interface OutputExpression {
  outputId: string;
  outputName: string;
  /** 输出为 1 的最小项编号 */
  minterms: number[];
  /** Σ m(...) 文本 */
  sigma: string;
  /** 规范积之和（未化简） */
  canonical: string;
  /** 最简积之和 */
  minimal: string;
}

export interface ExpressionOk {
  ok: true;
  variables: string[];
  expressions: OutputExpression[];
}

export interface ExpressionErr {
  ok: false;
  message: string;
  cyclePath?: string[];
}

export type ExpressionResult = ExpressionOk | ExpressionErr;

export function extractExpressions(input: {
  circuit: Circuit;
  inputIds: string[];
  outputIds: string[];
}): ExpressionResult {
  const tt: TruthTableResult = buildTruthTable(input);
  if (!tt.ok) {
    return { ok: false, message: tt.message, cyclePath: tt.cyclePath };
  }

  const n = tt.variables.length;
  const variables = tt.variables.map((v, i) => v || defaultVarName(i));
  const fullMask = (1 << n) - 1;

  const expressions: OutputExpression[] = tt.outputNames.map((name, j) => {
    const minterms = tt.rows.filter((r) => r.outputs[j] === 1).map((r) => r.minterm);

    // 规范 SOP：最小项直接展开为全部变量的乘积
    const canonicalTerms: Term[] = minterms.map((m) => ({
      mask: fullMask,
      value: m,
      covers: [m]
    }));
    const canonical =
      minterms.length === 0
        ? '0'
        : minterms.length === tt.rows.length
          ? '1'
          : canonicalTerms.map((t) => termToString(t, variables)).join(' + ');

    const minimalTerms = minimizeSop(minterms, [], n);
    const minimal =
      minterms.length === tt.rows.length && n >= 1
        ? '1'
        : termsToString(minimalTerms, variables);

    const sigma =
      minterms.length === 0
        ? '∑ m() = 0'
        : `∑ m(${minterms.join(', ')})`;

    return {
      outputId: input.outputIds[j],
      outputName: name,
      minterms,
      sigma,
      canonical,
      minimal
    };
  });

  return { ok: true, variables, expressions };
}
