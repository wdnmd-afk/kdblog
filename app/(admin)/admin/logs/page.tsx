import { listSystemLogs } from "@/server/services/system-log";
import { PageHeader } from "@/components/ui";
import { LogList } from "./LogList";

export const metadata = { title: "系统日志" };

/**
 * 系统日志页。
 *
 * 存在意义：Server Action 捕获异常后只把可读文案返回给前端（如「操作失败，
 * 请稍后重试」），原始堆栈仅出现在 dev server 终端里，关掉就没了。
 * 这里把落盘的日志读出来，失败原因可以直接在后台查。
 */
export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  const { day } = await searchParams;
  const { entries, days, day: activeDay } = await listSystemLogs({ day });

  return (
    <div className="space-y-5">
      <PageHeader
        title="系统日志"
        description="记录服务端捕获的异常。操作失败时先来这里看具体原因"
      />
      <LogList entries={entries} days={days} activeDay={activeDay} />
    </div>
  );
}
