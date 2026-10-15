import { getCurrentAccount } from '@/lib/auth/account';
import { OperationsWorkspace } from '@/components/operations/workspace';
export default async function OperationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [ctx, query] = await Promise.all([
    getCurrentAccount({ allowProfessional: true }),
    searchParams,
  ]);
  return (
    <OperationsWorkspace
      accountName={ctx.account.name}
      sourceMessage={
        typeof query.source_message_id === 'string'
          ? query.source_message_id
          : undefined
      }
      dealId={typeof query.deal_id === 'string' ? query.deal_id : undefined}
    />
  );
}
