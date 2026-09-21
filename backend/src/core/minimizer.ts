/**
 * 布尔函数最小化（积之和 SOP）。
 *
 * 使用 Quine–McCluskey 思想：
 *   1. 从使输出为 1 的最小项（以及无关项 d）出发，
 *      逐位合并、标记被覆盖项，得到全部质蕴含项；
 *   2. 本质质蕴含项先行选取；
 *   3. 剩余覆盖问题用小规模穷举（质蕴含项很少时 2^p 完全可接受）
 *      求变量数最少、并列时按字典序稳定的一个最简和；
 *   4. 没有无关项时得到的就是最简 SOP。
 *
 * 质蕴含项用掩码对表示：mask 中为 1 的位表示该变量出现，
 * value 给出该位取值；mask 中为 0 表示该变量被消去。
 * 位 i 对应变量 vars[i]，约定 i=0 为最高位（与真值表编号一致）。
 */

export interface Term {
  mask: number;
  value: number;
  /** 该蕴含项覆盖的最小项（含无关项） */
  covers: number[];
}

export interface MintermSets {
  /** 输出为 1 的最小项 */
  ones: number[];
  /** 无关项（当前工具暂不产生，接口预留） */
  dontcares?: number[];
}

/**
 * 同一合并层上的两个蕴含项可合并，当且仅当：
 * 保留变量集合相同（mask 相等）且取值恰好有一位不同；
 * 合并后该位被消去。
 */
function combine(a: Term, b: Term, varCount: number): Term | null {
  if (a.mask !== b.mask) return null;
  const diff = (a.value ^ b.value) & a.mask & ((1 << varCount) - 1);
  if (diff === 0 || (diff & (diff - 1)) !== 0) return null;
  const newMask = a.mask ^ diff;
  const newValue = a.value & newMask;
  const covers = [...new Set([...a.covers, ...b.covers])].sort((x, y) => x - y);
  return { mask: newMask, value: newValue, covers };
}

/** 求全部质蕴含项 */
export function primeImplicants(
  ones: number[],
  dontcares: number[],
  varCount: number
): Term[] {
  let terms: Term[] = [...ones, ...dontcares].map((m) => ({
    mask: (1 << varCount) - 1,
    value: m,
    covers: [m]
  }));

  const primes: Term[] = [];

  while (terms.length > 0) {
    const used = new Array(terms.length).fill(false);
    const nextMap = new Map<string, Term>();

    for (let i = 0; i < terms.length; i++) {
      for (let j = i + 1; j < terms.length; j++) {
        const merged = combine(terms[i], terms[j], varCount);
        if (merged) {
          used[i] = true;
          used[j] = true;
          const key = `${merged.mask}:${merged.value}`;
          const existing = nextMap.get(key);
          if (!existing) {
            nextMap.set(key, merged);
          } else {
            const coverSet = new Set([...existing.covers, ...merged.covers]);
            existing.covers = [...coverSet].sort((a, b) => a - b);
          }
        }
      }
    }

    terms.forEach((t, i) => {
      if (!used[i]) primes.push(t);
    });
    terms = [...nextMap.values()];
  }

  // 仅由无关项构成的质蕴含项无用（虽然 QM 一般不会产生，保险起见过滤）
  const oneSet = new Set(ones);
  return primes.filter((p) => p.covers.some((m) => oneSet.has(m)));
}

/** 计算一个最小 SOP（覆盖全部 ones），返回选中的质蕴含项 */
export function minimumCover(ones: number[], primes: Term[]): Term[] {
  if (ones.length === 0) return [];

  const oneSet = new Set(ones);
  const useful = primes
    .map((p) => ({ term: p, coversOnes: p.covers.filter((m) => oneSet.has(m)) }))
    .filter((p) => p.coversOnes.length > 0);

  // 本质质蕴含项：某最小项只被它一个 PI 覆盖
  const chosen: typeof useful = [];
  const covered = new Set<number>();
  for (const m of ones) {
    const owners = useful.filter((p) => p.coversOnes.includes(m));
    if (owners.length === 1) {
      const pick = owners[0];
      if (!chosen.includes(pick)) {
        chosen.push(pick);
        pick.coversOnes.forEach((x) => covered.add(x));
      }
    }
  }

  const remaining = ones.filter((m) => !covered.has(m));
  if (remaining.length === 0) return chosen.map((p) => p.term);

  const candidates = useful.filter(
    (p) => !chosen.includes(p) && p.coversOnes.some((m) => remaining.includes(m))
  );

  // 穷举候选子集，找覆盖 remaining 且变量数最少的方案
  let best: typeof useful | null = null;
  const k = candidates.length;
  outer: for (let s = 0; s < 1 << k; s++) {
    const got = new Set<number>();
    const pick: typeof useful = [];
    for (let i = 0; i < k; i++) {
      if (s & (1 << i)) {
        pick.push(candidates[i]);
        candidates[i].coversOnes.forEach((m) => got.add(m));
      }
    }
    if (remaining.every((m) => got.has(m))) {
      if (
        best === null ||
        totalLiterals(pick) < totalLiterals(best) ||
        (totalLiterals(pick) === totalLiterals(best) &&
          expressionKey(pick) < expressionKey(best))
      ) {
        best = pick;
      }
      if (best !== null && totalLiterals(best) === 0) break outer;
    }
  }

  return [...chosen.map((p) => p.term), ...(best ?? candidates).map((p) => p.term)];
}

function totalLiterals(picks: { term: Term }[]): number {
  return picks.reduce((acc, p) => acc + popcount(p.term.mask), 0);
}

function popcount(x: number): number {
  let n = 0;
  while (x) {
    n += x & 1;
    x >>= 1;
  }
  return n;
}

/** 稳定的字典序排序键：按 term 的 (mask, value) 排列后拼接 */
function expressionKey(picks: { term: Term }[]): string {
  return picks
    .map((p) => p.term)
    .slice()
    .sort((a, b) => a.mask - b.mask || a.value - b.value)
    .map((t) => `${t.mask.toString(16)}.${t.value.toString(16)}`)
    .join('|');
}

/** 求最简 SOP（ones 为空返回 null 表示恒 0） */
export function minimizeSop(
  ones: number[],
  dontcares: number[],
  varCount: number
): Term[] | null {
  if (ones.length === 0) return null;
  const allOnes = new Set(ones);
  if (allOnes.size === 2 ** varCount && dontcares.length === 0) return []; // 恒 1
  const primes = primeImplicants(ones, dontcares, varCount);
  return minimumCover(ones, primes);
}

/** 将一个乘积项渲染为布尔记号，如 A·B'；空项（恒 1）返回 "1" */
export function termToString(term: Term, variables: string[]): string {
  if (term.mask === 0) return '1';
  const parts: string[] = [];
  const n = variables.length;
  for (let i = 0; i < n; i++) {
    const bit = n - 1 - i; // 变量 i 是最高位
    if (term.mask & (1 << bit)) {
      parts.push(term.value & (1 << bit) ? variables[i] : `${variables[i]}'`);
    }
  }
  return parts.join('·');
}

/** 将若干乘积项渲染为 SOP 表达式 */
export function termsToString(terms: Term[] | null, variables: string[]): string {
  if (terms === null) return '0';
  if (terms.length === 0) return '1';
  return terms.map((t) => termToString(t, variables)).join(' + ');
}
