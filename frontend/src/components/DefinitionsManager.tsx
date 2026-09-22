/** 器件定义管理：查看嵌套关系、重命名、钻入编辑、删除（无实例引用时）。 */

import type { DeviceDefinition, Project } from '../lib/types';
import type { EditorAction } from '../lib/editor';

export function DefinitionsManager({
  project,
  onClose,
  dispatch
}: {
  project: Project;
  onClose: () => void;
  dispatch: (a: EditorAction) => void;
}) {
  const used = new Set<string>();
  const collect = (comps: Project['circuit']['components']) => {
    for (const c of comps) if (c.type === 'CUSTOM' && c.definitionId) used.add(c.definitionId);
  };
  collect(project.circuit.components);
  project.definitions.forEach((d) => collect(d.circuit.components));

  /** 定义引用了哪些其它定义（嵌套子器件） */
  const childrenOf = (d: DeviceDefinition): string[] => {
    const ids = new Set<string>();
    for (const c of d.circuit.components) {
      if (c.type === 'CUSTOM' && c.definitionId) ids.add(c.definitionId);
    }
    return [...ids];
  };

  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div className="modal defs-dialog" onPointerDown={(e) => e.stopPropagation()}>
        <h3>自定义器件管理（{project.definitions.length}）</h3>
        {project.definitions.length === 0 ? (
          <p className="muted">
            还没有自定义器件。在画布上框选电路后点「封装成器件」即可创建。
          </p>
        ) : (
          <ul className="defs-list">
            {project.definitions.map((d) => {
              const children = childrenOf(d);
              const inUse = used.has(d.id);
              return (
                <li key={d.id} className="defs-item">
                  <div className="defs-main">
                    <strong>{d.name}</strong>
                    <span className="muted">
                      {' '}{d.inputs.length} 入 / {d.outputs.length} 出
                      {children.length > 0 && ` · 内含：${children.map((id) => project.definitions.find((x) => x.id === id)?.name ?? id).join('、')}`}
                    </span>
                  </div>
                  <div className="defs-actions">
                    <button
                      className="ghost-btn"
                      onClick={() => {
                        dispatch({ type: 'drill-jump', path: [d.id] });
                        onClose();
                      }}
                    >
                      钻入编辑
                    </button>
                    <button
                      className="ghost-btn"
                      onClick={() => {
                        const next = prompt('重命名器件：', d.name);
                        if (next && next.trim() && next.trim() !== d.name) {
                          dispatch({ type: 'rename-definition', definitionId: d.id, name: next });
                        }
                      }}
                    >
                      重命名
                    </button>
                    <button
                      className="danger-btn"
                      disabled={inUse}
                      title={inUse ? '仍有实例引用该器件，不能删除' : '删除该器件定义'}
                      onClick={() => {
                        if (confirm(`删除器件「${d.name}」？此操作可撤销。`)) {
                          dispatch({ type: 'delete-definition', definitionId: d.id });
                        }
                      }}
                    >
                      删除
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="modal-actions">
          <button className="primary-btn" onClick={onClose}>完成</button>
        </div>
      </div>
    </div>
  );
}
