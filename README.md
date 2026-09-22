# LogicLab · 组合逻辑电路实验台

面向《计算机组成原理》"组合逻辑" 一章的浏览器教学工具：在网格画布上拖拽搭
建与/或/非/与非/或非/异或/同或门、输入开关和输出指示灯，信号沿连线实时变
色；还能**把一坨搭好的电路圈选、封装成带命名管脚的自定义器件**，之后像普
通门一样反复拖放使用，自定义器件里可以再嵌套自定义器件（分层积木）。同一套
**跨层递归求值内核**同时支撑实时求值（层内拓扑传播 + 反馈环检测 + 定义间循
环引用检测）、真值表穷举与 CSV 导出、SOP 布尔表达式提取、2~4 变量卡诺图化
简、教学关卡的真实求值判定——含自定义器件实例的电路在这些分析中与扁平电
路完全等价。

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

核心算法全部在后端，配有独立测试（Vitest，74 个用例）：

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
| **单实例对外管脚值 == 外部输入灌入内部电路的内部输出；多输出管脚逐端口取值** | `test/hierarchy.test.ts` |
| **多层（2~4 层）嵌套实例逐层递归求值正确；同一定义多实例互不影响** | `test/hierarchy.test.ts` |
| **定义之间直接 / 间接 / 自引用循环在求值前被检测拒绝（不爆栈）** | `test/hierarchy.test.ts` |
| **反馈环藏在定义内部仍被检测并定位到具体定义层；改定义后全部实例随之更新** | `test/hierarchy.test.ts` |
| **含实例电路的真值表 / SOP / 卡诺图 / 关卡判定逐行正确** | `test/hierarchy.test.ts` |
| **旧版纯扁平文件读入行为与升级前一致；v2 工程 JSON 往返** | `test/hierarchy.test.ts` |
| 真值表逐行正确、多输出、>10 变量警告、>20 变量拒绝、CSV 导出 | `test/truthTable.test.ts` |
| SOP 规范式/最简式/Σm 与真值表一致、恒 0/恒 1 | `test/expression.test.ts` |
| 2/3/4 变量卡诺图 Gray 布局、角/行/列环面合并分组、最简式、5 变量拒绝 | `test/karnaugh.test.ts` |
| 关卡判定基于真实求值（结构相似但功能错误的电路**不能**蒙混过关） | `test/levels.test.ts` |

## 操作说明

- **放置元件**：从左侧器件库拖到画布，或点击按钮自动放置。
- **框选 / 封装**：`Shift`+空白处拖出矩形圈选元件（`Shift`+单击可追加/取消单个），
  点顶部 **📦 封装成器件**（或 `Ctrl/⌘+G`），指定器件名与各输入/输出管脚名，
  选中的电路即收进一个黑盒，左侧器件库出现该器件；可反复拖放、可在别的自定义
  器件内部再使用它。跨边界连线封装时会断开（对话框提示根数），用对外管脚重接。
- **钻入 / 返回**：**双击**自定义器件方块（或器件库「管理 → 钻入编辑」）进入其
  内部电路查看修改，顶部面包屑可跳回任意层；改的是**共享定义**，返回后引用它的
  全部实例立即按新定义求值，而不是各改各的副本。
- **移动 / 删除**：拖动元件（自动网格吸附）；选中后按 `Delete`/`Backspace`
  （删除实例只移除实例，器件定义保留；定义可在「管理」里删除，仍被引用时禁止）。
- **连线**：在元件**输出端口**（右侧圆点，自定义器件可有多个）按下，拖到另一
  元件的**输入端口**（左侧圆点）上松手。输出→输出、输入→输入、同一输入口重复
  驱动都不会连上；鼠标落歪松手即取消。
- **输入开关**：单击在 0/1 之间切换。
- **缩放 / 平移**：滚轮缩放（以光标为中心），空白处按住拖动平移；`Esc` 清除选择/返回上层。
- **撤销 / 重做**：顶部按钮或 `Ctrl/⌘+Z`、`Ctrl/⌘+Shift+Z`（保留最近 100 步）。
- **保存 / 读取**：顶部"保存"下载工程 JSON（含全部器件定义），"读取"恢复
  （**旧版纯扁平电路文件照常打开，行为不变**；刷新页面也会自动暂存）。
- **线色**：绿色=信号 1，灰蓝=信号 0，灰色虚线=未确定（上游有输入端口/管脚悬空）。
- 出现层内反馈环时，顶部红条给出环上元件路径并标出所在器件；定义之间循环引用
  时红条点名整条定义环（如 甲 → 乙 → 甲）。

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
      types.ts        # 电路/工程领域模型（Circuit、CUSTOM 元件、DeviceDefinition、Project）
      gates.ts        # 七种门的真值语义
      graph.ts        # 结构校验 + 依赖图（端口/方向/多重驱动/实例管脚与定义一致）
      definitions.ts  # ★ 工程归一化(旧文件兼容) + 定义校验 + 跨层循环引用 DFS 检测
      evaluate.ts     # ★ 每层 Kahn 拓扑传播 + CUSTOM 实例跨层递归求值(带记忆化) + DFS 反馈环检测
      truthTable.ts   # ★ 2^n 穷举 + CSV（定义随求值透传）
      minimizer.ts    # ★ Quine–McCluskey 质蕴含项 + 最小覆盖
      expression.ts   # ★ SOP（规范式/最简式/Σm）提取
      karnaugh.ts     # ★ 2~4 变量 Gray 布局与环面分组
      levels.ts       # ★ 教学关卡 + 真实求值判定
    server.ts         # HTTP/JSON API + 前端静态文件托管
  test/               # Vitest 自动化测试（74 例，含 hierarchy.test.ts 分层专项）
frontend/
  src/
    lib/
      types.ts        # 与后端对应的类型
      api.ts          # 接口封装（前端不含任何求值/化简算法）
      geometry.ts     # 端口坐标（含自定义方块多管脚）、曼哈顿路由、命中/框选
      editor.ts       # 分层工程状态：当前层/钻入路径/多选/封装/100 步撤销重做
      project.ts      # v1 裸电路 -> v2 工程归一化、封装选区分类
    components/
      Canvas.tsx      # 画布：缩放/平移/拖放/拉线/框选/双击钻入/实时信号着色
      GateSymbols.tsx # 门、开关、指示灯与自定义器件方块 SVG
      Toolbar.tsx     # 内置门 + 输入输出 + 自定义器件库
      PackageDialog.tsx       # 圈选封装对话框（命名器件与管脚、排序管脚）
      DefinitionsManager.tsx  # 器件定义管理（钻入/重命名/删除未引用定义）
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
| POST | `/api/evaluate` | 实时求值：跨层拓扑传播结果 / 层内环或定义循环引用错误 |
| POST | `/api/truth-table` | 真值表穷举（`format:"csv"` 直接返回 CSV） |
| POST | `/api/expressions` | 每个输出的 Σm、规范 SOP、最简 SOP |
| POST | `/api/karnaugh` | 2~4 变量卡诺图（网格 + 分组 + 最简式） |
| GET | `/api/levels` | 关卡与目标真值表 |
| POST | `/api/levels/verify` | 逐行真实求值判定 |

除 `health`/`levels` 外，POST 请求体均可带 `definitions: DeviceDefinition[]`；
顶层电路里的 `CUSTOM` 元件靠 `definitionId` 引用其中一份定义。不带 `definitions`
的旧裸电路请求行为与升级前完全一致。

## 设计要点

- **单一求值内核**：实时显示、真值表、表达式、卡诺图、关卡全部走同一个
  `evaluate(circuit, inputValues, definitions)`。自定义器件实例在所在层是黑盒，
  外层按拓扑序排到它时，把驱动在各输入管脚上的信号灌入它引用定义的内部电路
  （内部 INPUT 得到管脚值），在内部再跑一遍同样的拓扑求值，内部 OUTPUT 的值
  回填为实例输出管脚；嵌套随拓扑递归。"定义 × 输入组合"带记忆化，多个相同
  实例不重复展开。分析能力因此天然对含实例电路成立：逐行灌输入、跨层算到底、
  读输出即可。
- **跨层循环引用**：每层内部无环不代表展开后无环（甲定义用乙、乙定义用甲就是
  死递归）。`definitions.ts` 在求值前扫描"定义引用图"（定义内部 CUSTOM 实例 →
  其引用定义），用 DFS 三色标记找出具体定义环（支持直接环、间接环、自引用）并
  拒绝整个工程，绝不靠运行时爆栈来暴露问题。
- **层内反馈环**：各层（含每份定义内部）独立做 Kahn 拓扑，无法入列的剩余子图即
  反馈子图，再用 DFS 找首尾闭合路径；错误带 `layer` 指出环在哪张电路。检测到
  环时不输出任何可能误导的电平。
- **悬空跨层传播**：未连线的实例输入管脚把 `null` 显式注入内部对应 INPUT（而不
  是落回开关自带的 0），任何门遇 `null` 输出 `null`，前端虚线表达"未确定"。
- **共享定义语义**：工程里一份定义、多处实例引用；钻入修改定义后所有实例立即
  生效。工程文件为 v2 `{ version:2, circuit, definitions }`；旧版裸
  `{components,wires}` 由 `normalizeProject` 归一成 definitions 为空的 v2，
  读入与求值结果与升级前一致。
- **化简**：Quine–McCluskey 合并出质蕴含项，本质质蕴含项先取，剩余覆盖用
  小规模穷举求文字数最少、字典序稳定的解；卡诺图与表达式共用该内核，
  结果必然一致。
