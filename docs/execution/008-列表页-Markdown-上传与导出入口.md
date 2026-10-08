# 文章列表页 Markdown 上传与导出入口

- 文档编号：008
- 状态：已实施；服务端全链路端到端验证通过（31/31），客户端交互待人工在浏览器确认
- 创建日期：2026-09-24
- 适用范围：后台文章列表页的 Markdown 上传入口、行内导出，以及编辑器顶栏入口可见性
- 前置文档：006（文章 Markdown 导入导出）

## 一、目标

1. 文章列表页页头新增「上传 MD」入口：**只允许单个文件**，上传后跳到写文章页并把内容带过去
2. 文章列表页每行新增「导出 MD」按钮，复用已有的导出端点
3. 修复编辑器顶栏「导入 MD / 导出 MD」在窄屏下只剩图标、无法辨认的问题

## 二、需求来源与已确认的决策

需求由用户提出，实施前经两轮确认：

| 决策项 | 结论 | 理由 |
| --- | --- | --- |
| 列表页上传后内容如何进入编辑器 | **不落库**。解析结果暂存浏览器 → 跳 `/admin/posts/new` → 编辑器挂载时读出灌入 | 库里不留下半成品记录，误传不必去回收站清；编辑器自身的本地草稿机制会接着兜底 |
| 「写文章页也同步这个功能」的含义 | **只让现有入口可见**，不新增行为 | 编辑器顶栏本就有「导入 MD」，行为正确，只是窄屏下被 `hidden lg:inline` 藏掉了文字 |
| 上传文件数量 | 单个 | 与 006 号文档「明确不做批量导入」的结论一致：每篇的 slug / 分类 / SEO 都要人工确认 |
| 列表页上传是否弹预览确认 | **不弹**，解析成功直接跳 | 用户明确要求「上传后打开写文章页」。跳过去之后所见即真实编辑器，那里本就是最适合预览的地方；不落库，看错了直接关页面即可 |
| 行内导出是否二次确认 | **不做** | 导出是只读操作，不改变任何数据。编辑器里的导出确认是为了提醒「有未保存改动」，列表页不存在这个前提（列表读的就是库里已保存的版本） |

## 三、现状核实（实测，非推断）

用临时探针脚本（登录后只读 GET，抓真实渲染的 HTML）核实，脚本用完已删：

| 核实项 | 实测结果 |
| --- | --- |
| `/admin/posts/new` 是否含「导入 MD」 | ✅ 含。新建页也有，不受 `isNew` 限制 |
| `/admin/posts/new` 是否含「导出 MD」 | ❌ 不含。符合设计：还没 id，导不出东西 |
| `/admin/posts` 是否含任何 MD 导入 / 导出 | ❌ 完全没有。页头只有「写文章」，行内只有「取消发布 / 移入回收站」 |
| 列表页导出能力 | 端点 `GET /api/posts/[id]/export` 已存在且鉴权、响应头均已被 006 号文档实测确认，**只差一个入口** |

结论：用户反馈的两条里，第一条是「看不见」而非「没有」，第二条是真缺口。

### 3.1 实施后发现并修掉的阻塞性 bug（导致用户看到 digest 错误）

用户实测时报出后台错误边界（「操作没能完成 / 页面在加载数据时出错了 / 错误编号 1533540467」）。
定位过程与结论：

| 步骤 | 结果 |
| --- | --- |
| 错误编号来源 | `app/(admin)/error.tsx` 渲染的 `error.digest`，说明是**未捕获的服务端异常** |
| 项目自己的日志 | `logs/` 目录不存在 → 没走 `logError`，不是被 catch 的业务错误 |
| Next dev 运行日志 | `.next/dev/logs/next-development.log` 里查到同族错误：`Only plain objects ... can be passed to Client Components`，指向 `{type: "heading", attrs: {textAlign: Null, level: 2}}` |
| 复现 | 用 `docs/本地开发环境.md` 真实 HTTP 调用 `parseMarkdownAction`，响应 RSC 流里出现 `E{"digest":"3697799411",...,"Only plain objects, and a few built-ins, can be passed to Client Components from Server Components. Classes or null prototypes are not supported."}` |
| 根因 | `server/actions/markdown.ts` 把 `parseMarkdownBody` 的结果**原样**作为 Server Action 的返回值。`parseMarkdownBody` 内部是 `generateJSON`，它产出的每个节点 `attrs` 都是 prosemirror 用 `Object.create(null)` 建的**无原型对象**，React 的 Flight 序列化器会直接拒绝 |
| 量化 | `docs/本地开发环境.md`（3315 字符）解析后有 **127 处**无原型对象；经 `toPlainJson` 后归零 |
| 影响面 | **不止本次新功能**。006 号那次提交里的编辑器「导入 MD」走同一个 action，同样必坏——006 文档第九节已如实记录「浏览器内的交互未验证」，这个 bug 正好落在那个盲区里。全项目扫过，只有这一处 action 返回 tiptap JSON；`revertToRevisionAction` 的 contentJson 来自数据库，是纯对象，不受影响 |
| 修复 | `contentJson: toPlainJson(result.contentJson)`。这与入参方向的 `lib/json.ts` 是同一个坑的两面：那边是编辑器发正文给 action 前归一，这边是 action 把正文发回客户端前归一 |

⚠️ 值得记一笔：既有的 `pnpm test:markdown` 与 `pnpm test:markdown:http` 都覆盖不到它。
前者直调服务层，不经过 React 的序列化；后者在 006 文档里明确写了「Server Action 的调用
协议是 Next 内部实现，用 fetch 手工拼不稳定」因而绕开了 action。**跨边界序列化这类问题，
只有真发一次 action 请求才能验到。**

## 四、范围

### 本次做

| # | 文件 | 改动 |
| --- | --- | --- |
| 1 | `lib/pending-md-import.ts` | **新增**。一次性的内容交接存储（sessionStorage 读写） |
| 2 | `app/(admin)/admin/posts/ImportMarkdownButton.tsx` | **新增**。列表页「上传 MD」按钮：选文件 → 校验 → 解析 → 暂存 → 跳转 |
| 3 | `app/(admin)/admin/posts/page.tsx` | 页头 `actions` 里加「上传 MD」，与「写文章」并排 |
| 4 | `app/(admin)/admin/posts/PostRowActions.tsx` | 行内加「导出 MD」图标按钮 |
| 5 | `app/(admin)/admin/posts/PostBulkTable.tsx` | 把 `row.title` 传给 `PostRowActions`，供导出按钮的 `aria-label` 区分到具体文章 |
| 6 | `app/(admin)/admin/posts/[id]/PostEditor.tsx` | ① 挂载时消费待导入内容；② 顶栏入口可见性修复 |
| 7 | `server/actions/markdown.ts` | **修 bug**。`contentJson` 返回前过 `toPlainJson`（见 3.1，这是用户看到 digest 错误的根因） |

### 明确不做

| 项 | 原因 |
| --- | --- |
| 批量上传多个 `.md` | 与 006 号文档一致，见第二节 |
| 列表页上传后的预览弹窗 | 用户明确要求直接跳转，见第二节 |
| 把 `ImportMarkdownModal` 提到 `components/` 复用 | 006 号文档已论证它耦合编辑器语义（要套用 frontmatter 到表单字段）才留在 `[id]/`。列表页这条路径不需要预览，硬复用等于给两种语义不同的流程套同一个壳 |
| 列表页行内「导入 / 替换正文」 | 语义不成立：列表页没有"当前正文"可以替换 |
| 上传后自动发布 | 006 号文档已定：一律落草稿，导入内容未经 SEO 校验 |

## 五、操作步骤

1. 写 `lib/pending-md-import.ts`
2. 写 `ImportMarkdownButton.tsx`，接到 `posts/page.tsx` 的 `PageHeader.actions`
3. `PostRowActions.tsx` 加导出按钮，`PostBulkTable.tsx` 补传 `title`
4. `PostEditor.tsx` 加消费 effect，调整顶栏按钮断点与可访问名
5. 用户实测报错 → 定位到 3.1 的序列化 bug → 修 `server/actions/markdown.ts`
6. 写端到端测试脚本 `tmp/e2e-md-upload.ts`，用 `docs/本地开发环境.md` 跑通全链路
7. 写本文档

## 六、关键实现约束

### 6.1 为什么用 sessionStorage 而不是 localStorage

`lib/use-local-draft.ts` 用的是 localStorage，那是「同一篇文章跨会话继续写」的语义，必须跨标签页、跨天保留。这里是「一次上传动作的交接」，只在一个标签页内、几秒内有效。用 localStorage 的话，两个标签页各自上传会互相覆盖对方的待导入内容。

### 6.2 为什么不用路由参数传内容

正文是 Tiptap JSON，几十上百 KB 很常见，塞进 URL 会撞长度限制，也会被写进浏览器历史记录。Server Action 只能返回可序列化的值，也做不到「把内容带给下一个页面」这件事。

### 6.3 读取必须与删除原子

`takePendingMarkdownImport()` 读一次就删。若只读不删，用户下次手动打开写文章页时会被莫名灌进一篇旧内容。解析失败也要删——坏数据留着只会在每次打开新建页时重复报错。

### 6.4 消费时机必须早于「恢复本地草稿」的询问

`PostEditor` 里两个 effect 按声明顺序执行。消费 effect 放在恢复询问之前，并在灌入后同步把 `askedRecovery.current` 置位，恢复询问在同一轮就会被跳过。

理由：用户刚上传的文件显然比一份旧的本地残留更符合此刻意图。这里刻意**不调 `clear()`**——新建页的本地草稿只有一个存储槽（`kdblog:post-draft:new`），灌入触发的 update 事件会让新内容稍后自然覆盖掉那份旧草稿，主动删与坐等覆盖结果相同。

### 6.5 元信息套用规则与编辑器导入保持一致

新建页各字段都是空的，因此「只填空白字段」这条规则等价于全部套用。`slug` 额外过一遍 `slugify`（frontmatter 里可能带大写或中文，直接填会在保存时被 `slugSchema` 拒掉，而错误提示离上传动作很远）。

`tags` **不自动建标签**，只提示——与编辑器导入一致：一次上传凭空造出十几个标签，清理起来很麻烦。

### 6.6 顶栏按钮断点的实测依据

按 `BUTTON_SIZES.sm`（`h-8 px-2.5`，左右各 10px）与 `BUTTON_BASE` 的 `gap-1.5`（6px）逐项计算：

| 场景 | 顶栏右侧那一组的宽度 |
| --- | --- |
| 全部图标（当前 `<lg` 的表现） | 约 383px（含左端返回箭头与保存状态） |
| 全部带文字（当前 `≥lg` 的表现） | 约 638px |

可用宽度：`≥1024px` 时为 `视口 - 240px 侧栏 - 56px 内边距`；`768～1023px` 时为 `视口 - 240 - 40`；`<768px` 时侧栏隐藏，为 `视口 - 40`。

- 当前 `≥lg` 才显示文字是对的：在 1024px 视口下可用 728px，638px 装得下
- **不能**简单地把所有 `hidden lg:inline` 都改成 `sm:inline`：在 768px 视口下可用 488px，而全部带文字需约 638px，会溢出并被外层 `overflow-hidden` 硬裁掉
- 因此只把「导入 MD」降到 `sm`（383 + 51 = 434px，最小可用 488px，余量 54px）；「导出 MD」维持 `lg`，改用它处已有的 `Tooltip` 组件补足窄屏提示（383 + 102 = 485px 对 488px，只剩 3px 余量，太危险）

### 6.7 图标按钮必须补 `aria-label`

`<span className="hidden lg:inline">` 是 `display: none`，会同时把文字移出无障碍树。窄屏下这些按钮因此是**没有任何可访问名**的图标按钮。补 `aria-label` 是本次改动里成本最低、收益最确定的一项。

## 七、潜在风险

| 风险 | 影响 | 处置 |
| --- | --- | --- |
| sessionStorage 写入失败（隐私模式 / 配额） | 跳过去后编辑器是空的，用户以为上传丢了 | `stashPendingMarkdownImport` 返回布尔值；写失败时不跳转，直接 toast 报错，让用户留在列表页 |
| 用户在上传后、跳转前手动改了地址栏 | 待导入内容留在 sessionStorage，下次打开新建页才被消费 | 可接受：内容仍会被消费，且是一次性的。代价仅是"晚一点生效" |
| 上传的文件解析结果不合预期 | 用户在新建页看到不对，可能直接存了 | 不落库 + 编辑器有本地草稿兜底；且提示文案明确写「确认无误后记得保存」 |
| 中文标题的 slug | `slugify` 可能产出空串 | 与编辑器导入同规则：`slugify` 结果为空则不填，用户可在设置抽屉点「重新生成地址」 |
| 「上传 MD」按钮用真 `<button>` 而非 `<label>` | 与 `ImportMarkdownModal` 的写法不一致 | 有意为之：列表页入口是标准按钮外观，需要 `disabled` 态与统一焦点环，真 button 直接就有；modal 里是自定义整块拖放区，不存在这两点。键盘路径同样成立（Tab 聚焦按钮 → 回车触发 `input.click()`，属于用户手势，文件选择器能正常打开） |
| 顶栏宽度计算基于 class 推算，未在真实浏览器量过 | 窄屏可能出现溢出 | 已按最紧的 768px 视口留 54px 余量；但**未做浏览器实测**，见第九节 |
| **任何返回 tiptap JSON 的 Server Action 都可能重犯 3.1 的错** | 客户端拿到无原型对象 → React 序列化直接抛 → 只给一个 digest，前端 catch 不到 | 本次已修 `parseMarkdownAction`，并全项目扫过确认无第二处。今后新增这类 action 时，返回值必须先过 `toPlainJson`（与入参方向对称）；改完用 `tmp/e2e-md-upload.ts` 的真发请求方式验一次，服务层测试查不出这个问题 |

## 八、优化方案（本次不做，记录备查）

1. 把顶栏图标按钮收进一个「⋯」溢出菜单，窄屏下彻底告别"只剩图标"的问题
2. 列表页支持多选导出（打包 zip）——需要新增依赖，且当前没有多选导出的真实诉求
3. 上传后若文件名与已有文章 slug 冲突，提示"是否覆盖"——属于另一条独立链路

## 九、验证方式

### 已做（静态核对）

1. 逐项核对新模块的具名导出与全部引用点，无对不上的名字
2. 客户端 / 服务端边界：`ImportMarkdownButton` 只引 `lib/markdown/file`（零依赖常量）与 `server/actions/markdown`，不触达 `lib/markdown/index.ts`（那会连带把 marked / turndown 打进浏览器包，006 号文档已记录过这个坑）
3. `lib/pending-md-import.ts` 不含任何 `import`，不会把服务端依赖拖进客户端
4. 改动前用只读 HTTP 探针确认过三个页面的实际渲染结果（见第三节）

### 已做（改动后的只读 HTTP 复核）

改动完成后重跑只读探针（登录后 GET，抓真实 HTML），两个页面均 **HTTP 200 且无编译错误**：

| 页面 | 断言 | 结果 |
| --- | --- | --- |
| `/admin/posts` | 含「上传 MD」 | ✅ |
| `/admin/posts` | 含「导出 Markdown」（导出按钮的 aria-label） | ✅ |
| `/admin/posts` | 含「写文章」 | ✅ |
| `/admin/posts/new` | 含「导入 MD」 | ✅ |
| `/admin/posts/new` | 含「导入 Markdown 文件到正文」（Tooltip 文案） | ✅ |
| `/admin/posts/new` | 含 `aria-label="设置"` | ✅ |

这一步能证明的是「服务端渲染通过、新组件成功进包、文案已就位」。

### 已做（全链路端到端，真实 HTTP：`tmp/e2e-md-upload.ts`）

用户要求「测这个功能的完整性」，素材用项目内的 `docs/本地开发环境.md`（3315 字符，含标题、
表格、多语言代码块）。这是本仓库第一个**真发 Server Action 请求**的测试——006 号文档当年
因为「调用协议是 Next 内部实现」而绕开了它，本次的 bug 恰好就藏在那里。

`npx tsx tmp/e2e-md-upload.ts` → **31 / 31 通过**：

| 组 | 覆盖 | 结果 |
| --- | --- | --- |
| 【零】页面渲染 | `/admin/posts`、`/admin/posts/new` 均 200 且不含错误边界 | 2 / 2 |
| 【一】真实 action 边界 | `parseMarkdownAction` 返回 200、**无 React 序列化错误**、含 contentJson / previewHtml、预览 HTML 里是 `<h2>`（标题钳制生效） | 5 / 5 |
| 【二】解析与前端归一 | 原始产物含 127 处无原型对象 → `toPlainJson` 后归零；JSON 往返（模拟 sessionStorage 交接）结构不变；无 h1 残留；含表格与代码块节点 | 9 / 9 |
| 【三】保存草稿 | 真实 HTTP 调 `saveDraftAction`，无序列化错误，拿到新 id | 3 / 3 |
| 【四】导出 | 导出 200、`text/markdown`、frontmatter 带标题与 slug、表格 / 代码块语言 / 正文特征串全部保留 | 9 / 9 |
| 【五】清理 | `trashPostAction` + `purgePostAction` 删掉测试文章，不留垃圾数据 | 2 / 2 |

action id 由脚本从 `.next/dev/static/chunks` 现场解析，不写死——它是编译期生成的，
每次重建都会变。这一步依赖 Next 的 chunk 内部格式，属于**已知的不稳**，因此只放在
`tmp/` 的临时脚本里，没有进 `pnpm test:*` 主流程。

### 未做（须如实记录）

| 项 | 原因 |
| --- | --- |
| 浏览器内实际点「上传 MD」→ 选文件 → 跳转 → 灌入 | 本机无浏览器自动化（`package.json` 中无 playwright 等依赖）。端到端脚本覆盖了它前后的全部服务端环节，中间那段纯客户端逻辑（File API、sessionStorage、router.push、Tiptap setContent）只有代码审阅 |
| 窄屏顶栏是否溢出 | 第六节的宽度是**按 class 推算**的，没有在真实浏览器里量过 |
| 上传 `.txt` / 空文件被拒 | 客户端分支，同上 |
| `pnpm lint` / `pnpm typecheck` / `pnpm build` | 未执行（用户规则：未经明确要求不跑这些命令） |

### 建议的人工确认清单

1. `/admin/posts` → 点「上传 MD」→ 选一个 `.md` → 应跳到 `/admin/posts/new` 且内容已灌入
2. 上传带 frontmatter 的文件 → 标题 / 摘要 / slug / 关键词应被填入设置抽屉
3. 上传 `.txt` 或空文件 → 应停在列表页并弹出错误提示
4. `/admin/posts` → 某行点导出图标 → 应下载该文章的 `.md`
5. 把窗口拖窄到 700px 左右 → 顶栏「导入 MD」应仍有文字，鼠标悬停「导出 MD」应出现即时提示
6. 上传后不保存直接返回列表 → 库里不应多出任何记录
