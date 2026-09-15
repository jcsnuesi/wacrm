'use client';

import Link from 'next/link';
import { AlertCircle, ArrowLeft, RefreshCw } from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';

export default function CustomerError({ reset }: { reset: () => void }) {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-xl items-center p-4 sm:p-6">
      <div className="border-border bg-card w-full rounded-2xl border p-6 text-center">
        <div className="bg-muted text-muted-foreground mx-auto flex size-11 items-center justify-center rounded-full">
          <AlertCircle aria-hidden="true" className="size-5" />
        </div>
        <h1 className="text-foreground mt-4 text-xl font-semibold">
          No pudimos mostrar este perfil
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Ocurrió un error inesperado al preparar la página.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button onClick={reset}>
            <RefreshCw aria-hidden="true" />
            Reintentar
          </Button>
          <Link
            href="/customers"
            className={buttonVariants({ variant: 'outline' })}
          >
            <ArrowLeft aria-hidden="true" />
            Volver a clientes
          </Link>
        </div>
      </div>
    </div>
  );
}
