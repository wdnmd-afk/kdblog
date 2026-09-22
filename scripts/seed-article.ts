import "dotenv/config";

/**
 * 生成一篇展示用长文：覆盖编辑器支持的全部格式。
 *
 * 目的有两个：一是给前台一个真实的长文样本，用来看排版与大纲；
 * 二是把每一种节点都写进去，任何一处「编辑器能写、发布后丢失」的
 * 都会在这篇文章里暴露出来。
 *
 * 执行：pnpm tsx scripts/seed-article.ts
 */

// ---------------------------------------------------------------------------
// 构造工具
// ---------------------------------------------------------------------------

const text = (t: string, ...marks: Array<Record<string, unknown>>) =>
  marks.length ? { type: "text", text: t, marks } : { type: "text", text: t };

const bold = (t: string) => text(t, { type: "bold" });
const italic = (t: string) => text(t, { type: "italic" });
const strike = (t: string) => text(t, { type: "strike" });
const underline = (t: string) => text(t, { type: "underline" });
const code = (t: string) => text(t, { type: "code" });
const colored = (t: string, color: string) => text(t, { type: "textStyle", attrs: { color } });
const marked = (t: string, color: string) =>
  text(t, { type: "highlight", attrs: { color } });
const link = (t: string, href: string) => text(t, { type: "link", attrs: { href } });

const p = (...content: unknown[]) => ({ type: "paragraph", content });
const h = (level: 2 | 3 | 4, t: string) => ({
  type: "heading",
  attrs: { level },
  content: [text(t)],
});
const bullet = (...items: string[]) => ({
  type: "bulletList",
  content: items.map((t) => ({
    type: "listItem",
    content: [{ type: "paragraph", content: [text(t)] }],
  })),
});
const ordered = (...items: string[]) => ({
  type: "orderedList",
  content: items.map((t) => ({
    type: "listItem",
    content: [{ type: "paragraph", content: [text(t)] }],
  })),
});
const tasks = (...items: Array<[string, boolean]>) => ({
  type: "taskList",
  content: items.map(([t, checked]) => ({
    type: "taskItem",
    attrs: { checked },
    content: [{ type: "paragraph", content: [text(t)] }],
  })),
});
const quote = (t: string) => ({
  type: "blockquote",
  content: [{ type: "paragraph", content: [text(t)] }],
});
const codeBlock = (language: string, source: string) => ({
  type: "codeBlock",
  attrs: { language },
  content: [text(source)],
});
const hr = { type: "horizontalRule" };
const image = (src: string, alt: string) => ({
  type: "image",
  attrs: { src, alt },
});
const caption = (t: string) => ({
  type: "paragraph",
  attrs: { textAlign: "center" },
  content: [italic(t)],
});
const callout = (tone: string, t: string) => ({
  type: "callout",
  attrs: { tone },
  content: [{ type: "paragraph", content: [text(t)] }],
});
const details = (summary: string, ...body: unknown[]) => ({
  type: "details",
  attrs: { open: true },
  content: [
    { type: "detailsSummary", content: [text(summary)] },
    { type: "detailsContent", content: body },
  ],
});
const cell = (t: string) => ({
  type: "tableCell",
  content: [{ type: "paragraph", content: [text(t)] }],
});
const headCell = (t: string) => ({
  type: "tableHeader",
  content: [{ type: "paragraph", content: [text(t)] }],
});
const row = (...cells: unknown[]) => ({ type: "tableRow", content: cells });

// ---------------------------------------------------------------------------
// 配图（已由 scripts/upload-wallpapers.ts 上传）
// ---------------------------------------------------------------------------

const IMG = [
  "/uploads/2026/09/mub0snpmkd5u2e.webp",
  "/uploads/2026/09/mub0so49xayy9n.webp",
  "/uploads/2026/09/mub0soh980cujx.webp",
  "/uploads/2026/09/mub0sourx8a4a5.webp",
  "/uploads/2026/09/mub0sp7voip36w.webp",
  "/uploads/2026/09/mub0splg76vwte.webp",
  "/uploads/2026/09/mub0spypggvstd.webp",
];

// ---------------------------------------------------------------------------
// 正文
// ---------------------------------------------------------------------------

const doc = {
  type: "doc",
  content: [
    p(
      text("过去两年，"),
      bold("AI 编程工具"),
      text("的形态发生了一次根本性转变：从「预测下一个 token 的补全器」变成了「能自己读代码、跑命令、看结果、再改一版」的执行体。"),
      text("Codex"),
      text(" 与 "),
      text("Claude"),
      text(" 是这条路上最具代表性的两种实现，但它们对「什么该交给模型」的回答并不相同。")
    ),
    p(
      text("这篇文章不谈模型能力本身，只看"),
      bold("工程层面的取舍"),
      text("：上下文怎么管、工具怎么给、失败怎么兜。想直接看结论可以跳到最后两节。")
    ),

    image(IMG[0], "封面配图"),
    caption("配图 1"),

    h(2, "为什么补全不够用"),
    p(
      text("补全器的工作单位是"),
      code("光标处的若干行"),
      text("，它没有「任务」这个概念。用户必须自己完成拆解、定位、改完再验证的全部循环，模型只贡献其中一小段。")
    ),

    h(3, "补全真正解决不了的三件事"),
    ordered(
      "跨文件的改动：改一个函数签名要同步五处调用点，补全看不见另外四处",
      "需要验证的改动：写完不知道对不对，得人肉跑一遍测试",
      "多步操作：装依赖、改配置、跑迁移，这些不是「写代码」而是「操作环境」"
    ),
    p(
      text("Agent 的价值就在于把这三件事接过去。代价是它需要"),
      marked("更多上下文", "#fef08a"),
      text("、"),
      marked("更多轮次", "#fef08a"),
      text("，以及一套能安全执行副作用的机制。")
    ),
    quote(
      "把模型当成一个「需要交代清楚的同事」，而不是一个「能猜出你意思的补全器」——这是用好它的分水岭。"
    ),

    h(3, "一个常见的误解"),
    callout(
      "warning",
      "把 Agent 理解成「更长的补全」会直接导致工具设计走偏：给它一个巨大的编辑框、让它一次吐出一整份文件，而不是给它一个可以反复调用的局部编辑工具。前者看似强大，实际每次都要重读重写全文，token 消耗与出错面都成倍增长。"
    ),

    hr,

    h(2, "两条工程路径"),
    p(
      text("同样是「让模型改代码」，Codex 与 Claude 的分歧点在于"),
      bold("执行环境放在哪里"),
      text("。")
    ),

    h(3, "路径一：把环境整个交给模型"),
    p(
      text("Codex 的形态更接近「一个可以随时开的远程开发机」。模型拿到的是一台"),
      colored("完整但隔离的机器", "#2563eb"),
      text("：文件系统、包管理器、测试命令、甚至网络访问都在里面。它可以直接 "),
      code("pnpm install"),
      text("，可以跑 "),
      code("git diff"),
      text(" 自己看改了什么。")
    ),
    p(
      text("好处是"),
      bold("没有中间抽象层"),
      text("：任何能用 shell 完成的事它都能做，不需要为每种能力单独设计一个工具。代价是隔离必须做扎实——这台机器默认不能碰真实凭证，网络出口也该受控。")
    ),

    h(3, "路径二：工具调用循环"),
    p(
      text("Claude 的形态更接近「一组定义良好的工具 + 一个循环」。模型不直接操作文件系统，而是调用 "),
      code("read_file"),
      text("、"),
      code("edit_file"),
      text("、"),
      code("run_command"),
      text(" 这类工具，每一步的输入输出都经过宿主程序。")
    ),
    p(
      text("好处是"),
      bold("每一步都可审计、可拦截"),
      text("：宿主能在真正写盘前问一句、能把危险命令挡下来、能对每次调用做计量。代价是工具集本身成了瓶颈——模型只能做你想到并实现了的那些事。")
    ),

    h(3, "两种路径的对比"),
    {
      type: "table",
      content: [
        row(headCell("维度"), headCell("沙箱执行"), headCell("工具调用循环")),
        row(cell("能力边界"), cell("等于 shell 的能力"), cell("等于已实现的工具集")),
        row(cell("审计粒度"), cell("命令级"), cell("调用级，可逐次拦截")),
        row(cell("隔离要求"), cell("高（整机级）"), cell("中（宿主把关）")),
        row(cell("扩展成本"), cell("低（无需新增工具）"), cell("高（每个能力都要实现）")),
        row(cell("可复现性"), cell("依赖环境镜像"), cell("依赖宿主版本")),
      ],
    },

    image(IMG[1], "配图 2"),
    caption("配图 2"),

    hr,

    h(2, "上下文管理才是真正的瓶颈"),
    p(
      text("无论走哪条路，最后都会撞到同一堵墙："),
      bold("上下文窗口是有限的，而任务本质上是开放式的"),
      text("。一个「把所有测试修好」的任务，可能涉及上百个文件与几十轮试错。")
    ),

    h(3, "窗口预算怎么分"),
    bullet(
      "系统提示与工具定义：固定开销，随着工具变多而线性增长",
      "任务描述与历史消息：随轮次累积，最容易失控的一项",
      "读到的文件内容：单次读取往往就占掉几千 token",
      "留给输出的空间：被前面三项挤压，太小时模型会开始敷衍"
    ),

    h(4, "一个实用的经验值"),
    p(
      text("把工具定义控制在总量的 "),
      colored("10%", "#16a34a"),
      text(" 以内。工具数量超过二十个时，模型选错工具的概率会明显上升——它开始分心于「该用哪个」而不是「要做什么」。")
    ),

    h(3, "压缩与检索"),
    p(
      text("上下文快满时的两种策略："),
      bold("压缩"),
      text("（把历史对话总结成一段摘要）与"),
      bold("检索"),
      text("（把旧内容挪到外部存储，需要时再取回来）。压缩便宜但有损，检索精确但要求模型知道自己缺什么。")
    ),
    callout(
      "info",
      "实践中通常是两者结合：近期消息保持原始、中期做摘要、远期只留检索索引。关键是压缩要保留「做过什么、结果如何、什么被否决了」这三类信息，丢掉任何一类都会让模型重复劳动。"
    ),

    details(
      "展开看一个具体的压缩提示词",
      p(text("压缩不是「总结对话」，而是「提取继续工作所需的状态」。下面这版提示词把重点放在可操作性上：")),
      codeBlock(
        "text",
        [
          "把下面的对话压缩成一段状态说明，必须包含：",
          "",
          "1. 当前目标（一句话）",
          "2. 已确认的事实（文件路径、函数名、报错原文）",
          "3. 已尝试且失败的方案，以及失败原因",
          "4. 下一步计划",
          "",
          "不要保留：寒暄、重复的确认、已被推翻的假设。",
          "不要总结：不确定的内容宁可标注「未知」，也不要推测。",
        ].join("\n")
      ),
      p(text("最后一条尤其重要——压缩时最容易发生的事，就是把模型当时的猜测固化成「事实」，后续所有推理都建立在这个错误前提上。"))
    ),

    hr,

    h(2, "工具设计的取舍"),
    p(text("给模型设计工具和给人设计 API 有本质区别：人读文档，模型读的是工具描述本身。")),

    h(3, "命名要描述意图，不是描述实现"),
    p(
      strike("getUserDataFromDatabaseById"),
      text(" 不如 "),
      code("get_user"),
      text("。模型是靠描述选工具的，名字里的实现细节只会干扰判断。")
    ),

    h(3, "错误信息是给模型看的"),
    p(
      text("工具返回的错误不该只是一句 "),
      code("操作失败"),
      text("。有效的错误信息要包含："),
      colored("发生了什么", "#dc2626"),
      text("、"),
      colored("可能的原因", "#ca8a04"),
      text("、"),
      colored("下一步该怎么改", "#16a34a"),
      text("。模型拿到这三样才能自我纠正。")
    ),
    codeBlock(
      "json",
      [
        "{",
        '  "error": "FILE_NOT_FOUND",',
        '  "message": "src/utils/date.ts 不存在",',
        '  "hint": "该路径下的文件列表：src/utils/format.ts, src/utils/parse.ts",',
        '  "suggestion": "确认文件名，或先用 list_files 查看 src/utils/"',
        "}",
      ].join("\n")
    ),

    h(3, "幂等性比性能重要"),
    p(
      text("Agent 会因为各种原因重试：超时、误解结果、或者干脆忘了自己做过。工具应当保证"),
      bold("同样的调用重复执行不会产生额外副作用"),
      text("，或者明确返回「已经做过了」。")
    ),

    callout(
      "danger",
      "最危险的组合是「不可逆 + 无确认」：删文件、推远端、发消息。这类操作要么加确认，要么做成可撤销（先移到回收站而不是直接删）。指望模型每次都判断正确是不现实的。"
    ),

    image(IMG[2], "配图 3"),
    caption("配图 3"),

    hr,

    h(2, "一个最小可用的 Agent 循环"),
    p(text("剥掉所有工程细节，核心循环只有十几行：")),
    codeBlock(
      "typescript",
      [
        "async function runAgent(task: string) {",
        "  const messages: Message[] = [{ role: \"user\", content: task }];",
        "",
        "  // 设上限是必须的：没有它，一个死循环能烧掉整天的额度",
        "  for (let step = 0; step < MAX_STEPS; step++) {",
        "    const reply = await callModel({ messages, tools });",
        "    messages.push(reply);",
        "",
        "    // 没有工具调用说明模型认为任务完成了",
        "    if (reply.toolCalls.length === 0) return reply.content;",
        "",
        "    for (const call of reply.toolCalls) {",
        "      const result = await executeTool(call);",
        "      messages.push({ role: \"tool\", toolCallId: call.id, content: result });",
        "    }",
        "  }",
        "",
        "  throw new Error(`超过 ${MAX_STEPS} 步仍未完成`);",
        "}",
      ].join("\n")
    ),

    p(text("真正需要斟酌的是三个地方：")),
    ordered(
      "MAX_STEPS 设多少——太小会让复杂任务半途而废，太大则错误会累积",
      "executeTool 的失败怎么回给模型——抛异常还是返回错误对象",
      "什么时候压缩历史——按轮次还是按 token 数"
    ),

    h(3, "执行工具时的三种失败"),
    p(text("区分开这三类，处理方式完全不同：")),
    bullet(
      "预期内的业务失败（文件不存在）——作为正常结果返回给模型，让它自己调整",
      "环境故障（网络超时）——重试若干次，仍失败则中止本轮",
      "越权或非法调用（试图写系统目录）——立即拦截并记入日志，不能只当作一次普通失败"
    ),

    details(
      "展开看工具执行的完整实现",
      p(text("把三类失败分开处理，是这段代码与「十几行版本」的主要差别：")),
      codeBlock(
        "python",
        [
          "def execute_tool(call):",
          "    # 越权：硬性拦截，不重试、不交给模型判断",
          "    if not is_allowed(call.name, call.args):",
          "        audit_log.warn(call)",
          "        return ToolResult.blocked(",
          "            reason=f\"{call.name} 不在允许的工具列表中\",",
          "            hint=\"请换用可用的工具完成任务\",",
          "        )",
          "",
          "    # 环境故障：有限重试",
          "    for attempt in range(MAX_RETRY):",
          "        try:",
          "            return ToolResult.ok(call.handler(**call.args))",
          "        except TransientError as e:",
          "            if attempt == MAX_RETRY - 1:",
          "                return ToolResult.failed(str(e), retryable=True)",
          "            sleep(backoff(attempt))",
          "",
          "    # 业务失败：作为正常结果返回，让模型自己纠正",
          "    except BusinessError as e:",
          "        return ToolResult.failed(str(e), hint=e.hint)",
        ].join("\n")
      ),
    ),

    hr,

    h(2, "评测与回归"),
    p(
      text("Agent 的改动很容易「这次好了、下次又坏」。"),
      bold("没有评测集就没有迭代"),
      text("——你无法判断一次提示词调整到底是改进了还是退步了。")
    ),

    h(3, "任务集怎么攒"),
    tasks(
      ["从真实 issue 里挑 20 个有明确验收标准的", true],
      ["每个任务固定初始仓库状态（用 git tag 锁住）", true],
      ["记录基准通过率与平均步数", true],
      ["补充边界用例：空文件、超长文件、编码异常", false],
      ["加上「不该做」的反例：确认它不会越权", false]
    ),

    callout(
      "success",
      "评测集的价值不在绝对值，而在趋势。哪怕只有二十个任务，只要能稳定复现，就能回答「这次改动是变好还是变坏」——这是继续迭代的前提。"
    ),

    h(3, "别只看通过率"),
    p(text("通过率会掩盖很多问题。至少同时记录：")),
    bullet(
      "平均步数：通过率不变但步数翻倍，说明效率退化了",
      "token 消耗：直接对应成本",
      "失败类型分布：是找不到文件，还是改错了地方，还是没跑测试",
      "越权次数：这个应当恒为零"
    ),

    image(IMG[3], "配图 4"),
    caption("配图 4"),

    hr,

    h(2, "落地建议"),
    p(text("如果要在自己的团队里引入这类工具，按这个顺序推进风险最低：")),
    ordered(
      "先只读：让它能看代码、能回答「这个功能在哪实现的」，但不许写",
      "再限定范围写：只允许改指定目录，每次改动都要人确认",
      "然后放开命令执行：但仍然限制在容器内，且不允许访问生产凭证",
      "最后才谈自动化：在评测集稳定之后，再考虑接进 CI"
    ),
    p(
      text("每一步都应当能独立带来价值，而不是「必须先走到最后一步才有用」。这样即使后面某一步卡住，前面的投入也不会白费。")
    ),

    callout(
      "info",
      "判断是否该进入下一步的信号很简单：当前阶段的人工介入频率已经低到让你觉得「这一步确认是多余的」。如果每次都要仔细审查，说明还没到放开的时候。"
    ),

    hr,

    h(2, "小结"),
    p(
      text("Codex 与 Claude 代表了两种回答：一个把环境整个交出去，一个把能力拆成工具。前者灵活、后者可控，实际选型取决于你更怕「能力不够」还是更怕「失控」。")
    ),
    p(
      text("但两边最终都要面对同一组问题："),
      bold("上下文怎么管、工具怎么设计、失败怎么兜、改动怎么评测"),
      text("。这四件事跟模型选型"),
      underline("无关"),
      text("，是 Agent 工程本身的功课。")
    ),
    p(
      text("想继续看具体实现，可以参考 "),
      link("Anthropic 的工程博客", "https://www.anthropic.com/engineering"),
      text(" 与 "),
      link("OpenAI 的 Codex 文档", "https://platform.openai.com/docs"),
      text("。")
    ),
    p(
      text("最后一行是为了演示"),
      text("下标", { type: "subscript" }),
      text(" 与 "),
      text("上标", { type: "superscript" }),
      text(" 的渲染效果 —— 它们在正文里的实际用途远没有这么多。")
    ),
  ],
};

// ---------------------------------------------------------------------------
// 发布
// ---------------------------------------------------------------------------

async function main() {
  const { prisma } = await import("../lib/db");
  const postService = await import("../server/services/post");
  const { resolveTagIds } = await import("../server/services/tag");

  const admin = await prisma.user.findFirst();
  if (!admin) throw new Error("没有管理员账号，请先执行 pnpm db:seed");

  const categoryName = "技术笔记";
  const category =
    (await prisma.category.findFirst({ where: { name: categoryName } })) ??
    (await prisma.category.create({
      data: { name: categoryName, slug: "tech-notes", description: "技术类长文" },
    }));

  const tagNames = ["Agent", "Codex", "Claude", "上下文工程", "工具调用"];
  const tagIds = await resolveTagIds(tagNames);

  const seo = {
    metaTitle: "Codex 与 Claude：AI Agent 的两条工程路径",
    metaDescription:
      "从上下文管理、工具设计、失败兜底到评测回归，拆解 Codex 与 Claude 两类 AI Agent 在工程实现上的取舍，并给出一份最小可用的循环实现与渐进落地顺序。",
    keywords: ["AI Agent", "Codex", "Claude", "上下文工程", "工具调用"],
    ogImage: IMG[0],
    ogTitle: "",
    ogDescription: "",
    canonicalUrl: "",
    robots: "index,follow" as const,
  };

  const existing = await prisma.post.findFirst({ where: { slug: "agent-engineering-paths" } });
  if (existing) {
    await prisma.post.delete({ where: { id: existing.id } });
    console.log(`已删除同 slug 的旧文章 id=${existing.id}`);
  }

  const post = await postService.publish({
    title: "Codex 与 Claude：AI Agent 的两条工程路径",
    slug: "agent-engineering-paths",
    contentJson: doc as never,
    categoryId: category.id,
    tagIds,
    authorId: admin.id,
    seo,
  });

  console.log(`\n已发布 id=${post.id}`);
  console.log(`地址 /posts/${post.slug}-${post.id}`);
  console.log(`正文 HTML 长度 ${post.contentHtml?.length ?? 0}`);
  console.log(`分类 ${category.name} / 标签 ${tagNames.join("、")}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
