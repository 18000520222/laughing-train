const cronSecret = process.env.CRON_SECRET;
if (!cronSecret) {
  console.error('CRON_SECRET is not configured');
  process.exit(1);
}

const endpoint = process.env.MAIL_PULL_URL
  || 'http://127.0.0.1:3000/api/cron/mail-pull?lookback=200&max=200&history=50&backlog=100&enrich=0&automations=0&notifications=1';

try {
  const response = await fetch(endpoint, {
    headers: { authorization: `Bearer ${cronSecret}` },
    signal: AbortSignal.timeout(120_000),
  });
  const result = await response.json();
  const summary = {
    httpStatus: response.status,
    ok: response.ok && result.ok !== false,
    accounts: Array.isArray(result.accounts)
      ? result.accounts.map((account) => ({
          connected: account.connected,
          folders: Array.isArray(account.folders)
            ? account.folders.map((folder) => ({
                mailbox: folder.mailbox,
                direction: folder.direction,
                fetched: folder.fetched,
                inserted: folder.inserted,
                updated: folder.updated,
                historyFetched: folder.historyFetched,
                errorCount: Array.isArray(folder.errors) ? folder.errors.length : 0,
              }))
            : [],
          errorCount: Array.isArray(account.errors) ? account.errors.length : 0,
        }))
      : [],
    backlog: result.backlog || null,
  };
  console.log(JSON.stringify(summary));
  if (!summary.ok) process.exit(1);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
