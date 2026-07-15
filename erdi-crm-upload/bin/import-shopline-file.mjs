#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

const filePath = process.argv[2];
const baseUrl = (process.env.ERDI_CRM_BASE_URL || 'https://crm.erdicn.com').replace(/\/$/, '');
const token = process.env.ERDI_AGENT_TOKEN || '';

if (!filePath) {
  console.error('Usage: node bin/import-shopline-file.mjs <private-orders.json>');
  process.exit(1);
}
if (token.length < 32) {
  console.error('ERDI_AGENT_TOKEN is missing or too short.');
  process.exit(1);
}

const content = await readFile(filePath, 'utf8');
const orders = JSON.parse(content);
if (!Array.isArray(orders)) throw new Error('The import file must contain a JSON array.');

const results = [];
for (const order of orders) {
  const response = await fetch(`${baseUrl}/api/shopline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(order),
  });
  const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) throw new Error(body.error || `SHOPLINE import failed with HTTP ${response.status}.`);
  results.push({
    orderNumber: body.orderNumber,
    status: body.status,
    opportunityId: body.opportunityId,
    piPath: body.piPath,
  });
}

console.log(JSON.stringify({ imported: results.length, results }, null, 2));
