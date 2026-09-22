import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * 服务端错误日志（写盘）。
 *
 * 为什么需要它：Server Action 捕获异常后只把可读文案返回给前端，原始堆栈仅出现在
 * dev server 的终端里。终端一关就没了，线上更是拿不到——用户只能看到一句
 * 「操作失败，请稍后重试」，排查时无从下手。这里把完整堆栈落到 logs/ 目录，
 * 配合 /admin/logs 页面即可直接读到失败原因。
 *
 * ⚠️ 仅限服务端：本模块引入 node:fs，只能被 "use server" 文件或 Server Component
 * 引用。客户端组件导入会导致构建失败。
 */

/** 日志按天分文件，保留最近 N 天，避免开发机上无限增长 */
const RETENTION_DAYS = 14;

/** 单文件体积上限，超过后当天日志不再追加，只记一条截断提示 */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

export type LogLevel = "error" | "warn" | "info";

export interface LogEntry {
  time: string;
  level: LogLevel;
  /** 发生位置，如 publishPostAction */
  where: string;
  /** 归一化后的错误码或消息首行 */
  message: string;
  /** Prisma 等库带的错误码，如 P2003 */
  code?: string;
  /** 完整堆栈 */
  stack?: string;
  /** 附加上下文（会剔除敏感字段） */
  meta?: Record<string, unknown>;
}

function logDir(): string {
  return join(process.cwd(), "logs");
}

function logFile(date = new Date()): string {
  const day = date.toISOString().slice(0, 10);
  return join(logDir(), `${day}.jsonl`);
}

/**
 * 不记录任何可能含密钥或个人信息的字段。
 *
 * meta 由调用方传入，容易顺手把整个表单塞进来；这里按字段名白名单外剔除，
 * 避免密码、token 之类被长期留在磁盘上。
 */
const SENSITIVE_KEYS = /pass|token|secret|cookie|authorization|hash/i;

function sanitizeMeta(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (SENSITIVE_KEYS.test(key)) {
      safe[key] = "[redacted]";
      continue;
    }
    // 长字符串（正文之类）只留前 200 字，日志不是内容备份
    safe[key] = typeof value === "string" && value.length > 200 ? `${value.slice(0, 200)}…` : value;
  }
  return safe;
}

/** 清掉超过保留期的日志文件 */
function pruneOldLogs() {
  try {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const name of readdirSync(logDir())) {
      if (!name.endsWith(".jsonl")) continue;
      const path = join(logDir(), name);
      if (statSync(path).mtimeMs < cutoff) rmSync(path, { force: true });
    }
  } catch {
    // 清理失败不影响写入
  }
}

/**
 * 写一条日志。
 *
 * 任何失败都被吞掉：日志是诊断辅助，不能因为磁盘满或权限问题反过来破坏业务流程。
 */
export function log(entry: Omit<LogEntry, "time">) {
  try {
    mkdirSync(logDir(), { recursive: true });
    const path = logFile();

    let size = 0;
    try {
      size = statSync(path).size;
    } catch {
      // 文件还不存在，size 视为 0
    }
    if (size > MAX_FILE_BYTES) return;

    const line = JSON.stringify({
      time: new Date().toISOString(),
      ...entry,
      meta: sanitizeMeta(entry.meta),
    });
    appendFileSync(path, `${line}\n`, "utf8");

    // 每次写入都顺手清一遍旧文件，省掉单独的定时任务
    pruneOldLogs();
  } catch {
    // 见上：静默失败
  }
}

/**
 * 记录一个被 catch 住的异常。
 *
 * where 不要求调用方手填：捕获栈里已经带着 action 函数名，
 * 少一个必填参数就少一处写错的可能。
 */
export function logError(error: unknown, where: string, meta?: Record<string, unknown>) {
  const e = error as { name?: string; message?: string; code?: unknown; stack?: string };
  log({
    level: "error",
    where,
    message: e?.message ?? String(error),
    code: e?.code === undefined ? undefined : String(e.code),
    stack: e?.stack,
    meta,
  });
}

export interface ReadLogsOptions {
  /** 只读某一天，格式 YYYY-MM-DD；缺省读全部文件 */
  day?: string;
  /** 最多返回多少条（按时间倒序取最新的） */
  limit?: number;
  /** 只保留某个级别 */
  level?: LogLevel;
}

/** 可选的日期列表，供日志页面做筛选 */
export function listLogDays(): string[] {
  try {
    return readdirSync(logDir())
      .filter((n) => n.endsWith(".jsonl"))
      .map((n) => n.replace(/\.jsonl$/, ""))
      .sort((a, b) => b.localeCompare(a));
  } catch {
    return [];
  }
}

/**
 * 读取日志，按时间倒序返回。
 *
 * 逐行 JSON（JSONL）而非单个 JSON 数组：追加写不需要先读全量再重写，
 * 且单行损坏不会让整个文件无法解析——解析失败的行直接跳过。
 */
export function readLogs(options: ReadLogsOptions = {}): LogEntry[] {
  const { day, limit = 200, level } = options;
  const days = day ? [day] : listLogDays();
  const entries: LogEntry[] = [];

  for (const d of days) {
    let content: string;
    try {
      content = readFileSync(join(logDir(), `${d}.jsonl`), "utf8");
    } catch {
      continue;
    }
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as LogEntry;
        if (level && entry.level !== level) continue;
        entries.push(entry);
      } catch {
        // 跳过写坏的行
      }
    }
  }

  return entries.sort((a, b) => b.time.localeCompare(a.time)).slice(0, limit);
}

/** 清空全部日志文件 */
export function clearLogs() {
  try {
    rmSync(logDir(), { recursive: true, force: true });
  } catch {
    // 忽略
  }
}
