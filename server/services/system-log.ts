import { listLogDays, readLogs, type LogEntry, type LogLevel } from "@/lib/logger";

/**
 * 日志读取的服务层封装。
 *
 * 页面不直接调 lib/logger：那样页面会同时承担「取数」与「呈现」两件事，
 * 而日志的筛选规则（默认条数、级别、日期回退）属于业务约定，应当收在一处。
 */

export type { LogEntry, LogLevel };

export interface SystemLogQuery {
  /** 指定日期 YYYY-MM-DD；缺省为最近有日志的一天 */
  day?: string;
  level?: LogLevel;
  limit?: number;
}

export interface SystemLogResult {
  entries: LogEntry[];
  /** 可选的日期列表，供页面做切换 */
  days: string[];
  /** 实际使用的日期 */
  day: string | null;
}

/** 一天最多展示多少条，避免单个页面渲染上千行 */
const DEFAULT_LIMIT = 200;

export async function listSystemLogs(query: SystemLogQuery = {}): Promise<SystemLogResult> {
  const days = listLogDays();
  // 未指定日期时取最近一天；没有任何日志则返回空
  const day = query.day && days.includes(query.day) ? query.day : (days[0] ?? null);

  if (!day) {
    return { entries: [], days, day: null };
  }

  const entries = readLogs({
    day,
    level: query.level,
    limit: Math.min(query.limit ?? DEFAULT_LIMIT, DEFAULT_LIMIT),
  });

  return { entries, days, day };
}
