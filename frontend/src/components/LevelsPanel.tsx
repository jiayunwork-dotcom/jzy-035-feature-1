/** 教学关卡面板：列出关卡与目标真值表，用后端真实求值判定通关。 */

import { useEffect, useState } from 'react';
import { fetchLevels, verifyLevel } from '../lib/api';
import type {
  Circuit,
  Level,
  LevelVerifyOk
} from '../lib/types';

export function LevelsPanel({ circuit }: { circuit: Circuit }) {
  const [levels, setLevels] = useState<Level[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [result, setResult] = useState<LevelVerifyOk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchLevels().then(setLevels).catch((e) => setError(String(e)));
  }, []);

  const active = levels.find((l) => l.id === activeId) ?? null;

  const verify = async () => {
    if (!active) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await verifyLevel(active.id, circuit);
      if (!r.ok) {
        setError(r.message);
      } else {
        setResult(r);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel levels-panel">
      <h3>教学关卡</h3>
      <p className="muted">
        判定方式：穷举你的电路在全部 2<sup>n</sup> 种输入下的输出，与目标真值表逐行比对
        ——结构再像，真值不对也不能过关。
      </p>

      <div className="level-list">
        {levels.map((l) => (
          <button
            key={l.id}
            className={`level-item ${activeId === l.id ? 'active' : ''}`}
            onClick={() => {
              setActiveId(l.id);
              setResult(null);
              setError(null);
            }}
          >
            {l.title}
          </button>
        ))}
      </div>

      {active && (
        <div className="level-detail">
          <p>{active.description}</p>
          <p className="hint">提示：{active.hint}</p>

          <div className="table-wrap small">
            <table className="truth-table">
              <thead>
                <tr>
                  {Array.from({ length: active.inputCount }, (_, i) => (
                    <th key={i}>{String.fromCharCode(65 + i)}</th>
                  ))}
                  <th className="sep" />
                  {active.outputNames.map((n) => (
                    <th key={n} className="out-col">{n}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {active.target.map((outs, m) => (
                  <tr key={m}>
                    {Array.from({ length: active.inputCount }, (_, i) => (
                      <td key={i}>{(m >> (active.inputCount - 1 - i)) & 1}</td>
                    ))}
                    <td className="sep" />
                    {outs.map((v, i) => (
                      <td key={i} className={v === 1 ? 'one out-col' : 'out-col'}>{v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button className="primary-btn" disabled={busy} onClick={verify}>
            {busy ? '验证中…' : '验证我的电路'}
          </button>

          {error && <div className="error">{error}</div>}
          {result && (
            <div className={`verify-result ${result.passed ? 'pass' : 'fail'}`}>
              <strong>{result.passed ? '🎉 通关！' : '还没通过'}</strong>
              <span>{result.message}</span>
              {!result.passed && (
                <div className="table-wrap small">
                  <table className="truth-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>期望</th>
                        <th>实际</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows
                        .filter((r) => !r.match)
                        .map((r) => (
                          <tr key={r.minterm} className="bad-row">
                            <td>m{r.minterm}</td>
                            <td>{r.expected.join('')}</td>
                            <td>{r.actual.map((a) => (a === null ? '×' : a)).join('')}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
