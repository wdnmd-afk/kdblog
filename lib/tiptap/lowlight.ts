import { common, createLowlight } from "lowlight";

/**
 * lowlight 单例。
 *
 * 编辑器（ProseMirror 装饰器着色）与服务端落库前的高亮必须共用同一个实例：
 * 各建一份会让注册的语言集合出现分叉，"编辑器里高亮了、发布后没有" 这类
 * 问题排查起来毫无线索。
 *
 * 用 common 预设（实测 37 种语言）而非 all（190+）：all 会显著增大包体，
 * 而博客代码块的语种分布很集中。未注册的语言不会报错——调用方会跳过。
 */
export const lowlight = createLowlight(common);

/**
 * 常见语言的中文名。
 *
 * 键必须与 lowlight 实际注册的标识一致，未列出的直接用英文标识兜底。
 * 这里刻意不写 lowlight 没注册的别名（如 js、ts、sh）——那些由下面的
 * LANGUAGE_ALIASES 负责归一，混在一起会让 select 出现选不中的空选项。
 */
const LANGUAGE_LABELS: Record<string, string> = {
  arduino: "Arduino",
  bash: "Bash",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  css: "CSS",
  diff: "Diff",
  go: "Go",
  graphql: "GraphQL",
  ini: "INI",
  java: "Java",
  javascript: "JavaScript",
  json: "JSON",
  kotlin: "Kotlin",
  less: "Less",
  lua: "Lua",
  makefile: "Makefile",
  markdown: "Markdown",
  objectivec: "Objective-C",
  perl: "Perl",
  php: "PHP",
  "php-template": "PHP 模板",
  plaintext: "纯文本",
  python: "Python",
  "python-repl": "Python REPL",
  r: "R",
  ruby: "Ruby",
  rust: "Rust",
  scss: "SCSS",
  shell: "Shell",
  sql: "SQL",
  swift: "Swift",
  typescript: "TypeScript",
  vbnet: "VB.NET",
  wasm: "WebAssembly",
  xml: "XML",
  yaml: "YAML",
};

/**
 * 语言选择器的候选项。
 *
 * 从 lowlight 实际注册的语言派生，而不是手写一份：手写清单与注册集合
 * 一旦不同步，用户选中一个没注册的语言就会命中跳过分支，表现为"选了语言
 * 但没高亮"，且没有任何报错。
 */
export const CODE_LANGUAGES: { value: string; label: string }[] = lowlight
  .listLanguages()
  .map((name) => ({ value: name, label: LANGUAGE_LABELS[name] ?? name }))
  .sort((a, b) => a.label.localeCompare(b.label, "zh-Hans-CN"));

/**
 * 语言名归一化。
 *
 * Tiptap 的代码块把语言存在 language 属性里，而粘贴或历史内容里的写法
 * 可能是大写、带别名（js / ts / sh / py）或指向 lowlight 不认识的 XML 方言
 * （html / vue）。归一到 lowlight 认识的标识，认不出来返回空串，
 * 由调用方跳过高亮而不是抛异常。
 */
const LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  sh: "bash",
  zsh: "bash",
  py: "python",
  rb: "ruby",
  yml: "yaml",
  "c++": "cpp",
  "c#": "csharp",
  cs: "csharp",
  "objective-c": "objectivec",
  objc: "objectivec",
  html: "xml",
  vue: "xml",
  text: "plaintext",
  txt: "plaintext",
  // 中文标签可能被写进 language 属性（历史数据或手工编辑），一并兜住
  纯文本: "plaintext",
};

export function normalizeLanguage(language: string | null | undefined): string {
  if (!language) return "";
  const lower = language.trim().toLowerCase();
  const resolved = LANGUAGE_ALIASES[lower] ?? lower;
  return lowlight.listLanguages().includes(resolved) ? resolved : "";
}
