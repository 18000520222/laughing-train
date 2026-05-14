import { PrismaClient } from '@prisma/client';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import nodemailer from 'nodemailer';


export const dynamic = 'force-dynamic';
const prisma = new PrismaClient();


// 动作 1：常规业务保存 (改金额、改公司、改阶段)
async function updateOpportunity(formData: FormData) {
  'use server';
  const oppId = String(formData.get('oppId'));
  const amount = Number(formData.get('amount')) || 0;
  const companyId = String(formData.get('companyId')) || '';
  const stage = String(formData.get('stage'));
  const productId = String(formData.get('productId'));


  if (!oppId) return;
  await prisma.opportunity.update({
    where: { id: oppId },
    data: { amountUSD: amount, stage: stage as any, productId: productId || null }
  });
  redirect('/dashboard');
}


// 动作 2：发送邮件并记录到 CRM 历史
async function sendEmailReply(formData: FormData) {
  'use server';
  const oppId = String(formData.get('oppId'));
  const customerEmail = String(formData.get('customerEmail'));
  const replyContent = String(formData.get('replyContent'));
  const oldDescription = String(formData.get('oldDescription'));
  const oppTitle = String(formData.get('oppTitle'));


  if (!oppId || !replyContent || !customerEmail) return;

