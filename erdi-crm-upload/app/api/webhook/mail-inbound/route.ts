import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

// Zero-dependency OpenAI Chat Completion helper
async function callOpenAI(systemPrompt: string, userPrompt: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com';
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  if (!apiKey) {
    console.error('Missing OPENAI_API_KEY in environment');
    return null;
  }

  try {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('OpenAI API Error:', response.status, errText);
      return null;
    }

    const data = await response.json();
    return JSON.parse(data.choices[0].message.content);
  } catch (error) {
    console.error('Error calling OpenAI:', error);
    return null;
  }
}

export async function POST(req: Request) {
  try {
    // 1. Authenticate using API Key
    const { searchParams } = new URL(req.url);
    const key = searchParams.get('key');
    if (key !== 'erdi-import-2026') {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    // 2. Parse request payload
    const { sender, subject, body_content } = await req.json();
    if (!sender) {
      return NextResponse.json({ error: 'Missing sender field' }, { status: 400 });
    }

    // 3. Extract default values
    let senderEmail = '';
    let senderName = '';
    if (sender.includes('<') && sender.includes('>')) {
      senderName = sender.split('<')[0].trim();
      senderEmail = sender.split('<')[1].split('>')[0].trim();
    } else {
      senderEmail = sender.trim();
    }

    const domain = senderEmail.includes('@') ? senderEmail.split('@')[1] : 'unknown';

    // 4. Run AI Analysis & Extraction via OpenAI
    const systemPrompt = \`You are a B2B AI Assistant for ERDI TECH LTD (a manufacturer of 1535nm laser rangefinders).
Analyze the incoming email metadata and body. You MUST return a JSON object with the following schema:
{
  "clientName": "string - extracted contact person's name (fallback to senderName if cannot find in body)",
  "companyName": "string - extracted company name (fallback to sender domain if cannot find in body)",
  "translatedTextZh": "string - full translation of the email body into Chinese",
  "intent": "string - short categorization of inquiry (e.g. Price Inquiry, Technical Support, Sample Request, General)",
  "aiReplyCustomer": "string - a highly professional, polite, and persuasive B2B reply draft in English addressing their specific technical/business points, offering product datasheets or samples",
  "estimatedAmountUSD": "number - estimated business value (e.g., sample testing = 1000, batch order = 50000, support = 0)"
}\`;

    const userPrompt = \`Email Sender: \${sender}
Email Subject: \${subject}
Email Content:
\${body_content}\`;

    const aiResult = await callOpenAI(systemPrompt, userPrompt) || {
      clientName: senderName || senderEmail,
      companyName: domain,
      translatedTextZh: '（AI 翻译失败）\\n' + body_content,
      intent: 'Inquiry',
      aiReplyCustomer: 'Dear partner,\\nThank you for reaching out to ERDI TECH. We have received your inquiry regarding our laser rangefinder modules and our sales team will get back to you with official datasheets shortly.\\nBest regards,\\nERDI TECH LTD',
      estimatedAmountUSD: 0
    };

    // 5. Connect to active Admin User
    const adminUser = await prisma.user.findUnique({
      where: { email: 'sales@erdicn.com' }
    });
    const ownerId = adminUser ? adminUser.id : null;

    // 6. DB operations: Find or Create Company
    let company = await prisma.company.findFirst({
      where: {
        OR: [
          { name: aiResult.companyName },
          { name: domain }
        ]
      }
    });

    if (!company) {
      company = await prisma.company.create({
        data: {
          name: aiResult.companyName,
          source: 'EMAIL_INBOUND',
          ownerId: ownerId,
          type: 'PROSPECT'
        }
      });
    }

    // DB operations: Find or Create Contact
    let contact = await prisma.contact.findUnique({
      where: { email: senderEmail }
    });

    if (!contact) {
      contact = await prisma.contact.create({
        data: {
          firstName: aiResult.clientName || senderName || senderEmail,
          email: senderEmail,
          companyId: company.id
        }
      });
    }

    // DB operations: Create Opportunity
    const opportunity = await prisma.opportunity.create({
      data: {
        title: \`AI Extracted: \${subject || 'New Inquiry'}\`,
        description: \`【客户原文】:\\n\${body_content}\\n\\n【AI 中文翻译】:\\n\${aiResult.translatedTextZh}\`,
        amountUSD: aiResult.estimatedAmountUSD,
        stage: 'UNPROCESSED',
        companyId: company.id,
        ownerId: ownerId
      }
    });

    // DB operations: Write to Unified Inbox (InboxMessage)
    let inboxMsg = null;
    try {
      inboxMsg = await prisma.inboxMessage.create({
        data: {
          channel: 'EMAIL',
          direction: 'IN',
          externalId: \`mail-\${Date.now()}-\${Math.random().toString(36).substr(2, 9)}\`,
          senderId: senderEmail,
          senderName: aiResult.clientName || senderName,
          originalText: body_content,
          detectedLang: 'en',
          translatedText: aiResult.translatedTextZh,
          intent: aiResult.intent,
          aiReplyZh: 'AI回复草稿已生成，请审核。',
          aiReplyCustomer: aiResult.aiReplyCustomer,
          aiAutoSendable: false,
          status: 'AI_DRAFTED',
          companyId: company.id
        }
      });
    } catch (inboxErr) {
      console.error('Failed to create InboxMessage:', inboxErr);
    }

    return NextResponse.json({
      success: true,
      message: 'Email processed successfully with AI enrichment',
      data: {
        companyId: company.id,
        contactId: contact.id,
        opportunityId: opportunity.id,
        inboxMessageId: inboxMsg ? inboxMsg.id : null,
        aiResult: {
          clientName: aiResult.clientName,
          companyName: aiResult.companyName,
          intent: aiResult.intent,
          estimatedAmountUSD: aiResult.estimatedAmountUSD
        }
      }
    });
  } catch (error) {
    console.error('Webhook mail inbound error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
