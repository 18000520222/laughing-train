#!/usr/bin/env node

const baseUrl = (process.env.ERDI_CRM_BASE_URL || 'https://crm.erdicn.com').replace(/\/$/, '');
const token = process.env.ERDI_AGENT_TOKEN || '';
const [command = 'orders', argument = '', ...flags] = process.argv.slice(2);

if (token.length < 32) {
  console.error('ERDI_AGENT_TOKEN is missing or too short.');
  process.exit(1);
}

function printHelp() {
  console.log([
    'Usage:',
    '  node bin/crm-agent.mjs orders [limit]',
    '  node bin/crm-agent.mjs order <SHOPLINE order number> [--shipping]',
    '  node bin/crm-agent.mjs pi <SHOPLINE order number>',
    '  node bin/crm-agent.mjs dhl <SHOPLINE order number>',
  ].join('\n'));
}

async function request(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

try {
  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp();
  } else if (command === 'orders') {
    const limit = Number(argument || 20);
    const result = await request(`/api/agent/orders?limit=${Number.isFinite(limit) ? limit : 20}`);
    console.log(JSON.stringify(result, null, 2));
  } else if (['order', 'pi', 'dhl'].includes(command)) {
    if (!argument) throw new Error('A SHOPLINE order number is required.');
    const includeShipping = command === 'dhl' || flags.includes('--shipping');
    const query = new URLSearchParams({ order: argument });
    if (includeShipping) query.set('include', 'shipping');
    const result = await request(`/api/agent/orders?${query.toString()}`);
    if (result.count !== 1) throw new Error(`Order ${argument} was not found.`);
    const order = result.orders[0];
    if (command === 'pi') {
      console.log(JSON.stringify({ orderNumber: order.orderNumber, pi: order.pi }, null, 2));
    } else if (command === 'dhl') {
      console.log(JSON.stringify({ orderNumber: order.orderNumber, shipping: order.shipping, items: order.items, dhl: order.dhl }, null, 2));
    } else {
      console.log(JSON.stringify(order, null, 2));
    }
  } else {
    printHelp();
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
