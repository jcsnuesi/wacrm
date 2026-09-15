import { Customer360DetailPage } from '@/components/customers/customer-360-detail-page';

export default async function CustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <Customer360DetailPage key={id} customerId={id} />;
}
