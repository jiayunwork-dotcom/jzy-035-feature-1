# LogicLab · 分层组合逻辑电路实验台

面向《计算机组成原理》"组合逻辑" 一章的浏览器教学工具：在网格画布上拖拽搭
建与/或/非/与非/或非/异或/同或门、输入开关和输出指示灯，信号沿连线实时变
色；同一套后端求值内核同时支撑**实时求值（拓扑传播 + 反馈环检测）、真值表
穷举与 CSV 导出、SOP 布尔表达式提取、2~4 变量卡诺图化简、教学关卡的真
实求值判定**。

支持**分层搭积木**：在画布上圈选一坨搭好的电路（含其中的输入开关/输出灯）
即可封装成带命名管脚的自定义器件，之后像普通门一样从左侧器件库反复拖出
实例；实例在画布上只显示为带名字和管脚的方块，双击可钻入内部修改；自定义
器件内部还能再嵌套自定义器件。后端求值器跨层递归传播，定义之间的循环引用
在求值前就被检出拒绝。

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

核心算法全部在后端，配有独立测试（Vitest，84 个用例）：

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
| **单实例对外管脚 = 外部输入灌进内部电路求得的内部输出；多实例互不影响** | `test/hierarchy.test.ts` |
| **多层嵌套实例（器件里再放器件）逐行求值正确；多输出管脚正确；悬空管脚 null 跨层传播** | `test/hierarchy.test.ts` |
| **定义间直接自引用 / 甲乙互引 / 三环互引在求值前被检出拒绝（不靠爆栈）** | `test/hierarchy.test.ts` |
| **层内反馈环（含穿过实例的回绕、定义内部的环）继续被检测** | `test/hierarchy.test.ts` |
| **修改定义后其全部实例的求值随之改变（定义共享，不是各改各的）** | `test/hierarchy.test.ts` |
| **含实例电路的真值表/最简 SOP/卡诺图逐行正确；用自定义器件过关、功能错误不能蒙混** | `test/hierarchyAnalysis.test.ts` |
| **旧的纯扁平文件（无 definitions/实例）读入后求值、分析、判定与升级前完全一致** | `test/legacyCompatibility.test.ts` |

## 操作说明

- **放置元件**：从左侧工具栏拖到画布，或点击工具栏按钮自动放置。
- **移动 / 删除**：拖动元件（自动网格吸附）；点击选中后按 `Delete`/`Backspace`。
- **圈选**：按住 `Shift` 在空白处拖框可一次选中多个元件（`Shift`+点元件增减选择）。
- **封装为自定义器件**：圈选一坨电路后点顶部「📦 封装为器件」，命名器件与对外
  管脚（选区内的输入开关/输出灯即管脚），新器件随即出现在左侧库中。
- **使用自定义器件**：从左侧「自定义器件」库拖到画布，或点击自动放置；实例
  只显示为带名字和管脚的方块，像普通门一样接线（输出口只能接输入口）。
- **钻入 / 修改定义**：双击实例方块（或库里的「钻入」）进入其内部电路查看
  修改；面包屑或 `Esc` 返回顶层。**改的是定义本身，画布上所有引用它的实例
  下次求值全部随之更新。**
- **嵌套**：自定义器件内部还能放别的自定义器件实例，层级不限（异常深引用有
  上限保护）；定义之间若形成循环引用会被明确拒绝。
- **连线**：在元件**输出端口**（右侧圆点，实例可有多个）按下，拖到另一元件
  的**输入端口**上松手。输出→输出、输入→输入、同一输入口重复驱动都不会连上。
- **输入开关**：单击在 0/1 之间切换。
- **缩放 / 平移**：滚轮缩放（以光标为中心），空白处按住拖动平移。
- **撤销 / 重做**：顶部按钮或 `Ctrl/⌘+Z`、`Ctrl/⌘+Shift+Z`（保留最近 100 步，
  顶层与定义内部的编辑共用同一条历史）。
- **保存 / 读取**：顶部"保存"下载**工程 JSON（version 2，含器件定义库）**，
  "读取"恢复；**旧版纯扁平文件也照常可读**（刷新页面也会自动暂存/迁移）。
- **线色**：绿色=信号 1，灰蓝=信号 0，灰色虚线=未确定（上游有输入端口悬空）。
- 出现反馈环时顶部红条给出环上元件路径，环上元件红框高亮；器件定义间出现
  跨层循环引用时红条给出"甲 → 乙 → 甲"形式的器件名路径。

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
      types.ts        # 电路/器件定义/工程领域模型（前后端共享结构）
      gates.ts        # 七种门的真值语义
      graph.ts        # 结构校验 + 依赖图（端口/方向/多重驱动；SUB 端口数取自定义）
      evaluate.ts     # ★ 单表 Kahn 拓扑传播 + DFS 反馈环检测（实例黑盒回调）
      hierarchy.ts    # ★ 定义库校验、定义引用图跨层环检测、跨层递归求值引擎
      serialization.ts# ★ 新旧工程文件归一化（旧扁平 {components,wires} 照常读）
      truthTable.ts   # ★ 2^n 穷举 + CSV（走分层引擎）
      minimizer.ts    # ★ Quine–McCluskey 质蕴含项 + 最小覆盖
      expression.ts   # ★ SOP（规范式/最简式/Σm）提取
      karnaugh.ts     # ★ 2~4 变量 Gray 布局与环面分组
      levels.ts       # ★ 教学关卡 + 真实求值判定（含实例电路）
    server.ts         # HTTP/JSON API + 前端静态文件托管
  test/               # Vitest 自动化测试（84 例）
frontend/
  src/
    lib/
      types.ts        # 与后端对应的类型
      api.ts          # 接口封装（前端不含任何求值/化简算法）
      geometry.ts     # 端口坐标（含实例多管脚方块）、曼哈顿路由、命中、框选
      editor.ts       # 工程状态（顶层+定义库+钻入视图）+ 100 步撤销/重做
      packaging.ts    # 圈选 -> 深拷贝重映射 -> DeviceDefinition
    components/
      Canvas.tsx      # 画布：缩放/平移/拖放/拉线/Shift 框选/实例/双击钻入/信号着色
      GateSymbols.tsx # 门、开关、灯与自定义器件实例方块 SVG
      Toolbar.tsx     # 内置门 + 自定义器件库
      PackageDialog.tsx # 封装命名/管脚对话框
      AnalysisPanel.tsx   # 真值表 + 表达式
      KarnaughPanel.tsx   # 卡诺图
      LevelsPanel.tsx     # 关卡
      PropertyPanel.tsx  # 属性
    App.tsx
```

## HTTP API

除 GET 接口外，请求体均为 `{ circuit, definitions, ... }`：`circuit` 是当前
求值的那一层（实时求值时为顶层或正在查看的定义内部），`definitions` 是整份
工程的器件定义库。不带 `definitions` 即旧版扁平电路，行为与升级前一致。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| POST | `/api/evaluate` | 实时跨层求值：拓扑传播结果 / 层内环 / 跨层循环引用错误 |
| POST | `/api/truth-table` | 真值表穷举（`format:"csv"` 直接返回 CSV） |
| POST | `/api/expressions` | 每个输出的 Σm、规范 SOP、最简 SOP |
| POST | `/api/karnaugh` | 2~4 变量卡诺图（网格 + 分组 + 最简式） |
| GET | `/api/levels` | 关卡与目标真值表 |
| POST | `/api/levels/verify` | 逐行真实求值判定（自定义器件电路同样参与） |
| POST | `/api/project/normalize` | 识别新旧工程文件并归一化为 version 2 |

## 设计要点

- **求值正确性**：所有功能（实时显示、真值表、表达式、卡诺图、关卡）走的
  都是同一套拓扑传播内核，前端只负责交互和展示。
- **分层求值**：`evaluate.ts` 只对一张表做 Kahn 拓扑传播，把 SUB 实例当黑盒
  回调；`hierarchy.ts` 的递归引擎把外部管脚信号绑定到定义内部的输入开关、
  在内部再跑一遍完整求值（内部继续嵌套就继续递归），取回内部输出灯的值回填
  实例输出管脚。扁平求值与跨层求值共用同一个单层内核，旧行为零改动。
- **两类环分开治**：层内反馈环仍由 Kahn 剩余子图 + DFS 找具体路径；跨层
  循环引用（甲定义用乙、乙定义又用甲）在**任何求值之前**先在"定义引用图"
  上做一次 DFS 三色标记，检出即报 `definition-cycle`（带器件名闭合路径），
  递归引擎里另有活动栈与深度兜底，绝不靠递归爆栈来发现问题。
- **定义即单一事实来源**：实例只存 `deviceId` 和位置，不存内部副本；改定义
  后所有实例下次求值自然更新。同一输入的实例结果在单次求值内缓存。
- **环检测**：Kahn 算法无法入列的剩余子图即反馈子图；再用 DFS 找出一条
  首尾闭合的具体路径返回。检测到环时不输出任何可能误导的电平。
- **悬空传播**：未被驱动的输入端口为三值中的 `null`，沿门和实例边界传播
  （任何门遇到 `null` 输出 `null`，实例悬空管脚强制内部输入为未确定），
  前端用虚线表达"未确定"。
- **旧工程兼容**：旧文件 `{components,wires}` 经 `serialization.ts` 归一化为
  `{version:2, circuit, definitions:[]}`，扁平路径求值、分析、判定完全照旧。
- **化简**：Quine–McCluskey 合并出质蕴含项，本质质蕴含项先取，剩余覆盖用
  小规模穷举求文字数最少、字典序稳定的解；卡诺图与表达式共用该内核，
  结果必然一致。
