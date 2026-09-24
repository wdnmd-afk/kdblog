import { Marked } from "marked";

/**
 * Markdown -> HTML。
 *
 * 这是导入链路的第一段：MD -> HTML -> Tiptap JSON。走 HTML 中转而不是直接
 * 生成 Tiptap JSON，是因为 Tiptap 的每个扩展都自带 parseHTML 规则，
 * HTML 是它官方支持的输入格式；手写 MD token 到 JSON 的映射等于把这些规则
 * 重写一遍，而且每次新增扩展都要再补一次。
 *
 * ⚠ 本模块产出的 HTML 是**不可信的**：它来自用户上传的文件，可能带
 * 内联脚本、事件属性、javascript: 伪协议。绝不能直接渲染或落库，
 * 必须先经 generateJSON 过一遍 Tiptap schema（白名单外的节点被丢弃），
 * 最终落库前还要经 renderContentHtml 的 sanitize。
 *
 * 本模块不含服务端专用 import，客户端与服务端都能引用。
 */

/**
 * marked 实例。
 *
 * 用 new Marked() 而非全局 marked：全局实例的配置是进程级共享的，
 * 将来若别处也用 marked 会互相覆盖选项。
 *
 * gfm 打开以支持表格、删除线、任务清单；breaks 保持关闭——
 * MD 的标准语义里单个换行不是 <br>，打开会让从别处复制来的、
 * 按 80 字符硬折行的文档变成一堆断行。
 */
const marked = new Marked({
  gfm: true,
  breaks: false,
});

/**
 * 标题层级映射。
 *
 * 本项目正文只开放 h2~h4（h1 留给文章标题本身，见 extensions.ts 的说明），
 * 而 MD 文档普遍用 `#` 写主标题。实测确认：直接把 h1 交给 generateJSON，
 * Tiptap 会因 schema 不认这个层级而**静默降级成普通段落**——整篇文档的
 * 标题结构就这么没了，且不报任何错。
 *
 * 用「钳制」而非「整体下移」：下移会把 h4 挤成 h5，而 h5 同样不在 schema 里，
 * 又变成段落——修好了浅层却弄坏了深层。钳制保证任何输入都落在 2~4 之内，
 * 代价是深层标题之间的层级差会被压平（h4/h5/h6 都成 h4）。
 * 这是有意的取舍：压平层级只是结构变浅，退化成段落则是彻底丢失语义。
 */
const HEADING_MAP: Record<number, number> = { 1: 2, 2: 2, 3: 3, 4: 4, 5: 4, 6: 4 };

/** 匹配开闭标签成对的 h1~h6 */
const HEADING_PATTERN = /<(\/?)h([1-6])([^>]*)>/g;

/**
 * 把超出范围的标题钳到 h2~h4。
 *
 * 用正则而非解析 DOM：输入是 marked 的输出，标题标签形态固定
 * （`<h1>` 或带 id 的 `<h1 id="...">`），不存在嵌套标题这种需要真正
 * 语法分析的情况。
 */
function clampHeadings(html: string): string {
  return html.replace(HEADING_PATTERN, (_whole, slash: string, level: string, attrs: string) => {
    const mapped = HEADING_MAP[Number(level)] ?? 4;
    return `<${slash}h${mapped}${attrs}>`;
  });
}

/**
 * GFM 任务清单还原。
 *
 * marked 的 GFM 任务清单产出的是
 *   `<ul><li><input type="checkbox" checked> 文本</li></ul>`
 * 而 Tiptap 的 TaskList 扩展靠 `data-type="taskList"` / `data-type="taskItem"`
 * 识别节点。实测确认：不补这两个属性，任务清单会退化成**普通无序列表**，
 * 复选框与勾选状态全部丢失。
 *
 * 补上属性后实测可完整还原，包含 checked 状态。
 *
 * 判断依据是「li 内是否以 checkbox 开头」而非整个 ul：GFM 允许同一个列表里
 * 混着任务项与普通项，整体替换会把普通项也标成 taskItem，那些项在 Tiptap
 * 里会渲染出一个没有语义的空复选框。
 *
 * ⚠ 必须容忍 `<li>` 与 `<input>` 之间夹一层 `<p>`：
 * 列表项之间有空行时（即 MD 的「松散列表」），marked 会把每项内容包进段落，
 * 输出 `<li><p><input ...> 文本</p></li>`。松散列表是合法且常见的写法——
 * 导出时若在任务项与普通项之间留了空行就会产生这种形态。
 * 早期版本的正则要求两者紧邻，一旦夹了 `<p>` 就匹配不到，
 * 整个任务清单静默退化成普通列表（端到端测试实际踩到过这个坑）。
 */
const TASK_ITEM_PATTERN =
  /<li([^>]*)>(\s*<p>)?\s*<input([^>]*?)type="checkbox"([^>]*?)>/g;

function restoreTaskLists(html: string): string {
  // 先给含复选框的 li 打标记，顺带把 input 的 disabled 去掉
  // （marked 默认输出 disabled，Tiptap 需要可交互的复选框）
  let out = html.replace(
    TASK_ITEM_PATTERN,
    (
      _whole,
      liAttrs: string,
      paragraphOpen: string | undefined,
      before: string,
      after: string
    ) => {
      const checked = /checked/.test(before) || /checked/.test(after);
      // 原样保留 <p>：删掉它会让闭合的 </p> 变成孤儿标签，
      // 而 Tiptap 的 taskItem 本来就允许段落作为内容
      return `<li${liAttrs} data-type="taskItem" data-checked="${checked}">${
        paragraphOpen ?? ""
      }<input type="checkbox"${checked ? " checked" : ""}>`;
    }
  );

  /*
   * 再把包含 taskItem 的 ul 标成 taskList。
   *
   * 从后往前逐个 ul 处理会很绕，这里改用一次性判断：只要文档里出现了
   * taskItem，就给「直接包含它的」ul 加属性。用非贪婪匹配限定在单个列表内，
   * 避免嵌套列表时把外层 ul 也标记上。
   */
  if (out.includes('data-type="taskItem"')) {
    out = out.replace(/<ul>(\s*<li[^>]*data-type="taskItem")/g, '<ul data-type="taskList">$1');
  }

  return out;
}

/**
 * 转换 Markdown 为 HTML。
 *
 * 同步执行：marked 的 parse 在不注册异步扩展时是同步的，
 * 这样调用方（包括客户端预览）不必处理 Promise。
 */
export function markdownToHtml(markdown: string): string {
  // marked 的类型签名因支持异步扩展而包含 Promise，但同步配置下返回的是 string
  const raw = marked.parse(markdown) as string;
  return restoreTaskLists(clampHeadings(raw));
}
