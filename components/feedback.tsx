"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, Check, Info, X } from "lucide-react";

import { Button, cx } from "./ui";

/**
 * 全局反馈层：Toast 通知 + 确认对话框。
 *
 * 建立这层的原因有两个：
 *
 * 1. 原生 confirm() 会阻塞主线程、样式不可控、移动端表现差，且无法承载
 *    「危险操作要说清后果」这类多行文案。
 * 2. 操作结果原先由每个组件各自 useState 存一条 message 就地渲染，
 *    位置、样式、消失时机各不相同，同一次操作在不同页面反馈形态不一致。
 *
 * 两者都收敛到 Provider 里，业务组件只调 toast() / confirm()。
 */

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

type ToastTone = "success" | "error" | "info";

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ConfirmOptions {
  title: string;
  /** 说明后果。危险操作必须写清是否可恢复 */
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 危险操作用实心按钮强调，普通确认用描边 */
  danger?: boolean;
}

interface FeedbackApi {
  toast: (message: string, tone?: ToastTone) => void;
  /** 返回 Promise<boolean>，用法与原生 confirm 一致但不阻塞 */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const FeedbackContext = createContext<FeedbackApi | null>(null);

/**
 * 取反馈 API。
 *
 * 刻意不做「Provider 缺失时降级为 alert」的兜底：那样问题会被藏起来，
 * 直到用户在生产环境看到裸弹窗才暴露。缺 Provider 属于装配错误，应当立刻报错。
 */
export function useFeedback(): FeedbackApi {
  const ctx = useContext(FeedbackContext);
  if (!ctx) {
    throw new Error("useFeedback 必须在 <FeedbackProvider> 内使用");
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/** Toast 自动消失时间。错误停留更久，用户需要时间读完 */
const TOAST_DURATION: Record<ToastTone, number> = {
  success: 2600,
  info: 3000,
  error: 5000,
};

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<
    (ConfirmOptions & { resolve: (ok: boolean) => void }) | null
  >(null);

  // 自增 id 用 ref 而非 state：它只是身份标记，变化不需要触发渲染
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /**
   * 只把 toast 放进队列，**不在这里起自动消失的定时器**。
   *
   * 计时改由 ToastCard 挂载后开始，这是本次修 bug 的关键。业务侧的调用
   * 几乎都长这样：
   *
   *     startTransition(async () => {
   *       const result = await action();
   *       toast("已取消发布", "success");
   *       router.refresh();        // 与上面的 toast 在同一个 transition 里
   *     });
   *
   * router.refresh() 会让整个 transition 挂起到新的 RSC 树到达才提交，而
   * toast 的 setState 也在同一个 transition 中。若在这里就起表，倒计时会在
   * toast 还没被渲染出哪怕一帧时就跑完，把它从队列里删掉——表现就是
   * 「操作明明成功了，屏幕上却什么提示都没有」，且冷编译或慢查询时必现。
   *
   * 挂载后才起表，无论 transition 挂起多久，提示都能完整显示设定的时长。
   */
  const toast = useCallback((message: string, tone: ToastTone = "success") => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, tone, message }]);
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({ ...options, resolve });
    });
  }, []);

  const api = useMemo<FeedbackApi>(() => ({ toast, confirm }), [toast, confirm]);

  function settle(ok: boolean) {
    confirmState?.resolve(ok);
    setConfirmState(null);
  }

  return (
    <FeedbackContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      {confirmState && (
        <ConfirmDialog
          options={confirmState}
          onConfirm={() => settle(true)}
          onCancel={() => settle(false)}
        />
      )}
    </FeedbackContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

const TOAST_ICONS: Record<ToastTone, typeof Check> = {
  success: Check,
  error: AlertTriangle,
  info: Info,
};

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    /**
     * aria-live="polite" 让读屏软件在当前朗读结束后播报，不打断用户操作；
     * 用 assertive 会打断输入，反馈类信息不值得这么强的优先级。
     *
     * z-toast 用具名 token 而非裸 z-50：层级关系集中在 globals.css 可读，
     * 且提示必须盖在抽屉与弹窗（z-modal）之上——在设置抽屉里触发的错误
     * 若被抽屉挡住，等于没提示。
     */
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-toast flex flex-col items-center gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      {toasts.map((item) => (
        <ToastCard key={item.id} item={item} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

/**
 * 单条提示。
 *
 * 独立成组件只为一件事：让自动消失的计时从**挂载后**开始，而不是从
 * toast() 被调用时开始。原因见 FeedbackProvider.toast 的说明——调用点
 * 普遍身处一个会被 router.refresh() 挂起的 transition 中，在那里起表
 * 会让提示在首次绘制前就被删掉。
 */
function ToastCard({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: (id: number) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(item.id), TOAST_DURATION[item.tone]);
    return () => clearTimeout(timer);
    // item.id 唯一标识一条提示，tone 与 message 不会在其生命周期内变化，
    // 因此这个表只在挂载时起一次
  }, [item.id, item.tone, onDismiss]);

  const Icon = TOAST_ICONS[item.tone];

  return (
    <div
      role="status"
      className={cx(
        "pointer-events-auto flex w-full max-w-md items-start gap-2.5 rounded-panel px-3.5 py-2.5 text-sm shadow-panel",
        // 进场动画顺带确认「提示真的出现了」，这在快速连续操作时尤其有用
        "animate-fade-in",
        // 全站无彩色，成功/错误靠填充深浅区分：错误用实心反白强调
        item.tone === "error"
          ? "bg-ink-900 text-white"
          : "border border-ink-200 bg-white text-ink-800"
      )}
    >
      <Icon
        size={16}
        className={cx("mt-0.5 shrink-0", item.tone === "error" ? "text-white" : "text-ink-500")}
      />
      <p className="min-w-0 flex-1 leading-relaxed">{item.message}</p>
      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        aria-label="关闭提示"
        className={cx(
          "-mr-1 -mt-0.5 shrink-0 cursor-pointer rounded p-1 transition-colors",
          item.tone === "error"
            ? "text-white/60 hover:bg-white/10 hover:text-white"
            : "text-ink-400 hover:bg-ink-100 hover:text-ink-900"
        )}
      >
        <X size={14} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 确认对话框
// ---------------------------------------------------------------------------

function ConfirmDialog({
  options,
  onConfirm,
  onCancel,
}: {
  options: ConfirmOptions;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  // 打开即聚焦确认按钮，回车可直接确认、Esc 取消，键盘用户不必 Tab 找按钮
  useEffect(() => {
    confirmRef.current?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      {/* 遮罩点击即取消，与 Esc 行为一致 */}
      <div
        className="absolute inset-0 bg-ink-950/25"
        onClick={onCancel}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="relative w-full max-w-sm rounded-panel bg-white p-5 shadow-panel"
      >
        <h2 id="confirm-title" className="text-base font-semibold text-ink-900">
          {options.title}
        </h2>
        {options.description && (
          <p className="mt-2 text-sm leading-relaxed text-ink-600">{options.description}</p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onCancel}>{options.cancelLabel ?? "取消"}</Button>
          <Button
            ref={confirmRef}
            variant={options.danger ? "primary" : "secondary"}
            onClick={onConfirm}
          >
            {options.confirmLabel ?? "确定"}
          </Button>
        </div>
      </div>
    </div>
  );
}
