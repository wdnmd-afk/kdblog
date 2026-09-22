import "dotenv/config";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * 用无头 Chrome 测量任务清单里复选框与文字的垂直中心，判断到底差多少像素。
 *
 * 为什么写这个：前两轮我按"行高/外边距"推断着改，改完仍不对齐——没有测量就没有
 * 判断依据。这里让浏览器自己算，拿到真实数字。
 *
 * 执行：pnpm tsx scripts/measure-tasklist.ts [url]
 */

const URL_ = process.argv[2] ?? "http://localhost:3000/posts/agent-engineering-paths-32";
const PORT = 9333;

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];

/** 在页面里执行的测量表达式 */
const MEASURE = `(() => {
  const li = document.querySelector('ul[data-type="taskList"] li');
  if (!li) return { error: '页面上没有任务清单项', diag: {
    url: location.href,
    hasTiptap: !!document.querySelector('.tiptap'),
    taskListCount: document.querySelectorAll('ul[data-type="taskList"]').length,
    editorContentLen: (document.querySelector('.tiptap') || {}).innerHTML?.length ?? 0,
    bodyLen: document.body.innerHTML.length,
  } };

  const label = li.querySelector('label');
  const input = li.querySelector('input[type="checkbox"]');
  const p = li.querySelector('div > p');

  const box = (el) => { const b = el.getBoundingClientRect(); return { top: +b.top.toFixed(2), height: +b.height.toFixed(2) }; };
  const style = (el) => { const s = getComputedStyle(el); return {
    fontSize: s.fontSize, lineHeight: s.lineHeight, height: s.height,
    marginTop: s.marginTop, marginBottom: s.marginBottom,
    display: s.display, alignItems: s.alignItems,
  }; };

  const inputBox = box(input);
  const pBox = box(p);
  const pStyle = style(p);

  // 首行文字中心 = 段落顶部 + 行高的一半（单行段落时即字形中心）
  const lh = parseFloat(pStyle.lineHeight);
  const textFirstLineCenter = pBox.top + lh / 2;
  const inputCenter = inputBox.top + inputBox.height / 2;

  return {
    label: { box: box(label), style: style(label) },
    input: { box: inputBox, center: +inputCenter.toFixed(2) },
    paragraph: { box: pBox, style: pStyle, firstLineCenter: +textFirstLineCenter.toFixed(2) },
    // 正值表示复选框比文字高
    offsetPx: +(textFirstLineCenter - inputCenter).toFixed(2),
  };
})()`;

async function main() {
  const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!chromePath) throw new Error("没有找到 Chrome / Edge");

  const profile = mkdtempSync(join(tmpdir(), "kd-measure-"));
  const chrome = spawn(
    chromePath,
    [
      "--headless=new",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  const cleanup = () => {
    chrome.kill();
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      /* 忽略 */
    }
  };

  try {
    // 等 DevTools 端口就绪
    let targets: Array<{ webSocketDebuggerUrl: string }> | null = null;
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
        targets = (await res.json()) as Array<{ webSocketDebuggerUrl: string }>;
        if (targets.length) break;
      } catch {
        /* 还没起来 */
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!targets?.length) throw new Error("DevTools 端口未就绪");

    const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map<number, (v: unknown) => void>();
    const events: string[] = [];

    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data)) as {
        id?: number;
        method?: string;
        result?: unknown;
      };
      if (msg.id !== undefined) pending.get(msg.id)?.(msg.result);
      if (msg.method) events.push(msg.method);
    });

    await new Promise((r) => ws.addEventListener("open", r, { once: true }));

    const send = (method: string, params?: unknown) =>
      new Promise<unknown>((resolve) => {
        const mid = ++id;
        pending.set(mid, resolve);
        ws.send(JSON.stringify({ id: mid, method, params }));
      });

    await send("Page.enable");
    await send("Runtime.enable");

    /**
     * 访问后台页面时需要先登录。
     *
     * 在页面上下文里完成登录而不是模拟 Cookie：同源 fetch 才能拿到
     * NextAuth 下发的会话 Cookie，之后导航浏览器会自动带上。
     */
    if (new URL(URL_).pathname.startsWith("/admin")) {
      const origin = new URL(URL_).origin;
      await send("Page.navigate", { url: `${origin}/login` });
      await new Promise((r) => setTimeout(r, 1500));

      const loginExpr = `(async () => {
        const csrf = await (await fetch('/api/auth/csrf')).json();
        const body = new URLSearchParams({
          csrfToken: csrf.csrfToken,
          email: ${JSON.stringify(process.env.SEED_ADMIN_EMAIL ?? "")},
          password: ${JSON.stringify(process.env.SEED_ADMIN_PASSWORD ?? "")},
        });
        await fetch('/api/auth/callback/credentials', { method: 'POST', body });
        return 'ok';
      })()`;

      const r = (await send("Runtime.evaluate", {
        expression: loginExpr,
        awaitPromise: true,
        returnByValue: true,
      })) as { result?: { value?: unknown } };
      console.log("登录:", r?.result?.value);
    }

    // 导航后轮询，等到任务清单真的渲染出来
    await send("Page.navigate", { url: URL_ });
    let measured: unknown = null;
    let lastSeen: unknown = null;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 400));
      const res = (await send("Runtime.evaluate", {
        expression: MEASURE,
        returnByValue: true,
      })) as { result?: { value?: unknown } };
      const value = res?.result?.value as { error?: string } | undefined;
      lastSeen = value;
      if (value && !value.error) {
        measured = value;
        break;
      }
    }

    if (!measured) {
      console.log("最后一次探测到的状态：");
      console.log(JSON.stringify(lastSeen, null, 2));
      throw new Error("测量超时：页面上没有任务清单项");
    }

    console.log(JSON.stringify(measured, null, 2));

    const m = measured as { offsetPx: number };
    console.log(
      `\n复选框中心与首行文字中心的差值: ${m.offsetPx}px ` +
        (Math.abs(m.offsetPx) < 1 ? "→ 已对齐" : "→ 仍未对齐")
    );

    // 直接问浏览器：哪些规则命中了那个 <p>。靠算术推优先级已经错过两次。
    await send("DOM.enable");
    await send("CSS.enable");
    const doc = (await send("DOM.getDocument", { depth: -1 })) as { root: { nodeId: number } };
    const found = (await send("DOM.querySelector", {
      nodeId: doc.root.nodeId,
      selector: 'ul[data-type="taskList"] li div > p',
    })) as { nodeId: number };

    if (found.nodeId) {
      const matched = (await send("CSS.getMatchedStylesForNode", {
        nodeId: found.nodeId,
      })) as {
        matchedCSSRules?: Array<{
          rule: { selectorList: { text: string }; style: { cssProperties: Array<{ name: string; value: string }> } };
        }>;
      };

      console.log("\n=== 命中该 <p> 的规则里，涉及 margin 的 ===");
      for (const entry of matched.matchedCSSRules ?? []) {
        const marginProps = entry.rule.style.cssProperties.filter((p) =>
          p.name.startsWith("margin")
        );
        if (marginProps.length === 0) continue;
        console.log("  " + entry.rule.selectorList.text.slice(0, 130));
        console.log(
          "      " + marginProps.map((p) => `${p.name}:${p.value}`).join(" ")
        );
      }
    }

    ws.close();
  } finally {
    cleanup();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
