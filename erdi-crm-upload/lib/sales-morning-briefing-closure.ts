export type MorningBriefingNotificationInput = {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  isRead: boolean;
  createdAt: Date;
  user: {
    name: string | null;
    email: string;
    role?: string | null;
  };
};

export type MorningBriefingClosureOwnerRow = {
  ownerName: string;
  ownerEmail: string;
  sent: number;
  unread: number;
  read: number;
  staleUnread: number;
  repeatedLines: number;
  lastNotifiedAt: Date;
  lastStatusLabel: string;
  topLine: string;
  lineCount: number;
};

export function buildMorningBriefingClosureReport(notifications: MorningBriefingNotificationInput[], now = new Date()) {
  const briefingNotifications = notifications
    .filter((notification) => notification.title === '老板晨会摘要: 今日必须处理')
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const total = briefingNotifications.length;
  const unread = briefingNotifications.filter((notification) => !notification.isRead).length;
  const read = total - unread;
  const staleUnread = briefingNotifications.filter((notification) => !notification.isRead && hoursBetween(notification.createdAt, now) >= 24).length;
  const allLines = briefingNotifications.flatMap((notification) => briefingLines(notification.body));
  const repeatedLines = repeatedLineCount(allLines);
  const ownerRows = buildOwnerRows(briefingNotifications, now);
  const topBlockedOwner = ownerRows.find((row) => row.staleUnread > 0) || ownerRows.find((row) => row.unread > 0) || ownerRows[0] || null;

  return {
    total,
    unread,
    read,
    staleUnread,
    repeatedLines,
    readRate: total ? read / total : null,
    ownerRows,
    topBlockedOwner,
    recommendation: closureRecommendation({ total, unread, staleUnread, repeatedLines, topBlockedOwner }),
  };
}

function buildOwnerRows(notifications: MorningBriefingNotificationInput[], now: Date): MorningBriefingClosureOwnerRow[] {
  const buckets = new Map<string, MorningBriefingNotificationInput[]>();
  for (const notification of notifications) {
    const key = notification.user.email;
    buckets.set(key, [...(buckets.get(key) || []), notification]);
  }

  return Array.from(buckets.entries())
    .map(([email, ownerNotifications]) => {
      const sorted = [...ownerNotifications].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const latest = sorted[0];
      const lines = sorted.flatMap((notification) => briefingLines(notification.body));
      const unread = sorted.filter((notification) => !notification.isRead).length;
      const staleUnread = sorted.filter((notification) => !notification.isRead && hoursBetween(notification.createdAt, now) >= 24).length;
      return {
        ownerName: latest.user.name || latest.user.email,
        ownerEmail: email,
        sent: sorted.length,
        unread,
        read: sorted.length - unread,
        staleUnread,
        repeatedLines: repeatedLineCount(lines),
        lastNotifiedAt: latest.createdAt,
        lastStatusLabel: latest.isRead ? '已读' : hoursBetween(latest.createdAt, now) >= 24 ? '超过24h未读' : '未读',
        topLine: topBriefingLine(lines),
        lineCount: lines.length,
      };
    })
    .sort((a, b) => b.staleUnread - a.staleUnread || b.unread - a.unread || b.repeatedLines - a.repeatedLines || b.lastNotifiedAt.getTime() - a.lastNotifiedAt.getTime());
}

function briefingLines(body: string | null) {
  return String(body || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function topBriefingLine(lines: string[]) {
  return (
    lines.find((line) => line.includes('停滞商机')) ||
    lines.find((line) => line.includes('客户消息')) ||
    lines.find((line) => line.includes('销售任务')) ||
    lines[0] ||
    '暂无事项明细'
  );
}

function repeatedLineCount(lines: string[]) {
  const counts = new Map<string, number>();
  for (const line of lines) counts.set(line, (counts.get(line) || 0) + 1);
  return Array.from(counts.values()).filter((count) => count > 1).reduce((sum, count) => sum + count - 1, 0);
}

function closureRecommendation(input: {
  total: number;
  unread: number;
  staleUnread: number;
  repeatedLines: number;
  topBlockedOwner: MorningBriefingClosureOwnerRow | null;
}) {
  if (input.total === 0) return '近 7 天暂无晨会摘要通知。先确认 cron 是否已触发,或手动发送一次晨会摘要。';
  if (input.staleUnread > 0) return `${input.staleUnread} 条晨会通知超过 24 小时未读。先点名 ${input.topBlockedOwner?.ownerName || '未读负责人'},确认是否需要转派或升级。`;
  if (input.unread > 0) return `${input.unread} 条晨会通知未读。晨会后 2 小时内要求负责人读完并处理前三项。`;
  if (input.repeatedLines > 0) return `${input.repeatedLines} 条事项重复出现在晨会通知里。说明处理没有闭环,需要追问结果或生成救援任务。`;
  return '晨会通知已读闭环正常。下一步关注重复出现的客户消息、停滞商机和逾期任务是否真正处理完成。';
}

function hoursBetween(from: Date, to: Date) {
  return Math.max(0, (to.getTime() - from.getTime()) / 3600000);
}
