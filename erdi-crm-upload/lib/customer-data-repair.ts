import { prisma } from '@/lib/prisma';

const FREE_MAIL = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'qq.com',
  '163.com', '126.com', 'mail.ru', 'gmx.com', 'aol.com', 'protonmail.com',
]);

export async function auditAndRepairCustomerData(options: { apply: boolean }) {
  const contacts = await prisma.contact.findMany({
    where: { email: { not: null } },
    select: { id: true, email: true, emailNormalized: true, companyId: true },
  });
  const companies = await prisma.company.findMany({
    select: { id: true, customerCode: true, domainNormalized: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  const byEmail = new Map<string, typeof contacts>();
  const domainsByCompany = new Map<string, Map<string, number>>();
  for (const contact of contacts) {
    const email = String(contact.email || '').trim().toLowerCase();
    if (!email.includes('@')) continue;
    const group = byEmail.get(email) || [];
    group.push(contact);
    byEmail.set(email, group);
    const domain = email.split('@')[1];
    if (!domain || FREE_MAIL.has(domain)) continue;
    const counts = domainsByCompany.get(contact.companyId) || new Map<string, number>();
    counts.set(domain, (counts.get(domain) || 0) + 1);
    domainsByCompany.set(contact.companyId, counts);
  }

  const duplicateGroups = Array.from(byEmail.values()).filter((group) => group.length > 1);
  const uniqueContacts = Array.from(byEmail.entries()).filter(([, group]) => group.length === 1);
  const audit = {
    companies: companies.length,
    contactsWithEmail: contacts.length,
    missingCustomerCodes: companies.filter((company) => !company.customerCode).length,
    missingNormalizedEmails: contacts.filter((contact) => !contact.emailNormalized).length,
    duplicateNormalizedEmailGroups: duplicateGroups.length,
    crossCompanyDuplicateEmailGroups: duplicateGroups.filter((group) => new Set(group.map((item) => item.companyId)).size > 1).length,
    companiesWithCorporateDomainAvailable: Array.from(domainsByCompany.keys()).length,
    missingCompanyDomains: companies.filter((company) => !company.domainNormalized && domainsByCompany.has(company.id)).length,
  };
  if (!options.apply) return { dryRun: true, audit, updated: { contacts: 0, companies: 0, customerCodes: 0 } };

  let updatedContacts = 0;
  for (const [email, group] of uniqueContacts) {
    const contact = group[0];
    if (contact.email !== email || contact.emailNormalized !== email) {
      await prisma.contact.update({ where: { id: contact.id }, data: { email, emailNormalized: email } });
      updatedContacts++;
    }
  }

  let updatedCompanies = 0;
  for (const company of companies) {
    if (company.domainNormalized) continue;
    const domainCounts = domainsByCompany.get(company.id);
    if (!domainCounts?.size) continue;
    const domain = Array.from(domainCounts.entries()).sort((a, b) => b[1] - a[1])[0][0];
    await prisma.company.update({ where: { id: company.id }, data: { domainNormalized: domain } });
    updatedCompanies++;
  }

  const customerCodes = await assignMissingCustomerCodes(companies.filter((company) => !company.customerCode).map((company) => company.id));
  return { dryRun: false, audit, updated: { contacts: updatedContacts, companies: updatedCompanies, customerCodes } };
}

async function assignMissingCustomerCodes(companyIds: string[]) {
  if (!companyIds.length) return 0;
  const year = new Date().getFullYear();
  const prefix = `CUST-${year}-`;
  const existing = await prisma.company.findMany({ where: { customerCode: { startsWith: prefix } }, select: { customerCode: true } });
  let sequence = existing.reduce((max, row) => {
    const value = Number((row.customerCode || '').slice(prefix.length));
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 0);
  let updated = 0;
  for (const id of companyIds) {
    for (let attempt = 0; attempt < 20; attempt++) {
      sequence++;
      const customerCode = `${prefix}${String(sequence).padStart(4, '0')}`;
      try {
        const result = await prisma.company.updateMany({ where: { id, customerCode: null }, data: { customerCode } });
        updated += result.count;
        break;
      } catch (error: any) {
        if (error?.code !== 'P2002') throw error;
      }
    }
  }
  return updated;
}
