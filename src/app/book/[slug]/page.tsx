import { notFound } from 'next/navigation';
import { PublicBooking } from '@/components/operations/public-booking';
export default async function BookingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!/^b-[a-f0-9]{32}$/.test(slug)) notFound();
  return (
    <main className="bg-background text-foreground min-h-screen px-4 py-10">
      <div className="border-border bg-card mx-auto max-w-xl rounded-2xl border p-6">
        <PublicBooking slug={slug} />
      </div>
    </main>
  );
}
