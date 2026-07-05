import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);

function loadTsModule(relativePath) {
  const sourcePath = path.join(process.cwd(), relativePath);
  const source = fs.readFileSync(sourcePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  const exported = {};
  const sandbox = {
    exports: exported,
    module: { exports: exported },
    require,
  };
  vm.runInNewContext(compiled.outputText, sandbox, { filename: sourcePath });
  return sandbox.module.exports;
}

const automation = loadTsModule('lib/automation.ts');
const runnerSource = fs.readFileSync(path.join(process.cwd(), 'lib/automation-runner.ts'), 'utf8');
const template = automation.getTemplate('customer_health_repair');

const failures = [];
if (!automation.AUTOMATION_CORE_TEMPLATE_KEYS.includes('customer_health_repair')) {
  failures.push('customer_health_repair missing from core template keys');
}
const profileGroup = automation.AUTOMATION_BLUEPRINT_GROUPS.find((group) => group.key === 'profile_nurture');
if (!profileGroup?.templateKeys.includes('customer_health_repair')) {
  failures.push('customer_health_repair missing from profile_nurture blueprint group');
}
if (!template) {
  failures.push('customer_health_repair template missing');
} else {
  if (template.conditionType !== 'CUSTOMER_HEALTH') failures.push(`bad condition type: ${template.conditionType}`);
  if (template.actionType !== 'CREATE_HEALTH_REPAIR_TASK') failures.push(`bad action type: ${template.actionType}`);
  if (template.actionConfig?.source !== 'CUSTOMER_HEALTH_AUTOMATION') failures.push('bad health automation source');
  if (!Array.isArray(template.conditionConfig?.shortfallsAny) || template.conditionConfig.shortfallsAny.length < 5) {
    failures.push('shortfallsAny should cover the five-point audit dimensions');
  }
}
if (!runnerSource.includes("type === 'CUSTOMER_HEALTH'")) failures.push('runner does not handle CUSTOMER_HEALTH condition');
if (!runnerSource.includes("actionType === 'CREATE_HEALTH_REPAIR_TASK'")) failures.push('runner does not handle CREATE_HEALTH_REPAIR_TASK action');
if (!runnerSource.includes("source: 'CUSTOMER_HEALTH_AUTOMATION'")) failures.push('runner does not create CUSTOMER_HEALTH_AUTOMATION tasks');

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
} else {
  console.log('automation health template smoke passed: condition/action/source wired');
}
