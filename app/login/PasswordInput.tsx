"use client";

import { Eye, EyeOff, Lock } from "lucide-react";
import { useState } from "react";

/**
 * 密码输入框。
 *
 * 单独拆成客户端组件只为了明文切换这一个状态：登录页其余部分需要读 session，
 * 保持在服务端渲染更省一次往返。
 */
export function PasswordInput() {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Lock
        size={16}
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"
      />
      <input
        id="password"
        name="password"
        type={visible ? "text" : "password"}
        required
        autoComplete="current-password"
        placeholder="密码"
        aria-label="密码"
        className="h-11 w-full rounded-panel border border-ink-200 bg-white pl-9 pr-10 text-sm text-ink-900 transition-colors placeholder:text-ink-400 hover:border-ink-300 focus:border-ink-900 focus:outline-none"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        title={visible ? "隐藏密码" : "显示密码"}
        aria-label={visible ? "隐藏密码" : "显示密码"}
        className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-panel text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-900"
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}
