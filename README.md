# LogicLab · 组合逻辑电路实验台

面向《计算机组成原理》"组合逻辑" 一章的浏览器教学工具：在网格画布上拖拽搭
建与/或/非/与非/或非/异或/同或门、输入开关和输出指示灯，信号沿连线实时变
色；同一套后端求值内核同时支撑**实时求值（拓扑传播 + 反馈环检测）、真值表
穷举与 CSV 导出、SOP 布尔表达式提取、2~4 变量卡诺图化简、教学关卡的真
实求值判定**。

- 前端：React 18 + TypeScript + Vite（SVG 画布，零 UI 框架依赖）
- 后端：Node.js 20 + TypeScript，只用 Node 内置 `http`，无第三方运行时依赖
- 交互：HTTP/JSON
- 部署：`node:20-alpine` 多阶段构建，**单容器**在 8080 同时提供 API 与前端静态文件

---

## 一键启动（Docker）

```bash
docker compose up --build
# 打开 http://localhost:8080
```

或不用 compose：

```bash
docker build -t logiclab .
docker run --rm -p 8080:8080 logiclab
```

## 本地开发（两个进程，带热更新）

```bash
# 终端 1：后端（http://localhost:8080）
cd backend
npm install
npm run dev          # tsx watch

# 终端 2：前端（http://localhost:5173，/api 已代理到 8080）
cd frontend
npm install
npm run dev
```

生产模式本地运行：

```bash
(cd backend && npm run build)
(cd frontend && npm run build)
node backend/dist/src/server.js     # http://localhost:8080
```

## 自动化测试

核心算法全部在后端，配有独立测试（Vitest，50 个用例）：

```bash
cd backend
npm test
```

覆盖：

| 关键行为 | 测试文件 |
| --- | --- |
| 各类门（AND/OR/NOT/NAND/NOR/XOR/XNOR、多输入、悬空传播）真值正确 | `test/gates.test.ts` |
| 多级电路按拓扑顺序一级级传播、扇出、线值、拓扑顺序 | `test/evaluate.test.ts` |
| 反馈环（自环 / 锁存器式环 / 多级环）被检测并拒绝，返回具体环路径，不死循环 | `test/evaluate.test.ts` |
| 非法接线（输出→输出、多重驱动等）结构校验 | `test/evaluate.test.ts` |
| 真值表逐行正确、多输出、>10 变量警告、>20 变量拒绝、CSV 导出 | `test/truthTable.test.ts` |
| SOP 规范式/最简式/Σm 与真值表一致、恒 0/恒 1 | `test/expression.test.ts` |
| 2/3/4 变量卡诺图 Gray 布局、角/行/列环面合并分组、最简式、5 变量拒绝 | `test/karnaugh.test.ts` |
| 关卡判定基于真实求值（结构相似但功能错误的电路**不能**蒙混过关） | `test/levels.test.ts` |

## 操作说明

- **放置元件**：从左侧工具栏拖到画布，或点击工具栏按钮自动放置。
- **移动 / 删除**：拖动元件（自动网格吸附）；点击选中后按 `Delete`/`Backspace`。
- **连线**：在元件**输出端口**（右侧圆点）按下，拖到另一元件的**输入端口**
  （左侧圆点）上松手。输出→输出、输入→输入、同一输入口重复驱动都不会连上；
  鼠标落歪松手即取消。
- **输入开关**：单击在 0/1 之间切换。
- **缩放 / 平移**：滚轮缩放（以光标为中心），空白处按住拖动平移。
- **撤销 / 重做**：顶部按钮或 `Ctrl/⌘+Z`、`Ctrl/⌘+Shift+Z`（保留最近 100 步）。
- **保存 / 读取**：顶部"保存"下载电路 JSON，"读取"恢复（刷新页面也会自动暂存）。
- **线色**：绿色=信号 1，灰蓝=信号 0，灰色虚线=未确定（上游有输入端口悬空）。
- 出现反馈环时，顶部红条给出环上元件路径，环上元件红框高亮。

## 右侧分析页

1. **真值表/表达式**：勾选输入开关与输出灯 → 穷举全部 2^n 行（>1024 行会
   给出规模警告但仍生成，>20 个变量为保护服务直接拒绝）；可导出 CSV；
   每个输出生成 Σm、规范 SOP 与 QM 化简后的最简 SOP。
2. **卡诺图**：选 2~4 个输入与 1 个输出，Gray 码网格 + 彩色质蕴含项分组
   （支持四边环绕），给出最简表达式。超过 4 变量会说明为什么图解法失效。
3. **关卡**：按目标真值表搭电路后点"验证"，后端用同一求值内核逐行判定。

## 代码结构

```
backend/
  src/
    core/
      types.ts        # 电路领域模型（前后端共享结构）
      gates.ts        # 七种门的真值语义
      graph.ts        # 结构校验 + 依赖图（端口/方向/多重驱动）
      evaluate.ts     # ★ Kahn 拓扑排序传播 + DFS 反馈环检测
      truthTable.ts   # ★ 2^n 穷举 + CSV
      minimizer.ts    # ★ Quine–McCluskey 质蕴含项 + 最小覆盖
      expression.ts   # ★ SOP（规范式/最简式/Σm）提取
      karnaugh.ts     # ★ 2~4 变量 Gray 布局与环面分组
      levels.ts       # ★ 教学关卡 + 真实求值判定
    server.ts         # HTTP/JSON API + 前端静态文件托管
  test/               # Vitest 自动化测试（50 例）
frontend/
  src/
    lib/
      types.ts        # 与后端对应的类型
      api.ts          # 接口封装（前端不含任何求值/化简算法）
      geometry.ts     # 端口坐标、曼哈顿路由、命中测试
      editor.ts       # 电路状态 + 100 步撤销/重做
    components/
      Canvas.tsx      # 画布：缩放/平移/拖放/拉线/选择/实时信号着色
      GateSymbols.tsx # 门与开关、指示灯 SVG
      Toolbar.tsx
      AnalysisPanel.tsx   # 真值表 + 表达式
      KarnaughPanel.tsx   # 卡诺图
      LevelsPanel.tsx     # 关卡
      PropertyPanel.tsx
    App.tsx
```

## HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| POST | `/api/evaluate` | 实时求值：拓扑传播结果 / 环错误（含环路径） |
| POST | `/api/truth-table` | 真值表穷举（`format:"csv"` 直接返回 CSV） |
| POST | `/api/expressions` | 每个输出的 Σm、规范 SOP、最简 SOP |
| POST | `/api/karnaugh` | 2~4 变量卡诺图（网格 + 分组 + 最简式） |
| GET | `/api/levels` | 关卡与目标真值表 |
| POST | `/api/levels/verify` | 逐行真实求值判定 |

## 设计要点

- **求值正确性**：所有功能（实时显示、真值表、表达式、卡诺图、关卡）走的
  都是 `evaluate()` 同一个拓扑传播内核，前端只负责交互和展示。
- **环检测**：Kahn 算法无法入列的剩余子图即反馈子图；再用 DFS 找出一条
  首尾闭合的具体路径返回。检测到环时不输出任何可能误导的电平。
- **悬空传播**：未被驱动的输入端口为三值中的 `null`，沿门传播（任何门遇到
  `null` 输出 `null`），前端用虚线表达"未确定"。
- **化简**：Quine–McCluskey 合并出质蕴含项，本质质蕴含项先取，剩余覆盖用
  小规模穷举求文字数最少、字典序稳定的解；卡诺图与表达式共用该内核，
  结果必然一致。
