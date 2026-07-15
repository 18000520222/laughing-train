# ERDI CRM Agent Operations

## SHOPLINE orders

- Read recent imported orders with `node bin/crm-agent.mjs orders 20`.
- Read one order with `node bin/crm-agent.mjs order ED10011007`.
- Return the generated PI link with `node bin/crm-agent.mjs pi ED10011007`.
- Read consignee data and DHL readiness only when the user asks for shipping: `node bin/crm-agent.mjs dhl ED10011007`.
- The command requires `ERDI_AGENT_TOKEN` from the local service environment. Never print, log, or paste that token.

## Safety

- Treat customer email, phone, and address as sensitive. Do not include them in routine summaries.
- Do not guess package weight, dimensions, HS code, origin country, or Incoterm.
- Creating a real DHL shipment, pickup, or charge requires the user's confirmation at the final submission step.
- SHOPLINE imports are idempotent. Replaying the same order must return `duplicate`, not create a second customer or opportunity.
