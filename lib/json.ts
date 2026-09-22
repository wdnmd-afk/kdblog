/**
 * 发送给 Server Action 前的 JSON 归一化。
 *
 * 背景：Tiptap / prosemirror 的 `Node.toJSON()` 返回的 `attrs` 是
 * `Object.create(null)` 建出来的**无原型对象**。
 *
 * React 的 Server Action 参数序列化器判断「纯对象」时要求原型是 `Object.prototype`，
 * 无原型对象不被认作可序列化，会被替换成 temporary client reference。
 * 服务端拿到后一读属性就抛：
 *
 *     Cannot access textAlign on the server. You cannot dot into a temporary
 *     client reference from a server component.
 *
 * 由于 prosemirror 的 computeAttrs 会遍历全部属性（含 TextAlign 这类全局属性），
 * 只要正文里有任何带 attrs 的节点就会踩中——表现为「保存/发布永远失败」，
 * 且错误信息只指向某一个属性名，与真实原因相距很远。
 *
 * JSON 往返会把原型归一为 `Object.prototype`，同时自然丢弃函数与 undefined，
 * 正是这里需要的效果。
 */
export function toPlainJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
