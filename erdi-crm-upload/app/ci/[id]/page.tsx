import TradeDocumentView from '@/components/TradeDocumentView';

export const dynamic = 'force-dynamic';

export default async function CommercialInvoice({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return <TradeDocumentView opportunityId={id} type="CI" searchParams={query} />;
}
