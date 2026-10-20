'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function EmployeeActivationPage() {
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const initialization = useRef<Promise<{
    email: string | null;
    invited: boolean;
  }> | null>(null);

  useEffect(() => {
    let current = true;
    // Admin invitation emails use an implicit callback. Strip the fragment
    // before initializing the normal PKCE browser client, then set its session.
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = fragment.get('access_token');
    const refreshToken = fragment.get('refresh_token');
    const invitation = fragment.get('type') === 'invite';
    const linkError = fragment.get('error_description');
    if (window.location.hash)
      window.history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search
      );
    const invitationToken =
      new URLSearchParams(window.location.search).get('token') ?? '';
    setToken(invitationToken);
    const supabase = createClient();
    async function initialize() {
      if (linkError)
        throw new Error(
          'El enlace de acceso expiró o ya se utilizó. Solicita uno nuevo al administrador.'
        );
      if (!/^[A-Za-z0-9_-]{43}$/.test(invitationToken))
        throw new Error('El enlace de activación no es válido.');
      if (accessToken && refreshToken) {
        const session = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (session.error) throw session.error;
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      return {
        email: user?.email ?? null,
        invited:
          invitation ||
          !!(
            user?.invited_at &&
            user.user_metadata?.employee_password_set !== true
          ),
      };
    }
    initialization.current ??= initialize();
    void initialization.current
      .then((result) => {
        if (current) {
          setUserEmail(result.email);
          setNeedsPassword(result.invited);
        }
      })
      .catch((err) => {
        if (current)
          setError(
            err instanceof Error ? err.message : 'No se pudo abrir el acceso.'
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const supabase = createClient();
      if (!userEmail) {
        const login = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (login.error)
          throw new Error(
            'No se pudo iniciar sesión. Revisa tu correo y contraseña o solicita un enlace nuevo.'
          );
        setUserEmail(login.data.user.email ?? email);
      } else if (needsPassword) {
        if (password.length < 8 || password !== confirmation)
          throw new Error(
            'Usa al menos 8 caracteres y confirma la misma contraseña.'
          );
        const updated = await supabase.auth.updateUser({
          password,
          data: { employee_password_set: true },
        });
        if (updated.error) throw updated.error;
      }
      const response = await fetch('/api/employee/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      window.location.replace('/operations');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'No se pudo activar el acceso.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="bg-background flex min-h-screen items-center justify-center p-4">
      <section className="bg-card border-border w-full max-w-md space-y-5 rounded-xl border p-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">
            Activa tu acceso de empleado
          </h1>
          <p className="text-muted-foreground text-sm">
            Tu administrador ya preparó tu perfil. Entrarás directamente a los
            módulos que te haya habilitado.
          </p>
        </div>
        {loading ? (
          <p role="status">Verificando enlace…</p>
        ) : (
          <form className="space-y-4" onSubmit={submit}>
            {userEmail ? (
              <p>
                Cuenta: <strong>{userEmail}</strong>
              </p>
            ) : (
              <label className="grid gap-2">
                Correo de la invitación
                <Input
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
            )}
            {(!userEmail || needsPassword) && (
              <label className="grid gap-2">
                {userEmail ? 'Elige tu contraseña' : 'Contraseña'}
                <Input
                  type="password"
                  required
                  minLength={userEmail ? 8 : 6}
                  autoComplete={userEmail ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
            )}
            {userEmail && needsPassword && (
              <label className="grid gap-2">
                Confirma la contraseña
                <Input
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              </label>
            )}
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
            <Button className="w-full" disabled={busy || !token}>
              {busy ? 'Activando…' : 'Activar y entrar'}
            </Button>
            {!userEmail && (
              <p className="text-muted-foreground text-sm">
                Si es tu primer acceso, abre el enlace del correo enviado por tu
                administrador. No necesitas registrarte ni crear un negocio.
              </p>
            )}
            {userEmail && (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  await createClient().auth.signOut();
                  setUserEmail(null);
                  setNeedsPassword(false);
                }}
              >
                Usar otra cuenta
              </Button>
            )}
          </form>
        )}
      </section>
    </main>
  );
}
