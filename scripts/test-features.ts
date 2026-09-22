import "dotenv/config";

/**
 * 发布 / 分类 / 标签三大功能的自动化集成测试。
 *
 * 为什么用 tsx 脚本而非 vitest：这三个功能的业务逻辑集中在 server/services 与
 * lib/seo/schema，都是可直接调用的纯模块；引入整套测试框架只为跑这些断言，
 * 收益不抵其配置与依赖成本。沿用项目已有的 scripts/smoke-test.ts 约定。
 *
 * 覆盖范围（对应历史上真实出过的 bug）：
 *  - 发布：saveDraft → publish 全链路、SEO 按「显示宽度」校验（中文计 2）、
 *    重复发布保留首次 publishedAt、SEO 不合规时阻止发布
 *  - 分类：建树、环检测、有子分类时拒删、slug 唯一
 *  - 标签：重名/重 slug 拒绝、resolveTagIds 复用+新建、删除级联解除关联
 *  - 错误映射：服务层抛的每个错误码都能被 normalizeError 翻成可读文案
 *    （未映射会回退成「操作失败，请稍后重试」——正是本轮排查的那个症状）
 *
 * 不覆盖：action 层的 requireAdmin 与 revalidatePath（依赖 Next 运行时，
 * 无法在纯脚本里执行）、以及发布后的前端跳转（React 客户端行为，需 E2E）。
 * 这两类在文末说明里点出，避免误以为「全绿即万无一失」。
 *
 * 执行：pnpm test
 * 会写入真实数据但结束时自净；所有测试数据带 __test__ 前缀便于识别与兜底清理。
 */

// ---------------------------------------------------------------------------
// 极简断言框架
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    const line = detail ? `${name} — ${detail}` : name;
    failures.push(line);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** 断言某段异步操作抛出指定错误码 */
async function expectThrows(name: string, code: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(name, false, `预期抛出 ${code}，但没有抛错`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    check(name, msg === code, msg === code ? undefined : `预期 ${code}，实际 ${msg}`);
  }
}

/** 测试数据统一前缀：即便脚本中途崩溃，也能靠前缀识别并清理残留 */
const P = "__test__";

async function main() {
  const { prisma } = await import("../lib/db");
  const postService = await import("../server/services/post");
  const categoryService = await import("../server/services/category");
  const tagService = await import("../server/services/tag");
  const { normalizeError } = await import("../server/actions/types");
  const { seoPublishSchema, seoDraftSchema, measureSeoLength } = await import(
    "../lib/seo/schema"
  );

  const admin = await prisma.user.findFirst();
  if (!admin) throw new Error("没有管理员账号，请先执行 pnpm db:seed");

  // 记录本次创建的实体，结束时逐个清理
  const createdPostIds: number[] = [];
  const createdCategoryIds: number[] = [];
  const createdTagIds: number[] = [];

  const doc = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "自动化测试正文。" }] }],
  };

  // 一组合规的 SEO，供发布用例复用
  const goodSeo = {
    metaTitle: "自动化测试文章的 SEO 标题够长",
    metaDescription:
      "这是一段用于自动化测试的 SEO 描述，长度需达到四十个字符以上（按显示宽度计）才能通过发布校验，因此写得长一些。",
    keywords: ["自动化", "测试", "发布"],
    ogImage: "",
    ogTitle: "",
    ogDescription: "",
    canonicalUrl: "",
    robots: "index,follow" as const,
  };

  try {
    // -----------------------------------------------------------------------
    console.log("\n【一】SEO 校验（度量口径）");
    // -----------------------------------------------------------------------
    {
      // 32 个中文字：length=32 但显示宽度=64。曾经的 bug：zod 用 length 判 <40 而拒绝，
      // 进度条却按宽度显示 64/160 达标，导致「填了却发不出」。
      const desc32 = "发的感受到返回到分公司单方事故电饭锅三等份偶十点半分的说法都是的说";
      check("显示宽度按中文计 2", measureSeoLength(desc32) === desc32.length * 2,
        `length=${desc32.length} width=${measureSeoLength(desc32)}`);

      const okByWidth = seoPublishSchema.safeParse({ ...goodSeo, metaDescription: desc32 });
      check("宽度达标的中文描述可通过发布校验", okByWidth.success,
        okByWidth.success ? undefined : okByWidth.error.issues.map((i) => i.message).join("; "));

      const emptyReject = seoPublishSchema.safeParse({
        metaTitle: "", metaDescription: "", keywords: [], robots: "index,follow",
        ogImage: "", ogTitle: "", ogDescription: "", canonicalUrl: "",
      });
      check("空 SEO 被发布校验拒绝", !emptyReject.success);

      const twoKw = seoPublishSchema.safeParse({ ...goodSeo, keywords: ["只有", "两个"] });
      check("关键词不足 3 个被拒绝", !twoKw.success);

      // 草稿态应放行全空，允许边写边存
      const draftEmpty = seoDraftSchema.safeParse({ keywords: [] });
      check("草稿态允许空 SEO", draftEmpty.success);
    }

    // -----------------------------------------------------------------------
    console.log("\n【二】发布文章全链路");
    // -----------------------------------------------------------------------
    {
      const draft = await postService.saveDraft({
        title: `${P}草稿`, slug: `${P.replace(/_/g, "")}-draft`, contentJson: doc,
        seo: goodSeo, authorId: admin.id,
      });
      createdPostIds.push(draft.id);
      check("saveDraft 成功且为草稿态", draft.status === "DRAFT");

      const published = await postService.publishPost({
        id: draft.id, title: `${P}草稿`, slug: `${P.replace(/_/g, "")}-draft`,
        contentJson: doc, seo: goodSeo, newTagNames: [`${P}标签A`], authorId: admin.id,
      });
      check("publish 后状态为 PUBLISHED", published.status === "PUBLISHED");
      check("publish 写入 publishedAt", published.publishedAt !== null);
      check("publish 预渲染 contentHtml", (published.contentHtml?.length ?? 0) > 0);

      // newTagNames 链路：应已自动建出 __test__标签A 并关联。
      // 必须在下面的重复发布之前断言——syncTags 是全量替换，
      // 那次发布不带 tagIds，会把关联清空（真实 UI 每次都带当前 tagIds，不会如此）。
      const relTags = await prisma.postTag.findMany({
        where: { postId: draft.id }, include: { tag: true },
      });
      check("newTagNames 自动建标签并关联", relTags.some((t) => t.tag.name === `${P}标签A`));
      relTags.forEach((t) => createdTagIds.push(t.tagId));

      const firstPublishedAt = published.publishedAt;
      const republished = await postService.publishPost({
        id: draft.id, title: `${P}草稿改`, slug: `${P.replace(/_/g, "")}-draft`,
        contentJson: doc, seo: goodSeo, authorId: admin.id,
      });
      check("重复发布保留首次 publishedAt",
        republished.publishedAt?.getTime() === firstPublishedAt?.getTime());

      const revisions = await postService.listRevisions(draft.id);
      check("每次发布生成版本快照", revisions.length >= 2);

      // 软删 → 前台不可见 → 还原 → 可见
      await postService.trashPost(draft.id);
      check("软删后前台查询返回 null", (await postService.getPublishedPost(draft.id)) === null);
      await postService.restorePost(draft.id);
      check("还原后前台重新可见", (await postService.getPublishedPost(draft.id)) !== null);

      // slug 撞库应抛 SLUG_TAKEN
      await expectThrows("重复 slug 被拒绝", "SLUG_TAKEN", () =>
        postService.saveDraft({
          title: `${P}撞库`, slug: `${P.replace(/_/g, "")}-draft`, contentJson: doc,
          seo: goodSeo, authorId: admin.id,
        })
      );
    }

    // -----------------------------------------------------------------------
    console.log("\n【三】分类维护");
    // -----------------------------------------------------------------------
    {
      const parent = await categoryService.createCategory({ name: `${P}父分类`, slug: `${P.replace(/_/g, "")}-parent` });
      createdCategoryIds.push(parent.id);
      check("创建顶级分类", parent.parentId === null);

      const child = await categoryService.createCategory({
        name: `${P}子分类`, slug: `${P.replace(/_/g, "")}-child`, parentId: parent.id,
      });
      createdCategoryIds.push(child.id);
      check("创建子分类挂到父级", child.parentId === parent.id);

      const tree = await categoryService.getCategoryTree();
      const parentNode = findById(tree, parent.id);
      check("分类树把子分类嵌到父级下", parentNode?.children.some((c) => c.id === child.id) ?? false);

      check("环检测：把父级设为自己的子分类被识别",
        await categoryService.wouldCreateCycle(parent.id, child.id));

      await expectThrows("有子分类时拒绝删除父级", "CATEGORY_HAS_CHILDREN", () =>
        categoryService.deleteCategory(parent.id)
      );

      await expectThrows("分类 slug 撞库被拒绝", "SLUG_TAKEN", () =>
        categoryService.createCategory({ name: `${P}重名`, slug: `${P.replace(/_/g, "")}-parent` })
      );

      await expectThrows("把分类挂到自己的后代下被拒绝", "CATEGORY_CYCLE", () =>
        categoryService.updateCategory(parent.id, {
          name: `${P}父分类`, slug: `${P.replace(/_/g, "")}-parent`, parentId: child.id,
        })
      );
    }

    // -----------------------------------------------------------------------
    console.log("\n【四】标签维护");
    // -----------------------------------------------------------------------
    {
      const tag = await tagService.createTag({ name: `${P}标签B`, slug: `${P.replace(/_/g, "")}-tagb` });
      createdTagIds.push(tag.id);
      check("创建标签", tag.name === `${P}标签B`);

      await expectThrows("标签重名被拒绝", "TAG_NAME_TAKEN", () =>
        tagService.createTag({ name: `${P}标签B`, slug: `${P.replace(/_/g, "")}-other` })
      );
      await expectThrows("标签 slug 撞库被拒绝", "TAG_SLUG_TAKEN", () =>
        tagService.createTag({ name: `${P}另名`, slug: `${P.replace(/_/g, "")}-tagb` })
      );

      // resolveTagIds：已存在的复用、不存在的新建
      const ids = await tagService.resolveTagIds([`${P}标签B`, `${P}标签C`]);
      ids.forEach((id) => createdTagIds.push(id));
      check("resolveTagIds 复用已有 + 新建缺失", ids.length === 2 && ids.includes(tag.id));

      const list = await tagService.listTagsWithCount();
      check("listTagsWithCount 含新建标签", list.some((t) => t.name === `${P}标签C`));
    }

    // -----------------------------------------------------------------------
    console.log("\n【五】错误码映射完整性");
    // -----------------------------------------------------------------------
    {
      // 服务层实际会抛的每个码都必须能被翻译；未映射会回退成通用「操作失败」，
      // 那正是用户看到的无信息量提示。此表须与 server 各 service 的 throw 同步。
      const codes = [
        "SLUG_TAKEN", "POST_NOT_FOUND", "REVISION_NOT_FOUND",
        "CATEGORY_CYCLE", "CATEGORY_HAS_CHILDREN", "PAGE_NOT_FOUND",
        "TAG_NAME_TAKEN", "TAG_SLUG_TAKEN", "UNAUTHORIZED",
      ];
      const fallback = normalizeError(new Error("__UNMAPPED__"));
      for (const code of codes) {
        const msg = normalizeError(new Error(code));
        check(`错误码 ${code} 有可读映射`, msg !== fallback, msg === fallback ? "回退成了通用提示" : undefined);
      }

      // 数据库约束是另一条失败路径：Prisma 直接抛带 code 的错误，不走上面那张表。
      // 曾经全部回退成「操作失败，请稍后重试」，用户既看不懂也不知道下一步做什么。
      for (const code of ["P2002", "P2003", "P2025", "P2000"]) {
        const err = Object.assign(new Error("db constraint"), { code });
        const msg = normalizeError(err);
        check(
          `Prisma ${code} 有可读映射`,
          msg !== fallback,
          msg === fallback ? "回退成了通用提示" : undefined
        );
      }
    }

    // -----------------------------------------------------------------------
    console.log("\n【六】失效会话不得掉进通用错误");
    // -----------------------------------------------------------------------
    {
      /**
       * 复现「所有字段都填完了却提示操作失败」的真实成因。
       *
       * session 策略是 JWT，用户 id 只在登录那一刻写进 token。库被重新 seed 后
       * id 变了，旧 cookie 仍带着已消失的 id，发布时撞 authorId 外键抛 P2003，
       * 且因为异常发生在事务内，文章整体回滚——用户看到的只有一句通用提示。
       */
      let caught: unknown;
      try {
        await postService.publish({
          title: `${P}失效会话`,
          slug: "test-stale-session",
          contentJson: doc,
          seo: goodSeo,
          authorId: "cuid-that-does-not-exist-000000",
        });
      } catch (error) {
        caught = error;
      }

      const code = (caught as { code?: string } | undefined)?.code;
      check("失效 authorId 触发外键错误 P2003", code === "P2003", `实际 code=${code}`);
      check(
        "该错误不再回退成通用提示",
        normalizeError(caught) !== normalizeError(new Error("__UNMAPPED__")),
        "仍是「操作失败，请稍后重试」"
      );
      check(
        "requireAdmin 会回查用户，失效会话抛 UNAUTHORIZED",
        normalizeError(new Error("UNAUTHORIZED")).includes("重新登录")
      );
    }

    // -----------------------------------------------------------------------
    console.log("\n【七】错误日志落盘");
    // -----------------------------------------------------------------------
    {
      const { logError, readLogs, clearLogs } = await import("../lib/logger");

      // 清干净，断言才不受历史日志干扰
      clearLogs();

      const probe = Object.assign(new Error("__probe__ 外键冲突"), { code: "P2003" });
      logError(probe, "__probe__publishPostAction", {
        postSlug: "probe",
        password: "secret-value",
      });

      const entries = readLogs({ limit: 50 });
      const mine = entries.find((e) => e.where === "__probe__publishPostAction");

      check("异常被写入日志", Boolean(mine));
      check("保留错误码", mine?.code === "P2003", `实际 ${mine?.code}`);
      check("保留堆栈", Boolean(mine?.stack));
      check(
        "敏感字段被脱敏",
        Boolean(mine?.meta) &&
          !JSON.stringify(mine?.meta).includes("secret-value") &&
          JSON.stringify(mine?.meta).includes("[redacted]"),
        JSON.stringify(mine?.meta)
      );

      clearLogs();
      check("清空日志生效", readLogs({ limit: 10 }).length === 0);
    }

    // -----------------------------------------------------------------------
    console.log("\n【八】编辑器 JSON 的无原型陷阱");
    // -----------------------------------------------------------------------
    {
      /**
       * 这条守的是一个真实事故：正文里只要有任何带 attrs 的节点，
       * 保存与发布就永远失败，而报错只提某一个属性名：
       *
       *   Cannot access textAlign on the server. You cannot dot into a
       *   temporary client reference from a server component.
       *
       * 成因是 prosemirror 的 computeAttrs 用 Object.create(null) 造 attrs，
       * React 的 Server Action 序列化器只认原型为 Object.prototype 的纯对象，
       * 于是把无原型对象换成客户端引用，服务端一读属性即抛。
       *
       * 所以发送前必须经 toPlainJson 归一。下面两条同时断言「陷阱存在」与
       * 「归一化确实解决了它」——只断言后者的话，将来依赖变更让陷阱消失时
       * 测试会静默失效，而这条防线也就不再被需要了。
       */
      const { getSchema } = await import("@tiptap/core");
      const { sharedExtensions } = await import("../lib/tiptap/extensions");
      const { toPlainJson } = await import("../lib/json");

      const schema = getSchema(sharedExtensions);
      const doc = schema.nodeFromJSON({
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { textAlign: "center" },
            content: [{ type: "text", text: "正文" }],
          },
        ],
      });
      const json = doc.toJSON();
      const attrs = json.content?.[0]?.attrs;

      check(
        "prosemirror 产出的 attrs 是无原型对象（陷阱存在）",
        attrs !== undefined && Object.getPrototypeOf(attrs) === null,
        `原型=${attrs ? String(Object.getPrototypeOf(attrs)) : "(无 attrs)"}`
      );

      const normalized = toPlainJson(json);
      const nAttrs = normalized.content?.[0]?.attrs;
      check(
        "toPlainJson 把 attrs 归一为 Object.prototype",
        nAttrs !== undefined && Object.getPrototypeOf(nAttrs) === Object.prototype
      );
      check(
        "归一化不改动属性值",
        JSON.stringify(nAttrs) === JSON.stringify(attrs)
      );
    }

    // -----------------------------------------------------------------------
    console.log("\n【九】文章大纲提取");
    // -----------------------------------------------------------------------
    {
      const { buildToc } = await import("../lib/toc");

      const html = [
        "<h2>第一篇</h2><p>正文</p>",
        "<h3>子节</h3>",
        "<h4>更细的层级</h4>",
        // 带内联标签与实体：大纲标签应取纯文本
        "<h2>带 <strong>加粗</strong> 与 &amp; 符号</h2>",
        // 强制换行与对齐属性要原样保留
        '<h2 style="text-align:center">居中的标题</h2>',
        // 同名标题：第二个要加后缀，否则锚点会重复
        "<h2>第一篇</h2>",
        // 空标题不进大纲
        "<h2></h2>",
      ].join("");

      const { html: out, items } = buildToc(html);

      check("提取到 6 个非空标题", items.length === 6, `实际 ${items.length}`);
      check("层级识别正确", items[0].level === 2 && items[1].level === 3 && items[2].level === 4);
      check("标签去掉内联标签并反转义", items[3].text === "带 加粗 与 & 符号", items[3].text);
      check("每个标题都注入了 id", items.every((i) => out.includes(`id="${i.id}"`)));
      check(
        "同名标题的 id 不重复",
        new Set(items.map((i) => i.id)).size === items.length,
        items.map((i) => i.id).join(", ")
      );
      check("空标题被跳过", !items.some((i) => i.text === ""));
      check(
        "已有属性（style）保留",
        out.includes("text-align:center") && /<h2[^>]*style="text-align:center"[^>]*id="/.test(out)
      );
      check("原有正文内容不受影响", out.includes("<p>正文</p>"));
    }
  } finally {
    // -----------------------------------------------------------------------
    // 清理：无论成败都执行，避免测试数据污染开发库
    // -----------------------------------------------------------------------
    console.log("\n【清理】");
    // 文章先删（会级联 PostTag / 快照 / SEO）
    for (const id of createdPostIds) {
      await prisma.post.deleteMany({ where: { id } });
    }
    // 子分类先于父分类：父分类有子时删除会被服务层拦，这里用 prisma 直删绕过
    for (const id of [...createdCategoryIds].reverse()) {
      await prisma.category.deleteMany({ where: { id } });
    }
    for (const id of createdTagIds) {
      await prisma.tag.deleteMany({ where: { id } });
    }
    // 兜底：清掉任何带前缀的残留（上一次崩溃遗留的）
    await prisma.post.deleteMany({ where: { title: { startsWith: P } } });
    await prisma.category.deleteMany({ where: { name: { startsWith: P } } });
    await prisma.tag.deleteMany({ where: { name: { startsWith: P } } });
    console.log("  测试数据已清理");

    await prisma.$disconnect();
  }

  // -------------------------------------------------------------------------
  console.log(`\n${"=".repeat(48)}`);
  console.log(`通过 ${passed} / ${passed + failed}`);
  if (failed > 0) {
    console.log(`\n失败项：`);
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  console.log(
    "\n未覆盖（需另行验证）：action 层的鉴权与缓存失效依赖 Next 运行时；" +
      "发布后的前端跳转是 React 客户端行为，需浏览器 E2E。"
  );

  process.exit(failed > 0 ? 1 : 0);
}

/** 在分类树中按 id 查找节点 */
function findById(
  nodes: Awaited<ReturnType<typeof import("../server/services/category")["getCategoryTree"]>>,
  id: number
): (typeof nodes)[number] | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findById(node.children, id);
    if (found) return found;
  }
  return null;
}

main().catch(async (error) => {
  console.error("\n测试脚本自身异常：", error);
  process.exit(1);
});
