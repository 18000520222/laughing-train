export function stripQuotedHistory(body: string): string {
  if (!body) return '';

  const markers = [
    /^-+\s*Original Message\s*-+\s*$/im,
    /^-+\s*原始邮件\s*-+\s*$/im,
    /^_{8,}\s*$/m,
    /^\s*On .{1,250} wrote:\s*$/im,
    /^\s*在.{1,250}写道[：:]\s*$/im,
    /^\s*From:\s*.{0,250}<[^>]+@[^>]+>\s*$/im,
  ];

  let result = body.replace(/\r\n/g, '\n');
  for (const marker of markers) {
    const index = result.search(marker);
    if (index >= 0) result = result.slice(0, index);
  }

  return result
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n')
    .replace(/Sent from my (?:iPhone|iPad|Mail)[\s\S]*/i, '')
    .replace(/发送自我的(?:\s*)?(?:iPhone|手机)[\s\S]*/i, '')
    .trim();
}

export function extractEmailAddress(value: string): string {
  const match = String(value || '').match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return (match?.[0] || '').toLowerCase();
}

export function subjectKey(subject: string): string {
  return String(subject || '')
    .replace(/^\s*((re|fw|fwd)\s*:\s*)+/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 180);
}
