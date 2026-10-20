import { ForbiddenError, getCurrentAccount } from '@/lib/auth/account';
import { OperationsWorkspace } from '@/components/operations/workspace';
export default async function OperationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [ctx, query] = await Promise.all([
    getCurrentAccount({ allowProfessional: true }).catch((error) => {
      if (error instanceof ForbiddenError) return null;
      throw error;
    }),
    searchParams,
  ]);
  if (!ctx)
    return (
      <section className="border-border bg-card space-y-3 rounded-xl border p-6">
        <h1 className="text-xl font-semibold">Acceso no disponible</h1>
        <p>
          Tu acceso a este negocio está pendiente de activación o fue
          suspendido. Solicita a administración que lo revise.
        </p>
      </section>
    );
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
