/**
 * 提示块（Callout）的四种语气。
 *
 * 单独成模块而不是写在 callout.ts 里：节点定义会因为引入 NodeView 而带上
 * 客户端依赖，而语气元数据（标签、色值）在样式与前台展示层也可能被引用，
 * 混在一起会把这些引用一起拖进不该进的地方。
 */

export type CalloutTone = "info" | "warning" | "success" | "danger";

/** 语气顺序即选择器里的排列顺序，由轻到重 */
export const CALLOUT_TONES: CalloutTone[] = ["info", "warning", "success", "danger"];

export const CALLOUT_TONE_LABEL: Record<CalloutTone, string> = {
  info: "提示",
  warning: "注意",
  success: "成功",
  danger: "警告",
};

/** 新建提示块时的默认语气。四种里最中性的一种 */
export const DEFAULT_CALLOUT_TONE: CalloutTone = "info";

/**
 * 校验任意字符串是否为合法语气。
 *
 * 解析外部 HTML（版本快照、粘贴内容）时属性值不受控，
 * 不校验就会把非法值写进节点，样式匹配不到，块会渲染成一片空白。
 */
export function isCalloutTone(value: unknown): value is CalloutTone {
  return typeof value === "string" && (CALLOUT_TONES as string[]).includes(value);
}
