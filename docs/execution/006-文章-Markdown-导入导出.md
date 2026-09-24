# 文章 Markdown 导入 / 导出

- 文档编号：006
- 状态：草案（实施中）
- 创建日期：2026-09-23
- 适用范围：后台文章的 Markdown 上传（含解析预览）与导出
- 前置文档：001（基础架构）、002 / 003（编辑器）

## 一、目标

1. 上传 `.md` 文件，解析后**先预览**，确认无误再进入编辑器
2. 把已有文章导出为 `.md` 文件下载
3. 只支持 Markdown，不接受 `.docx` / `.html` 等其他格式

## 二、已确认的决策

| 决策项 | 结论 | 理由 |
| --- | --- | --- |
| 转换路径 | `MD ↔ HTML ↔ Tiptap JSON` | Tiptap 官方提供 `generateJSON`（HTML→JSON）与 `generateHTML`（JSON→HTML），两端都用成熟库。自己写 MD↔Tiptap 直转要手工处理全部节点类型，且与 `sharedExtensions` 的任何变动都会脱节 |
| 自定义节点导出 | 降级为标准 MD | 提示块→GFM 警告块（`> [!INFO]`，在不支持的渲染器里退化为普通引用）、折叠块→粗体标题 + 正文、任务清单→`- [ ]`。导出的文件要能被任意 MD 工具打开，这比无损往返更重要 |
| 导入落地方式 | 先预览，确认后入编辑器 | 导入会覆盖正文，误操作代价高；且 MD 里的自定义语法未必如期解析，先看一眼再决定 |
| frontmatter | 解析并填充表单 | `title` / `slug` / `excerpt` / `tags` / `category` 常见于导出自其他博客系统的文件，丢掉等于让用户重填 |
| 新增依赖 | `marked`、`turndown`、`turndown-plugin-gfm`、`@types/turndown` | 均为 MIT。MD 解析与 HTML→MD 逆转换都属于「规范复杂、边界极多」的场景，手写必然漏 case |

## 三、技术前提（已实测核实，非推测）

用临时探针脚本在本项目依赖下实跑，以下结论直接决定实现方式：

| 核实项 | 实测结果 | 影响 |
| --- | --- | --- |
| `generateJSON` 是否存在 | `@tiptap/html/server` 同时导出 `generateHTML` 与 `generateJSON` | 无需新增 Tiptap 相关依赖 |
| `generateJSON` 是否异步 | **同步**（返回对象，非 Promise）。官方 JSDoc 写的 `Promise<Record>` 与实际签名不一致 | 调用处不要 `await`，也不要按异步设计 |
| 六类节点解析 | 标题 / 段落 / 列表 / 代码块 / 引用 / 表格全部正确进入 JSON | 主干链路可行 |
| **h1 的处理** | `<h1>` 被**静默降级为 paragraph**，不是 h2 | ⚠️ MD 普遍用 `#` 写主标题，不处理会丢掉整个标题层级。必须在 HTML 阶段改写 |
| 标题整体位移 | 若把 h1~h6 统一下移一级，h4 会被挤成 paragraph | ⚠️ 不能用位移，必须用**钳制**：h1→h2、h2→h2、h3→h3、h4 及更深→h4 |
| 任务清单 | GFM 产出的 `<ul><li><input type=checkbox>` 被解析成**普通列表**，勾选状态丢失 | ⚠️ 必须补 `data-type="taskList"` / `data-type="taskItem"` / `data-checked`；补齐后实测可完整还原 `{type:"taskItem",attrs:{checked:true}}` |
| 图片 | 解析为独立的 `image` 节点（因扩展配置 `inline: false`），并在其前留一个空 paragraph | 符合预期，无需处理 |
| happy-dom | 未在 `package.json` 声明，是 `@tiptap/html` 的传递依赖，已存在于 pnpm store | 现有发布链路（`renderContentHtml`）已依赖它，不新增风险 |

## 四、范围

### 本次做

1. `lib/markdown/frontmatter.ts` — frontmatter 解析与生成（YAML 子集，不引 yaml 依赖）
2. `lib/markdown/to-html.ts` — MD → HTML（同构，含标题钳制与任务清单还原）
3. `lib/markdown/to-markdown.ts` — HTML → MD（含自定义节点降级与表格修复）
4. `lib/markdown/server.ts` — Tiptap JSON ↔ MD（服务端专用，依赖 happy-dom）
5. `lib/markdown/file.ts` — 文件约定常量（客户端只引这个，见下方偏离说明）
6. `lib/markdown/index.ts` — 同构 barrel
7. `server/actions/markdown.ts` — 导入解析的 Server Action（返回预览数据，不写库）
8. `app/api/posts/[id]/export/route.ts` — 导出下载端点
9. `app/(admin)/admin/posts/[id]/ImportMarkdownModal.tsx` — 上传 + 预览弹窗
10. 编辑器顶栏接入「导入 MD / 导出 MD」入口

### 与原计划的偏离（实施中发现，已记录原因）

| 原计划 | 实际 | 原因 |
| --- | --- | --- |
| `to-tiptap.ts` / `from-tiptap.ts` 两个模块 | 拆成 `to-html` / `to-markdown` / `server` 三层 | MD→HTML 这一段必须同构（客户端也要用），而 HTML→Tiptap JSON 依赖 happy-dom 只能在服务端。混在一个文件里会让客户端引用时把服务端依赖链拖进浏览器包，构建直接失败。拆分边界与既有的 `plain-text.ts` / `sanitize.ts` 一致 |
| 文件约定常量放在 `index.ts` | 单独成 `file.ts` | 客户端弹窗只需要三个常量，但从 barrel 引任何东西都会连带评估 marked（约 490KB）与 turndown（约 160KB），全部打进浏览器包 |
| `sanitize.ts` 导出 `sanitizeImportedHtml()` | 未新增，直接复用 `renderContentHtml()` | 导入链路本就要先过 `generateJSON` 再渲染回 HTML，这一步已经走了 `renderContentHtml` 的 sanitize。再加一个入口等于同一份白名单开两个口子 |
| 弹窗放 `components/editor/` | 放 `app/(admin)/admin/posts/[id]/` | 它耦合了文章编辑器的导入语义（套用 frontmatter 到表单字段），不是通用编辑器组件。与 `RevisionsModal` / `SettingsDrawer` 同级更合适 |

### 明确不做

| 项 | 原因 |
| --- | --- |
| 其他格式（docx / html / rtf） | 用户明确只要 MD |
| 批量导入多个文件 | 每篇文章的 slug / 分类 / SEO 都需人工确认，批量会让确认环节失去意义 |
| MD 里的远程图片自动下载转存 | 涉及外链抓取（SSRF 风险面）与失败重试，属独立功能 |
| 导入时自动发布 | 一律落草稿。导入内容未经 SEO 校验，直接发布会绕过既有发布门槛 |
| 无损往返（MD→编辑器→MD 完全一致） | MD 表达能力小于本编辑器，颜色/高亮/上下标没有对应语法，注定有损。见第七节 |

## 五、操作步骤

1. 装依赖：`marked` / `turndown` / `turndown-plugin-gfm` / `@types/turndown`
2. 写 `lib/markdown/` 三个模块
3. `lib/tiptap/sanitize.ts` 导出 `sanitizeImportedHtml()`，复用同一份白名单
4. 写 Server Action 与导出 Route Handler
5. 写导入弹窗组件，接入编辑器顶栏
6. 本文档记录

## 六、关键实现约束

**转换顺序不可调换**：`marked` → 标题钳制 + 任务清单修复 → sanitize → `generateJSON`。

sanitize 必须放在钳制之后：白名单里没有 `h1`（正文只开放 h2~h4），先 sanitize 会把 `<h1>标题</h1>` 削成裸文本，标题彻底丢失。

**导入内容按不可信处理**：`marked` 默认透传原始 HTML，`.md` 文件可能夹带 `<script>`。虽然 `generateJSON` 只认 schema 内的节点、且发布链路的 `renderContentHtml` 还会再 sanitize 一次，但仍在导入阶段先 sanitize——避免 `<script>` 的内容被当作普通文本混进正文。

**白名单只维护一份**：导入的 sanitize 复用 `lib/tiptap/sanitize.ts` 的 `sanitizeOptions`，不另写一套。两份白名单迟早会漂移。

## 七、已知的转换损失（需在 UI 中告知用户）

| 内容 | 导出为 MD 后 |
| --- | --- |
| 提示块 Callout | `> [!INFO]` 引用块（GitHub 显示为警告框，其他渲染器显示为普通引用） |
| 折叠块 Details | 摘要变粗体段落，内容平铺，失去折叠 |
| 文字颜色 / 背景高亮 | 丢失，仅保留文字 |
| 上标 / 下标 | 丢失，仅保留文字 |
| 表格列宽 | 丢失（GFM 表格不支持） |
| 文字对齐 | 丢失 |

导入方向的损失见第三节的三个 ⚠️ 项，均已在实现中处理。

## 八、潜在风险

| 风险 | 影响 | 处置 |
| --- | --- | --- |
| 恶意 `.md` 夹带脚本 | XSS | 导入阶段 sanitize + generateJSON 的 schema 过滤 + 发布阶段再 sanitize，三层 |
| 超大 `.md` 文件 | 服务端内存与解析耗时 | 限制 2MB（纯文本 2MB 约合 60 万字，远超正常文章） |
| 导入覆盖正文 | 内容丢失 | 预览确认 + 覆盖前二次确认；编辑器本身有 localStorage 草稿兜底 |
| frontmatter 字段名不统一 | 解析不到 | 只认文档化的字段名，认不到就留空让用户填，不做模糊猜测 |
| 导出端点越权 | 草稿内容泄露 | Route Handler 首行 `requireAdmin()` |

## 九、验证方式

### 已实测通过（临时探针脚本，跑完即删）

转换链路用 tsx 脚本逐项跑过真实数据，非静态推断：

| 用例 | 结果 |
| --- | --- |
| MD → Tiptap：h1/h2/h4/h5 混排 | 钳制生效，分别落到 h2/h2/h4/h4，无一退化为段落 |
| MD → Tiptap：`- [x]` / `- [ ]` 任务清单 | 还原为 `taskList` + `taskItem`，`checked` 状态保留 |
| MD → Tiptap：任务项与普通项混排列表 | 拆成 `taskList` + `bulletList` 两个节点，无内容丢失 |
| MD → Tiptap：GFM 表格 / 围栏代码块 / 行内标记 / 图片 | 结构与 `language-*` 标记全部保留 |
| Tiptap → MD：提示块 / 折叠块 | 按第七节降级为引用块与粗体标题 |
| Tiptap → MD：多行代码块 | 换行保留（3 行仍为 3 行），绕开了 lowlight `<span>` 导致的压平 |
| Tiptap → MD：表格 | 输出标准 GFM 表格，含分隔行 |
| 往返（MD → 编辑器 → MD）10 项关键项 | 全部通过 |
| XSS：`<script>` / `onerror` / `onclick` / `javascript:` | 四类向量全部被剥离 |

实测中发现并修掉的三个真实数据损失，见第三节的三个 ⚠️ 项。

### 静态核对（已做）

1. 五个新模块的具名导出与全部引用点逐一对照，无对不上的名字
2. 服务端/客户端边界：`ImportMarkdownModal` 的真实 import 语句确认只引 `lib/markdown/file`，不触达 `server.ts`
3. 两个新图标（`FileUp` / `Download`）在 `lucide-react.d.ts` 中确认存在
4. 探针文件已全部删除

### 已固化为回归脚本

临时探针查完即删，但两个 bug（见下）都属于**静默失败**——不抛异常，只让内容悄悄变形，人工回归几乎发现不了。因此固化成两个常驻脚本：

| 命令 | 覆盖范围 | 结果 |
| --- | --- | --- |
| `pnpm test:markdown` | 服务层往返：导入 → 发布 → 导出 → 改文件 → 重新导入 → 再发布 → 幂等 | 42 / 42 |
| `pnpm test:markdown:http` | 真实 HTTP：登录 → 导出端点鉴权 → 下载文件落盘 → 改文件重新导入 → 二次导出 | 40 / 40 |

两个脚本都断言**语义等价**而非字节一致（往返本就有损，见第七节）。`test:markdown` 自动清理测试数据；`test:markdown:http` 刻意保留文章与下载的文件，便于人工查看。

### 命令行验证（全部已跑）

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm lint` | 0 error 0 warning |
| `pnpm test`（既有回归） | 59 / 59，无一被本次改动破坏 |
| `pnpm test:markdown` | 42 / 42 |
| `pnpm test:markdown:http` | 40 / 40 |

### HTTP 实测确认的导出响应头

真实下载而非推断，文件已落盘并逐字核对：

- `Content-Type: text/markdown; charset=utf-8` —— 中文未乱码
- `Content-Disposition: attachment` 同时带 `filename*=UTF-8''…`（中文名）与 ASCII 回退名
- `Cache-Control: no-store` —— 草稿内容不被中间层缓存
- 鉴权：匿名访问返回 401，非法 id 返回 400，不存在的文章返回 404

### 实测中发现并修掉的两个 bug

两者叠加导致「导出再导入，任务清单变成普通列表」：

| 位置 | 问题 | 根因 |
| --- | --- | --- |
| `to-markdown.ts` | 任务项与普通项之间裂出空行，紧凑列表变松散列表 | 只给任务项写了规则，同列表的普通 `<li>` 仍走 gfm 插件规则，两套换行约定不同。补 `compactListItem` 统一格式 |
| `to-html.ts` | `<li><p><input>` 形态匹配不到，任务清单退化 | `TASK_ITEM_PATTERN` 要求 `<li>` 紧跟 `<input>`，而松散列表的 `<p>` 包裹是合法 MD 产物。已放宽 |

⚠️ 修 `compactListItem` 时有个坑：turndown 规则**后注册优先**，新规则若用 `filter: "li"` 会把任务项一起吃掉（`- [x]` 退化成 `-`），必须显式排除 `data-checked`。

顺带修掉一个 lint 警告：`window.location.assign` 换成程序化 `<a download>`。原写法能用，但 Next 规则会误判成内部导航——这里是带 `attachment` 头的下载，`router.push()` 反而做不到。

### 仍未验证：浏览器内的交互

以下是客户端行为，脚本覆盖不到，需人工在 `/admin/posts/{id}` 确认：

1. 导入弹窗的拖拽上传与预览渲染效果
2. 覆盖确认：编辑器有内容时应弹二次确认，空白新建页不应弹
3. 导出下载在各浏览器下的文件名表现（响应头已确认正确，但浏览器如何落盘未验证）
4. 上传 `.txt` / `.docx` 应被扩展名校验拒绝

补充一条环境陷阱：本机 `localhost:16673` 被代理劫持返回 502，`127.0.0.1:16673` 直连正常。测试脚本因此统一用 `127.0.0.1`。
