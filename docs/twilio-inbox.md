# Twilio WhatsApp inbox

Twilio-hosted WhatsApp senders must use Twilio Programmable Messaging. They
cannot be entered as a Meta `phone_number_id` or sent through Graph API.

## Configure the server

Set these variables on the deployment and restart it:

```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your-auth-token
NEXT_PUBLIC_SITE_URL=https://crm.example.com
```

`NEXT_PUBLIC_SITE_URL` must be the exact public origin Twilio calls. It is used
for request-signature validation and outbound status callbacks.

Apply `supabase/migrations/037_twilio_inbox_provider.sql`, then open Settings →
WhatsApp, choose **Twilio WhatsApp**, enter the approved sender as an E.164
number (for example `+14155550123`), and save.

## Configure Twilio

Abre Twilio Console y entra al sender de WhatsApp que registraste. En la
sección **Messaging Endpoint Configuration** de la imagen, completa los campos
así:

1. **Messaging service**

   Puedes conservar **Default Conversations Service**. El CRM indica el sender
   mediante `From: whatsapp:+E164` en cada envío, por lo que no depende de un
   Messaging Service específico.

2. **Webhook URL for incoming messages**

   Introduce la URL pública del webhook entrante:

   ```text
   https://crm.example.com/api/whatsapp/webhook/twilio/inbound
   ```

   Sustituye `https://crm.example.com` por el valor exacto configurado en
   `NEXT_PUBLIC_SITE_URL`. En **Webhook method for incoming messages URL**
   selecciona **HTTP Post**.

3. **Fallback URL for incoming messages**

   Déjalo vacío. Es opcional y esta aplicación no incluye un endpoint de
   fallback separado. No coloques aquí el webhook entrante ni el callback de
   estados.

4. **Status callback URL**

   Puedes colocar:

   ```text
   https://crm.example.com/api/whatsapp/webhook/twilio/status
   ```

   El método debe permanecer en **HTTP Post**. El CRM ya incluye esta URL como
   `StatusCallback` en cada mensaje saliente, así que configurarla también en
   Twilio Console es redundante para esos mensajes, pero resulta útil para
   mantener el mismo callback en pruebas o envíos realizados fuera del CRM.

5. Guarda los cambios con el botón **Save** al final de la página.

### Ejemplo

Si la variable está configurada así:

```env
NEXT_PUBLIC_SITE_URL=https://wa.midominio.com
```

los valores en Twilio deben ser exactamente:

```text
Webhook URL for incoming messages:
https://wa.midominio.com/api/whatsapp/webhook/twilio/inbound

Status callback URL:
https://wa.midominio.com/api/whatsapp/webhook/twilio/status
```

Usa HTTPS y evita dominios internos como `localhost`, URLs de preview que
cambien en cada despliegue o una barra adicional al final de los endpoints.
Twilio calcula `X-Twilio-Signature` usando la URL pública completa; una
diferencia entre la URL configurada en Console y `NEXT_PUBLIC_SITE_URL` hará
que el CRM responda `401 Invalid Twilio signature`.

### Comprobar la configuración

1. Envía un mensaje de WhatsApp desde un teléfono al sender de Twilio.
2. Confirma que aparece una conversación nueva en el inbox con la etiqueta
   **Twilio** y el número de la línea.
3. Responde desde el inbox y verifica que el mensaje avance de `sent` a
   `delivered` y, cuando esté disponible, a `read`.
4. Si no aparece el mensaje, revisa **Monitor → Logs → Messaging** y el
   **Twilio Debugger**. Un `401` normalmente indica que
   `NEXT_PUBLIC_SITE_URL` no coincide exactamente con la URL pública.

Ambos endpoints rechazan solicitudes cuya cabecera `X-Twilio-Signature` sea
inválida.

## Supported scope

- Inbox text and media within the 24-hour customer-service window.
- In-session quick-reply buttons and list pickers through Twilio Content API.
- Incoming button/list selections, quoted-message context, and delivery/read
  status updates.
- Deterministic inbox automations can send text, quick-reply buttons, and list
  pickers through the line attached to the conversation, within the 24-hour
  customer-service window.
- Approved Twilio templates, broadcasts, Flows, reactions, and AI auto-replies
  are intentionally not enabled for Twilio lines in this phase.

Video and document captions are hidden for Twilio because WhatsApp discards a
body sent with those media types. Send the explanatory text as a separate
message instead.
