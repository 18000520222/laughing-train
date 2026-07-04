import { createHmac, timingSafeEqual } from 'crypto';
import { canonicalOrigin } from '@/lib/site-url';

type CalendarTokenPayload = {
  v: 1;
  userId: string;
  email: string;
  role: string;
  iat: number;
};

type CalendarTask = {
  id: string;
  title: string;
  description: string | null;
  type: string;
  priority: string;
  status: string;
  dueAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
  owner: { name: string | null; email: string };
  company: { id: string; name: string; country: string | null; source: string };
  opportunity?: { title: string } | null;
};

const TOKEN_VERSION = 1;
const TOKEN_PREFIX = 'erdi-task-calendar';

function getCalendarSecret() {
  const secret = process.env.TASK_CALENDAR_SECRET || process.env.AUTH_SECRET || process.env.CRON_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('TASK_CALENDAR_SECRET or AUTH_SECRET is missing or too short.');
  }
  return secret;
}

function base64url(input: string | Buffer) {
  return Buffer.from(input).toString('base64url');
}

function signPayload(encodedPayload: string) {
  return createHmac('sha256', getCalendarSecret())
    .update(`${TOKEN_PREFIX}.${encodedPayload}`)
    .digest('base64url');
}

export function createTaskCalendarToken(input: { userId: string; email: string; role: string }) {
  const payload: CalendarTokenPayload = {
    v: TOKEN_VERSION,
    userId: input.userId,
    email: input.email,
    role: input.role,
    iat: Math.floor(Date.now() / 1000),
  };
  const encodedPayload = base64url(JSON.stringify(payload));
  return `${encodedPayload}.${signPayload(encodedPayload)}`;
}

export function verifyTaskCalendarToken(token: string): CalendarTokenPayload | null {
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) return null;
  const expected = signPayload(encodedPayload);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== actualBuffer.length) return null;
  if (!timingSafeEqual(expectedBuffer, actualBuffer)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as CalendarTokenPayload;
    if (payload.v !== TOKEN_VERSION || !payload.userId || !payload.email || !payload.role) return null;
    return payload;
  } catch {
    return null;
  }
}

export function taskCalendarUrl(token: string, options: { scope: string; priority?: string } = { scope: 'mine' }) {
  const params = new URLSearchParams();
  params.set('token', token);
  params.set('scope', options.scope);
  if (options.priority) params.set('priority', options.priority);
  return `${canonicalOrigin()}/api/tasks/calendar?${params.toString()}`;
}

export function buildSalesTaskCalendar(tasks: CalendarTask[], options: { scopeLabel: string }) {
  const now = new Date();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ERDI TECH LTD//CRM Sales Tasks//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(`ERDI CRM 销售任务 - ${options.scopeLabel}`)}`,
    'X-WR-TIMEZONE:UTC',
  ];

  for (const task of tasks) {
    if (!task.dueAt) continue;
    const start = new Date(task.dueAt);
    const end = new Date(start.getTime() + durationMinutesForTask(task.type) * 60000);
    const customerUrl = `${canonicalOrigin()}/customers/${task.company.id}`;
    const summary = `${priorityLabel(task.priority)} ${task.title} - ${task.company.name}`;
    const description = [
      `客户: ${task.company.name}`,
      task.company.country ? `国家: ${task.company.country}` : null,
      `来源: ${task.company.source}`,
      `负责人: ${task.owner.name || task.owner.email}`,
      task.opportunity ? `商机: ${task.opportunity.title}` : null,
      `类型: ${typeLabel(task.type)}`,
      `优先级: ${priorityLabel(task.priority)}`,
      `状态: ${task.status === 'DONE' ? '已完成' : '待办'}`,
      task.completedAt ? `完成时间: ${task.completedAt.toISOString()}` : null,
      task.description ? `说明: ${task.description}` : null,
      `CRM: ${customerUrl}`,
    ].filter(Boolean).join('\n');

    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeIcsText(`${task.id}@erdicrm.com`)}`,
      `DTSTAMP:${formatIcsDate(task.updatedAt || now)}`,
      `DTSTART:${formatIcsDate(start)}`,
      `DTEND:${formatIcsDate(end)}`,
      `SUMMARY:${escapeIcsText(summary)}`,
      `DESCRIPTION:${escapeIcsText(description)}`,
      `URL:${customerUrl}`,
      `STATUS:${task.status === 'DONE' ? 'COMPLETED' : 'CONFIRMED'}`,
      'BEGIN:VALARM',
      'TRIGGER:-PT30M',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeIcsText(summary)}`,
      'END:VALARM',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

function durationMinutesForTask(type: string) {
  if (type === 'MEETING') return 60;
  if (type === 'PHONE') return 30;
  if (type === 'TECH_CHECK' || type === 'QUOTE') return 45;
  return 30;
}

function priorityLabel(priority: string) {
  const labels: Record<string, string> = {
    URGENT: '紧急',
    HIGH: '高',
    NORMAL: '普通',
    LOW: '低',
  };
  return labels[priority] || priority;
}

function typeLabel(type: string) {
  const labels: Record<string, string> = {
    FOLLOW_UP: '跟进',
    EMAIL: '邮件',
    PHONE: '电话',
    MEETING: '会议',
    QUOTE: '报价',
    TECH_CHECK: '技术确认',
    RISK_RESCUE: '风险挽回',
    GENERAL: '通用',
  };
  return labels[type] || type;
}

function formatIcsDate(date: Date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function escapeIcsText(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}
