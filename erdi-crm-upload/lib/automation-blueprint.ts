import {
  AUTOMATION_CORE_TEMPLATE_KEYS,
  buildCanvas,
  getTemplate,
} from '@/lib/automation';
import { prisma } from '@/lib/prisma';

type BlueprintStatus = 'ACTIVE' | 'DRAFT';

export async function createAutomationBlueprintPack({
  keys = AUTOMATION_CORE_TEMPLATE_KEYS,
  status = 'ACTIVE',
}: {
  keys?: string[];
  status?: BlueprintStatus;
} = {}) {
  const normalizedKeys = Array.from(new Set(keys.map((key) => key.trim()).filter(Boolean)));
  const targetKeys = normalizedKeys.length ? normalizedKeys : AUTOMATION_CORE_TEMPLATE_KEYS;
  const existing = await prisma.automationFlow.findMany({
    where: { templateKey: { in: targetKeys } },
    select: { id: true, templateKey: true, status: true },
  });
  const existingByKey = new Map(existing.map((flow) => [flow.templateKey, flow]));

  let created = 0;
  let activated = 0;
  let skipped = 0;
  const createdIds: string[] = [];
  const activatedIds: string[] = [];
  const missingTemplates: string[] = [];

  for (const key of targetKeys) {
    const template = getTemplate(key);
    if (!template) {
      missingTemplates.push(key);
      skipped++;
      continue;
    }

    const existingFlow = existingByKey.get(key);
    if (existingFlow) {
      if (status === 'ACTIVE' && existingFlow.status !== 'ACTIVE') {
        await prisma.automationFlow.update({
          where: { id: existingFlow.id },
          data: { status: 'ACTIVE' },
        });
        activated++;
        activatedIds.push(existingFlow.id);
      } else {
        skipped++;
      }
      continue;
    }

    const flow = await prisma.automationFlow.create({
      data: {
        flowCode: nextFlowCode(),
        name: template.name,
        description: template.description,
        category: template.category,
        templateKey: template.key,
        channel: template.channel as any,
        status: status as any,
        triggerType: template.triggerType,
        triggerConfig: template.triggerConfig as any,
        conditionType: template.conditionType || null,
        conditionConfig: (template.conditionConfig || undefined) as any,
        actionType: template.actionType,
        actionConfig: template.actionConfig as any,
        canvas: buildCanvas(template) as any,
      },
    });
    created++;
    createdIds.push(flow.id);
  }

  return {
    requested: targetKeys.length,
    status,
    created,
    activated,
    skipped,
    missingTemplates,
    createdIds,
    activatedIds,
  };
}

function nextFlowCode() {
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `AUTO-${Date.now().toString(36).toUpperCase()}-${suffix}`;
}
