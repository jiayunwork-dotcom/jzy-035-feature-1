/** 后端 HTTP/JSON 接口封装。核心算法全部在后端，这里只做请求。 */

import type {
  Circuit,
  DeviceDefinition,
  EvalResult,
  ExpressionOk,
  GenericErr,
  KMapOk,
  Level,
  LevelVerifyOk,
  TruthTableOk
} from './types';

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return (await res.json()) as T;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`请求失败: ${res.status}`);
  return (await res.json()) as T;
}

export function evaluateCircuit(
  circuit: Circuit,
  definitions: DeviceDefinition[] = []
): Promise<EvalResult> {
  return postJson('/api/evaluate', { circuit, definitions });
}

export function fetchTruthTable(
  circuit: Circuit,
  inputIds: string[],
  outputIds: string[],
  definitions: DeviceDefinition[] = []
): Promise<TruthTableOk | GenericErr> {
  return postJson('/api/truth-table', { circuit, inputIds, outputIds, definitions });
}

export function truthTableCsvUrl(): string {
  return '/api/truth-table';
}

/** CSV 下载用 POST（circuit 在 body 里） */
export async function downloadTruthTableCsv(
  circuit: Circuit,
  inputIds: string[],
  outputIds: string[],
  definitions: DeviceDefinition[] = []
): Promise<void> {
  const res = await fetch('/api/truth-table?format=csv', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ circuit, inputIds, outputIds, definitions, format: 'csv' })
  });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'truth-table.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export function fetchExpressions(
  circuit: Circuit,
  inputIds: string[],
  outputIds: string[],
  definitions: DeviceDefinition[] = []
): Promise<ExpressionOk | GenericErr> {
  return postJson('/api/expressions', { circuit, inputIds, outputIds, definitions });
}

export function fetchKarnaugh(
  circuit: Circuit,
  inputIds: string[],
  outputId: string,
  definitions: DeviceDefinition[] = []
): Promise<KMapOk | GenericErr> {
  return postJson('/api/karnaugh', { circuit, inputIds, outputId, definitions });
}

export async function fetchLevels(): Promise<Level[]> {
  const data = await getJson<{ levels: Level[] }>('/api/levels');
  return data.levels;
}

export function verifyLevel(
  levelId: string,
  circuit: Circuit,
  definitions: DeviceDefinition[] = []
): Promise<LevelVerifyOk | GenericErr> {
  return postJson('/api/levels/verify', { levelId, circuit, definitions });
}
