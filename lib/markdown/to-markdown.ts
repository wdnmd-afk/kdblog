import TurndownService from "turndown";
// @ts-expect-error 该包无类型声明，且 @types 生态里没有对应包
import { gfm } from "turndown-plugin-gfm";

/**
 * HTML -> Markdown。
 *
 * 这是导出链路的第二段：Tiptap JSON -> HTML -> MD。第一段（generateHTML）
 * 只能在服务端跑（依赖 happy-dom），因此导出整体是服务端行为。
 *
 * 本模块本身不含服务端专用 import，但没有必要在客户端使用——
 * 客户端拿不到 generateHTML 的产物。
 *
 * 转换原则：**宁可结构变浅，不可内容丢失**。项目的三个自定义节点
 * （提示块、折叠块、任务清单）在标准 MD 里没有对应语法，一律降级为
 * 最接近的标准写法，而不是原样输出 HTML——后者在别的 MD 编辑器里
 * 会显示成一堆标签源码。
 */

/**
 * turndown 实例。
 *
 * 配置说明：
 * - headingStyle: atx  用 `## 标题` 而非下划线式，前者是当下的通行写法
 * - codeBlockStyle: fenced  用 ``` 围栏而非四空格缩进，围栏能带语言标记
 * - bulletListMarker: "-"  与 GFM 任务清单的 `- [ ]` 保持同一个符号
 * - emDelimiter: "_"  斜体用下划线，避免与粗体的 ** 在嵌套时产生 ***
 */
function createTurndown(): TurndownService {
  const service = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "_",
    strongDelimiter: "**",
    /*
     * 不覆写 blankReplacement。
     *
     * 它原本写成 `node.isBlock ? "\n\n" : ""`，但这与 turndown 的内置默认
     * （见其源码 defaults.blankReplacement）逐字相同——是一份毫无作用的
     * 重复实现。而且它还引入了一个类型错误：@types/turndown 把节点标成
     * 浏览器的 HTMLElement，而 isBlock 是 turndown 在运行时挂到 domino
     * 元素上的自有属性，类型里并不存在。
     *
     * 用默认值既省掉这段，也避开类型与运行时的这处不一致。
     */
  });

  /*
   * GFM 插件提供表格、删除线、任务清单的转换规则。
   *
   * 必须加：turndown 核心只覆盖 CommonMark，没有表格规则——
   * 不加这个插件，表格会被拆成一串裸文字，列结构完全丢失。
   */
  service.use(gfm);

  /*
   * 自定义规则必须在 gfm 之后注册。
   *
   * turndown 的规则查找是「后注册优先」，任务清单与表格单元格的规则要覆盖
   * gfm 插件的同类规则，注册早了会被插件的版本盖掉。
   */
  addCalloutRule(service);
  addDetailsRule(service);
  addCodeBlockRule(service);
  addTaskListRule(service);
  addTableCellRule(service);

  return service;
}

/**
 * 提示块 -> 引用块。
 *
 * MD 没有提示块语法。降级为引用块并在首行标注语气（`> **提示**`），
 * 这样语义以文字形式保留下来，重新导入时至少还是个引用块。
 *
 * 不输出 `:::info` 这类容器语法：它是各家扩展各自定义的，
 * 在标准 MD 解析器里就是一行普通文字。
 */
const TONE_LABELS: Record<string, string> = {
  info: "提示",
  success: "成功",
  warning: "注意",
  danger: "警告",
};

function addCalloutRule(service: TurndownService) {
  service.addRule("callout", {
    filter: (node) =>
      node.nodeName === "DIV" && node.getAttribute("data-type") === "callout",
    replacement: (content, node) => {
      const tone = (node as HTMLElement).getAttribute("data-tone") ?? "info";
      const label = TONE_LABELS[tone] ?? TONE_LABELS.info;
      const body = content.trim().replace(/^/gm, "> ");
      return `\n\n> **${label}**\n>\n${body}\n\n`;
    },
  });
}

/**
 * 折叠块 -> 粗体标题 + 正文。
 *
 * MD 没有折叠语法（GitHub 上常见的写法其实是内嵌 HTML 的 <details>）。
 * 降级为「粗体的摘要行 + 展开后的内容」：折叠这个交互没了，
 * 但两部分文字都在，且在任何 MD 阅读器里都能正常显示。
 */
function addDetailsRule(service: TurndownService) {
  service.addRule("detailsSummary", {
    filter: (node) => node.nodeName === "SUMMARY",
    replacement: (content) => `\n\n**${content.trim()}**\n\n`,
  });

  service.addRule("details", {
    filter: (node) => node.nodeName === "DETAILS",
    replacement: (content) => `\n\n${content.trim()}\n\n`,
  });
}

/**
 * 代码块 -> 带语言标记的围栏。
 *
 * 覆盖 turndown 默认规则的原因：默认规则从 `<code>` 的 class 里取
 * `language-xxx`，但本项目的代码块经 lowlight 高亮后，内部嵌了一层层
 * `<span class="hljs-keyword">`。默认规则会把这些 span 的文本连起来，
 * 虽然文字不丢，但**换行会丢**——多行代码被压成一行。
 *
 * 这里改用 textContent 直取纯文本，换行得以保留。
 */
function addCodeBlockRule(service: TurndownService) {
  service.addRule("fencedCodeBlock", {
    filter: (node) =>
      node.nodeName === "PRE" &&
      node.firstChild !== null &&
      node.firstChild.nodeName === "CODE",
    replacement: (_content, node) => {
      const code = node.firstChild as HTMLElement;
      const className = code.getAttribute("class") ?? "";
      const language = /language-([\w-]+)/.exec(className)?.[1] ?? "";
      // textContent 跳过所有高亮 span，直接拿到原始代码（含换行）
      const text = code.textContent ?? "";
      // 去掉尾部换行：围栏本身会补一个，否则代码末尾多出一行空白
      return `\n\n\`\`\`${language}\n${text.replace(/\n$/, "")}\n\`\`\`\n\n`;
    },
  });
}

/**
 * 任务清单 -> GFM 的 `- [x]` 写法。
 *
 * 为什么 gfm 插件的规则不够用：它期望的是 `<li><input type="checkbox">文本</li>`，
 * 而 Tiptap 的 TaskItem 产出的是
 *   `<li data-checked="true"><label><input><span></span></label><div><p>文本</p></div></li>`
 * 复选框被包在 <label> 里、文本被包在 <div><p> 里，插件的 filter 匹配不到，
 * 于是整个清单退化成普通无序列表——实测确认勾选状态全部丢失。
 *
 * 这里直接认 `data-checked` 属性：它是 TaskItem 的稳定输出（sanitize 白名单
 * 里也登记了），比嗅探内部 DOM 结构可靠。
 */
function addTaskListRule(service: TurndownService) {
  service.addRule("taskItem", {
    filter: (node) =>
      node.nodeName === "LI" && node.hasAttribute("data-checked"),
    replacement: (content, node) => {
      const checked = (node as HTMLElement).getAttribute("data-checked") === "true";
      /*
       * content 是子节点转换后的结果，含 <label> 留下的空白与 <div><p> 产生的
       * 换行。压成单行：任务项的文本在 MD 里必须与 `- [x]` 同行，
       * 换行会让后续文字变成独立段落，脱离列表。
       */
      const text = content.replace(/\s+/g, " ").trim();

      /*
       * 末尾只补一个换行，且**不**在项间留空行。
       *
       * 任务清单必须输出为「紧凑列表」。一旦项与项之间出现空行，MD 就成了
       * 松散列表，marked 会把每项内容包进 <p>，再导入时 `<li>` 与 `<input>`
       * 不再相邻——任务清单会静默退化成普通列表，勾选状态全丢
       * （见 to-html.ts 里 TASK_ITEM_PATTERN 的说明）。
       */
      return `- [${checked ? "x" : " "}] ${text}\n`;
    },
  });

  /**
   * 同一个列表里的普通 `<li>`。
   *
   * 不能只管任务项：Tiptap 会把「任务项 + 普通项」的混排列表拆成
   * taskList 与 bulletList 两个节点，但它们在 MD 里仍是相邻的两段列表。
   * 上面的 taskItem 规则输出紧凑格式，而 gfm 插件给普通 listItem 的
   * 格式带额外间距，两者相接处会裂出一个空行 + 四空格缩进的怪异输出：
   *
   *     - [x] 任务
   *
   *     -   普通项
   *
   * 那个空行正是把紧凑列表变成松散列表的元凶。这里用同一套紧凑格式覆盖，
   * 保证整段列表的写法一致。
   *
   * 嵌套列表靠给子内容加缩进处理——不做这层缩进，子列表会与父项平级，
   * 层级结构丢失。
   */
  service.addRule("compactListItem", {
    /*
     * 必须显式排除任务项。
     *
     * turndown 的规则查找是「后注册优先」，本规则注册在 taskItem 之后，
     * 若用 filter: "li" 就会把任务项也吃掉——`- [x]` 退化成 `-`，
     * 勾选状态直接消失。带 data-checked 的一律让给上面那条规则。
     */
    filter: (node) => node.nodeName === "LI" && !node.hasAttribute("data-checked"),
    replacement: (content, node) => {
      const text = content
        // 去掉首尾空白，再把内部的换行统一缩进 2 格（嵌套列表的子项）
        .replace(/^\n+/, "")
        .replace(/\n+$/, "")
        .replace(/\n/gm, "\n  ");

      const parent = node.parentNode;
      const marker =
        parent?.nodeName === "OL"
          ? // 有序列表要算出自己是第几项。start 属性允许从非 1 开始
            `${
              Number((parent as HTMLElement).getAttribute("start") ?? 1) +
              Array.prototype.indexOf.call(parent.children, node)
            }. `
          : "- ";

      return `${marker}${text}\n`;
    },
  });
}

/**
 * 表格单元格内的块级元素拆平。
 *
 * Tiptap 的表格单元格内容是 `<td><p>文本</p></td>`（ProseMirror 的 schema
 * 要求单元格内必须是块级节点）。而 turndown 处理 <p> 时会补上 `\n\n`，
 * 于是单元格内容被换行撑开，输出成
 *   `| \n\n文本\n\n |`
 * MD 的表格语法要求整行在一行内，实测确认这会让表格彻底失效——
 * 而且往返导入时 marked 认不出它，表格会退化成原始 HTML 块。
 *
 * 解决办法是给单元格内的段落单独一条规则：只在单元格上下文里，
 * 把 <p> 当作行内元素处理，不补换行。
 */
function addTableCellRule(service: TurndownService) {
  service.addRule("tableCellParagraph", {
    filter: (node) => {
      if (node.nodeName !== "P") return false;
      const parent = node.parentNode;
      return parent !== null && (parent.nodeName === "TD" || parent.nodeName === "TH");
    },
    // 同一单元格内的多个段落用空格连接：MD 表格无法表达单元格内换行，
    // 硬保留换行会破坏整张表的语法
    replacement: (content) => content.replace(/\s+/g, " ").trim(),
  });
}

/** 模块级复用：turndown 实例的构造包含插件注册，不必每次调用都重建 */
const turndown = createTurndown();

/**
 * 去掉 <colgroup> 与 <col>。
 *
 * 这是让表格能被识别的必要预处理，原因在 gfm 插件的判定逻辑里：
 *
 * 它认为一个 <tr> 是表头行的条件之一是「它是所在 tbody 的第一个子元素，
 * 且该 tbody 的前一个兄弟不存在、或是空 thead」（见 isFirstTbody）。
 * 而 Tiptap 的 generateHTML 输出的表格是
 *   `<table><colgroup><col>…</colgroup><tbody><tr><th>…`
 * tbody 的前一个兄弟是 colgroup，两个条件都不满足，于是整张表被判定为
 * 「没有表头行」，插件走 keep 分支**原样输出 HTML**——MD 里出现一整块
 * `<table style="min-width: 50px">…`，列结构与本文档的表格语义全部失效。
 *
 * sansitize 之后 colgroup 本就会被剥掉（白名单里没有它），所以走发布链路
 * 的 HTML 不受影响；但导出不应依赖调用方先 sanitize 过，在这里统一抹掉
 * 更稳妥。colgroup 只承载列宽，而 GFM 表格语法本来就表达不了列宽，
 * 丢弃无信息损失。
 */
function stripColgroup(html: string): string {
  return html.replace(/<colgroup>[\s\S]*?<\/colgroup>|<col[^>]*\/?>/gi, "");
}

export function htmlToMarkdown(html: string): string {
  return (
    turndown
      .turndown(stripColgroup(html))
      // 收敛三行以上的连续空行为两行：各条规则各自补 \n\n，相邻时会叠加
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}
