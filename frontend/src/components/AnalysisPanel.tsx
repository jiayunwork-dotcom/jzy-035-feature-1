/** 右侧"分析"面板：选择输入/输出 -> 真值表（可导出 CSV）与 SOP 表达式。 */

import { useState } from 'react';
import {
  downloadTruthTableCsv,
  fetchExpressions,
  fetchTruthTable
} from '../lib/api';
import type {
  CircuitComponent,
  DeviceDefinition,
  ExpressionOk,
  GenericErr,
  TruthTableOk
} from '../lib/types';

interface Props {
  components: CircuitComponent[];
  circuit: { components: CircuitComponent[]; wires: import('../lib/types').Wire[] };
  definitions?: DeviceDefinition[];
}

export function AnalysisPanel({ components, circuit, definitions }: Props) {
  const inputs = components.filter((c) => c.type === 'INPUT');
  const outputs = components.filter((c) => c.type === 'OUTPUT');

  const [chosenInputs, setChosenInputs] = useState<string[]>([]);
  const [chosenOutputs, setChosenOutputs] = useState<string[]>([]);
  const [tt, setTt] = useState<TruthTableOk | null>(null);
  const [expr, setExpr] = useState<ExpressionOk | null>(null);
  const [lastQuery, setLastQuery] = useState<{ inputIds: string[]; outputIds: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (
    list: string[],
    setList: (v: string[]) => void,
    id: string
  ) => {
    setTt(null);
    setExpr(null);
    setError(null);
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  const selectAll = () => {
    setChosenInputs(inputs.map((c) => c.id));
    setChosenOutputs(outputs.map((c) => c.id));
    setTt(null);
    setExpr(null);
    setError(null);
  };

  const run = async () => {
    if (chosenInputs.length === 0 || chosenOutputs.length === 0) {
      setError('请先勾选至少一个输入开关和一个输出指示灯。');
      return;
    }
    if (chosenInputs.length > 20) {
      setError('输入变量不能超过 20 个。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // 按画面 x 坐标排序，变量顺序稳定
      const orderIds = (ids: string[]) =>
        ids
          .map((id) => components.find((c) => c.id === id)!)
          .sort((a, b) => a.x - b.x || a.y - b.y)
          .map((c) => c.id);
      const inputIds = orderIds(chosenInputs);
      const outputIds = orderIds(chosenOutputs);

      const ttResult = await fetchTruthTable(circuit, inputIds, outputIds, definitions);
      if (!ttResult.ok) {
        const e = ttResult as GenericErr;
        setError(e.message + (e.cyclePath ? '（已在图上标出环上元件）' : ''));
        setTt(null);
        return;
      }
      setTt(ttResult);
      setLastQuery({ inputIds, outputIds });

      const exprResult = await fetchExpressions(circuit, inputIds, outputIds, definitions);
      if (exprResult.ok) setExpr(exprResult);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <h3>真值表 & 布尔表达式</h3>

      <div className="selector">
        <div className="selector-title">
          输入开关（{inputs.length}）
          <button className="link-btn" onClick={selectAll}>
            全选
          </button>
        </div>
        <div className="chips">
          {inputs.length === 0 && <span className="muted">画布上还没有输入开关</span>}
          {inputs.map((c) => (
            <Chip
              key={c.id}
              label={c.label || c.id.slice(-4)}
              active={chosenInputs.includes(c.id)}
              onClick={() => toggle(chosenInputs, setChosenInputs, c.id)}
            />
          ))}
        </div>
      </div>

      <div className="selector">
        <div className="selector-title">输出指示灯（{outputs.length}）</div>
        <div className="chips">
          {outputs.length === 0 && <span className="muted">画布上还没有输出指示灯</span>}
          {outputs.map((c) => (
            <Chip
              key={c.id}
              label={c.label || c.id.slice(-4)}
              active={chosenOutputs.includes(c.id)}
              onClick={() => toggle(chosenOutputs, setChosenOutputs, c.id)}
            />
          ))}
        </div>
      </div>

      <div className="row">
        <button className="primary-btn" disabled={busy} onClick={run}>
          {busy ? '计算中…' : '生成真值表并化简'}
        </button>
        {tt && lastQuery && (
          <button
            className="ghost-btn"
            onClick={() =>
              downloadTruthTableCsv(circuit, lastQuery.inputIds, lastQuery.outputIds, definitions)
            }
          >
            导出 CSV
          </button>
        )}
      </div>

      {tt?.warning && <div className="warning">{tt.warning}</div>}
      {error && <div className="error">{error}</div>}

      {tt && (
        <>
          <div className="table-wrap">
            <table className="truth-table">
              <thead>
                <tr>
                  {tt.variables.map((v) => (
                    <th key={`i-${v}`}>{v}</th>
                  ))}
                  <th className="sep" />
                  {tt.outputNames.map((n) => (
                    <th key={`o-${n}`} className="out-col">
                      {n}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tt.rows.map((r) => (
                  <tr key={r.minterm}>
                    {r.inputs.map((b, i) => (
                      <td key={i}>{b}</td>
                    ))}
                    <td className="sep" />
                    {r.outputs.map((s, i) => (
                      <td
                        key={i}
                        className={s === 1 ? 'one out-col' : s === null ? 'unk out-col' : 'out-col'}
                      >
                        {s === null ? '×' : s}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {expr && (
            <div className="expr-block">
              <h4>积之和（SOP）表达式</h4>
              {expr.expressions.map((e) => (
                <div key={e.outputId} className="expr-item">
                  <div className="expr-head">
                    <span className="expr-name">{e.outputName}</span>
                    <code className="sigma">{e.sigma}</code>
                  </div>
                  <div className="expr-line">
                    <span className="expr-tag">规范式</span>
                    <code>{e.canonical}</code>
                  </div>
                  <div className="expr-line minimal">
                    <span className="expr-tag">最简式</span>
                    <code>{e.minimal}</code>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button className={`chip ${active ? 'active' : ''}`} onClick={onClick}>
      {label}
    </button>
  );
}
