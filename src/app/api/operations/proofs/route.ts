import { createHash, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { isUuid } from '@/lib/auth/active-account';
import {
  foreignOrigin,
  operationsAdmin,
  operationsError,
} from '@/lib/operations/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { GET as whatsappMedia } from '@/app/api/whatsapp/media/[mediaId]/route';
export async function POST(request: Request) {
  let uploaded: string | null = null;
  let admin: ReturnType<typeof operationsAdmin> | null = null;
  try {
    if (foreignOrigin(request))
      return NextResponse.json(
        { error: 'Origen no autorizado.' },
        { status: 403 }
      );
    const ctx = await getCurrentAccount({ allowProfessional: true });
    const rate = checkRateLimit(`proof:${ctx.userId}`, {
      limit: 20,
      windowMs: 60_000,
    });
    if (!rate.success) return rateLimitResponse(rate);
    if (Number(request.headers.get('content-length')) > 6_000_000)
      return NextResponse.json(
        { error: 'Máximo 5 MB por comprobante.' },
        { status: 413 }
      );
    const form = await request.formData();
    const operation = String(form.get('operation_id') ?? '');
    const key = String(form.get('request_id') ?? '');
    const source = String(form.get('source_message_id') ?? '');
    if (!isUuid(operation) || !isUuid(key) || (source && !isUuid(source)))
      return NextResponse.json(
        { error: 'Operación o mensaje no válido.' },
        { status: 400 }
      );
    const payload: Record<string, unknown> = {
      operation_id: operation,
      declared_minor: Number(form.get('declared_minor')),
      reference: String(form.get('reference') ?? ''),
      bank: String(form.get('bank') ?? ''),
      declared_date: String(form.get('declared_date') ?? '') || null,
    };
    if (
      !Number.isSafeInteger(payload.declared_minor) ||
      Number(payload.declared_minor) <= 0
    )
      return NextResponse.json(
        { error: 'Importe no válido.' },
        { status: 400 }
      );
    let file = form.get('file');
    if (source) payload.source_message_id = source;
    if (!(file instanceof File) && source) {
      const media = await ctx.supabase.rpc('ops_source_media', {
        p_account: ctx.accountId,
        p_message: source,
      });
      if (media.error) return operationsError(media.error);
      const url = media.data?.url as string | undefined;
      let response: Response | null = null;
      if (url && /^\/api\/whatsapp\/media\/[0-9]+$/.test(url))
        response = await whatsappMedia(request, {
          params: Promise.resolve({ mediaId: url.split('/').pop()! }),
        });
      else if (url?.startsWith('https://')) {
        const parsed = new URL(url);
        const supabaseHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!)
          .hostname;
        if (
          (parsed.hostname === supabaseHost &&
            parsed.pathname.startsWith('/storage/v1/object/public/')) ||
          parsed.hostname.endsWith('.fbcdn.net') ||
          parsed.hostname.endsWith('.cdninstagram.com')
        )
          response = await fetch(url, {
            redirect: 'error',
            signal: AbortSignal.timeout(10_000),
          });
      }
      if (
        !response?.ok ||
        Number(response.headers.get('content-length')) > 5242880 ||
        !response.body
      )
        return NextResponse.json(
          {
            error:
              'No se pudo conservar el archivo del mensaje. Descárgalo y adjúntalo aquí; mantendremos su mensaje de origen.',
          },
          { status: 400 }
        );
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 5242880) {
          await reader.cancel();
          return NextResponse.json(
            { error: 'Máximo 5 MB por comprobante.' },
            { status: 413 }
          );
        }
        chunks.push(part.value);
      }
      file = new File([Buffer.concat(chunks)], 'comprobante', {
        type: response.headers.get('content-type')?.split(';')[0] ?? '',
      });
    }
    if (file instanceof File && file.size > 0) {
      if (
        file.size > 5242880 ||
        !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(
          file.type
        )
      )
        return NextResponse.json(
          { error: 'Usa JPG, PNG, WEBP o PDF de hasta 5 MB.' },
          { status: 400 }
        );
      // Preflight before privileged upload: ensure a configured CRM and readable operation.
      const month = String(form.get('month') ?? '') || null;
      if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
        return NextResponse.json({ error: 'Mes no válido.' }, { status: 400 });
      const preflight = await ctx.supabase.rpc('ops_dashboard', {
        p_account: ctx.accountId,
        p_month: month,
      });
      if (preflight.error) return operationsError(preflight.error);
      if (
        !preflight.data?.operations?.some(
          (op: { id: string }) => op.id === operation
        )
      )
        return NextResponse.json(
          {
            error:
              'Abre el mes de la operación o selecciona una operación disponible.',
          },
          { status: 403 }
        );
      const bytes = Buffer.from(await file.arrayBuffer());
      const validMagic =
        file.type === 'application/pdf'
          ? bytes.subarray(0, 5).toString() === '%PDF-'
          : file.type === 'image/jpeg'
            ? bytes[0] === 255 && bytes[1] === 216
            : file.type === 'image/png'
              ? bytes
                  .subarray(0, 8)
                  .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
              : bytes.subarray(0, 4).toString() === 'RIFF' &&
                bytes.subarray(8, 12).toString() === 'WEBP';
      if (!validMagic)
        return NextResponse.json(
          { error: 'El formato del archivo no coincide con su contenido.' },
          { status: 400 }
        );
      admin = operationsAdmin();
      uploaded = `${ctx.accountId}/${ctx.userId}/${randomUUID()}`;
      const result = await admin.storage
        .from('ops-proofs')
        .upload(uploaded, bytes, { contentType: file.type, upsert: false });
      if (result.error)
        return NextResponse.json(
          {
            error:
              'No se pudo guardar el comprobante privado. Revisa el almacenamiento de Supabase.',
          },
          { status: 503 }
        );
      payload.file_path = uploaded;
      payload.file_hash = createHash('sha256').update(bytes).digest('hex');
    } else if (source) payload.source_message_id = source;
    else
      return NextResponse.json(
        {
          error: 'Adjunta un archivo o selecciona el mensaje del comprobante.',
        },
        { status: 400 }
      );
    const result = await ctx.supabase.rpc('ops_command', {
      p_account: ctx.accountId,
      p_action: 'proof',
      p_payload: payload,
      p_request_id: key,
    });
    if (result.error) {
      if (
        uploaded &&
        admin &&
        /^(22|23|42|PGRST)/.test(result.error.code ?? '')
      )
        await admin.storage.from('ops-proofs').remove([uploaded]);
      uploaded = null;
      return operationsError(result.error);
    }
    if (uploaded && admin) {
      const stored = await ctx.supabase.rpc('ops_proof_file', {
        p_account: ctx.accountId,
        p_id: result.data.id,
      });
      if (!stored.error && stored.data.file_path !== uploaded)
        await admin.storage.from('ops-proofs').remove([uploaded]);
    }
    return NextResponse.json(
      { data: result.data },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    // An uncertain failure may follow a committed proof. Keep its private
    // file; idempotent retries resolve the stored request.
    return toErrorResponse(error);
  }
}
export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount({ allowProfessional: true });
    const id = new URL(request.url).searchParams.get('id');
    if (!id || !isUuid(id))
      return NextResponse.json(
        { error: 'Comprobante no válido.' },
        { status: 400 }
      );
    const result = await ctx.supabase.rpc('ops_proof_file', {
      p_account: ctx.accountId,
      p_id: id,
    });
    if (result.error) return operationsError(result.error);
    let url = result.data.source_url;
    if (result.data.file_path) {
      const signed = await operationsAdmin()
        .storage.from('ops-proofs')
        .createSignedUrl(result.data.file_path, 120);
      if (signed.error)
        return NextResponse.json(
          { error: 'Archivo no disponible.' },
          { status: 404 }
        );
      url = signed.data.signedUrl;
    }
    if (!url || !/^(https?:\/\/|\/(?!\/))/.test(url))
      return NextResponse.json(
        { error: 'Archivo no disponible.' },
        { status: 404 }
      );
    return NextResponse.json(
      { url },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
