/**
 * 工程文件序列化 / 归一化。
 *
 * 新版工程：
 *   { version: 2, circuit: { components, wires }, definitions: DeviceDefinition[] }
 *
 * 旧版文件（升级前）：
 *   { components, wires }
 * 老工程里没有任何器件定义、没有实例，读入时必须与升级前表现完全一致 ——
 * 这里统一归一化成 Project（definitions 为空数组），扁平求值路径不受影响。
 */

import type {
  Circuit,
  DeviceDefinition,
  Project
} from './types.js';

export const PROJECT_VERSION = 2;

export interface NormalizeResult {
  project: Project;
  /** 是否识别为旧版纯扁平文件（definitions 归一化为空） */
  legacy: boolean;
  /** 数据本身非法时给出原因 */
  error?: string;
}

function isCircuitLike(data: unknown): data is Circuit {
  return (
    !!data &&
    typeof data === 'object' &&
    Array.isArray((data as Circuit).components) &&
    Array.isArray((data as Circuit).wires)
  );
}

/**
 * 把磁盘上的任意 JSON 归一化为 Project。
 *  - 旧版 { components, wires } -> { version:2, circuit:<原样>, definitions:[] }
 *  - 新版 { version:2, circuit, definitions } -> 原样（补全缺省字段）
 */
export function normalizeProject(data: unknown): NormalizeResult {
  if (!data || typeof data !== 'object') {
    return {
      project: { version: PROJECT_VERSION, circuit: { components: [], wires: [] }, definitions: [] },
      legacy: false,
      error: '文件不是合法的 JSON 对象'
    };
  }

  const obj = data as Record<string, unknown>;

  // 新版工程
  if (isCircuitLike(obj.circuit)) {
    const definitions = Array.isArray(obj.definitions)
      ? (obj.definitions as DeviceDefinition[])
      : [];
    return {
      project: {
        version: PROJECT_VERSION,
        circuit: obj.circuit as Circuit,
        definitions
      },
      legacy: false
    };
  }

  // 旧版扁平电路
  if (isCircuitLike(obj)) {
    return {
      project: {
        version: PROJECT_VERSION,
        circuit: obj as Circuit,
        definitions: []
      },
      legacy: true
    };
  }

  return {
    project: { version: PROJECT_VERSION, circuit: { components: [], wires: [] }, definitions: [] },
    legacy: false,
    error: '文件格式不正确：缺少 components/wires（旧版）或 circuit（新版工程）'
  };
}

/** 序列化为保存到磁盘的新版工程 JSON 文本 */
export function serializeProject(project: Project): string {
  return JSON.stringify({
    version: PROJECT_VERSION,
    circuit: project.circuit,
    definitions: project.definitions ?? []
  });
}

/** 构造空工程 */
export function emptyProject(): Project {
  return {
    version: PROJECT_VERSION,
    circuit: { components: [], wires: [] },
    definitions: []
  };
}
