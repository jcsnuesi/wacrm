'use client';

import { useState, useRef, useCallback, useEffect, KeyboardEvent } from 'react';
import {
  Send,
  LayoutTemplate,
  Paperclip,
  Image as ImageIcon,
  Video,
  FileText,
  Mic,
  Square,
  X,
  Loader2,
  Sparkles,
  Plus,
  MessageSquareDashed,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GatedButton } from '@/components/ui/gated-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCan } from '@/hooks/use-can';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  uploadAccountMedia,
  deleteAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
} from '@/lib/storage/upload-media';
import { ReplyQuote } from './reply-quote';
import { useTranslations } from 'next-intl';
import {
  InteractiveBuilder,
  blankButtonsPayload,
} from '@/components/interactive/interactive-builder';
import { validateInteractivePayload } from '@/lib/whatsapp/interactive';
import type {
  InteractiveMessagePayload,
  QuickReply,
  WhatsAppProvider,
} from '@/types';
import { QuickReplyPicker } from './quick-reply-picker';

/** Media content types an agent can send from the composer. */
export type ComposerMediaKind = 'image' | 'video' | 'document' | 'audio';

/** Supabase Storage bucket holding agent-sent chat attachments (migration 023). */
export const CHAT_MEDIA_BUCKET = 'chat-media';

/** Meta caps media captions at 1024 chars. Enforced here and in the send route. */
export const MEDIA_CAPTION_MAX = 1024;

/** Hard cap on a single voice recording so it can't blow the upload/
 *  transcode limits — auto-stops the recorder when reached. */
const MAX_RECORDING_SECONDS = 5 * 60;

/** Keep one-click batches useful without flooding the recipient or browser. */
const MAX_IMAGE_ATTACHMENTS = 10;

export interface SendMediaPayload {
  kind: ComposerMediaKind;
  /** Public chat-media URL Meta fetches at send time. */
  mediaUrl: string;
  /** Storage object path — lets the caller GC the object if the send fails. */
  path: string;
  /** Optional caption (image/video/document only). */
  caption?: string;
  /** Original file name — surfaced to the recipient for documents. */
  filename?: string;
  replyToId?: string;
}

interface ReplyDraft {
  /** Internal UUID of the message being replied to — sent back through onSend. */
  id: string;
  authorLabel: string;
  preview: string;
}

// Mirrors the chat-media bucket's allowed_mime_types (migration 023) for
// the file picker so unsupported files are rejected before upload rather
// than failing with a confusing Storage error. Audio has no picker — it's
// captured via the recorder.
const PICKER_ACCEPT: Record<'image' | 'video' | 'document', string> = {
  image: 'image/png,image/jpeg,image/webp',
  video: 'video/mp4,video/3gpp',
  document:
    'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain',
};

interface MediaDraft {
  kind: ComposerMediaKind;
  mediaUrl: string;
  /** Storage path — used to GC the object if the draft is discarded. */
  path: string;
  filename: string;
  caption: string;
}

interface MessageComposerProps {
  conversationId: string;
  sessionExpired: boolean;
  onSend: (text: string, replyToId?: string) => void;
  onSendMedia: (payload: SendMediaPayload) => void;
  onSendInteractive: (
    payload: InteractiveMessagePayload,
    replyToId?: string
  ) => void;
  onOpenTemplates: () => void;
  replyTo?: ReplyDraft | null;
  onClearReply?: () => void;
  provider?: WhatsAppProvider;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Worker that encodes mic input to Ogg/Opus entirely in the browser
 *  (vendored from opus-recorder into /public). Recording client-side in a
 *  Meta-accepted format means no server ffmpeg / transcode step. */
const OPUS_ENCODER_PATH = '/opus/encoderWorker.min.js';

export function MessageComposer({
  conversationId,
  sessionExpired,
  onSend,
  onSendMedia,
  onSendInteractive,
  onOpenTemplates,
  replyTo,
  onClearReply,
  provider = 'meta',
}: MessageComposerProps) {
  const t = useTranslations('Inbox.composer');

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Interactive-message builder dialog + quick-reply picker.
  const [interactiveOpen, setInteractiveOpen] = useState(false);
  const [interactivePayload, setInteractivePayload] =
    useState<InteractiveMessagePayload>(blankButtonsPayload);
  const [savingQuickReply, setSavingQuickReply] = useState(false);
  const [quickReplyOpen, setQuickReplyOpen] = useState(false);

  // Media attachment state. Images can be staged as a batch; the other
  // media kinds remain single-item drafts.
  const [drafts, setDrafts] = useState<MediaDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  // Mirror of `drafts` for the unmount cleanup, which can't read render
  // state. Kept in sync below so navigating away with a staged-but-unsent
  // batch GCs every orphaned object.
  const draftsRef = useRef<MediaDraft[]>([]);
  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  // Best-effort GC of a staged object the user never sent. Fire-and-forget.
  const removeStaged = useCallback((path: string | undefined) => {
    if (!path) return;
    void deleteAccountMedia(CHAT_MEDIA_BUCKET, path).catch(() => {});
  }, []);

  // Voice recording state. The recorder encodes Ogg/Opus in-browser
  // (opus-recorder) so there's no server-side transcode.
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recorderRef = useRef<import('opus-recorder').default | null>(null);
  const cancelledRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Viewers (read-only role) can browse the inbox but never send.
  // For solo users this is always true — single-owner accounts pass
  // every capability — so the disabled branch is a no-op there.
  const canSend = useCan('send-messages');
  const readOnly = !canSend;
  // Media (like free-form text) is only allowed inside the 24h window.
  const inputsDisabled = readOnly || sessionExpired;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Tear down any live recording + timer on unmount so a mid-record
  // navigation doesn't leak the mic, and GC a staged-but-unsent
  // attachment so it doesn't orphan in the bucket.
  useEffect(() => {
    return () => {
      clearTimer();
      cancelledRef.current = true;
      // stop() releases the mic stream + audio context inside opus-recorder.
      void recorderRef.current?.stop().catch(() => {});
      for (const draft of draftsRef.current) removeStaged(draft.path);
    };
  }, [clearTimer, removeStaged]);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    // Max 4 lines (~96px)
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending || sessionExpired) return;

    setSending(true);
    try {
      onSend(trimmed, replyTo?.id);
      setText('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    } finally {
      setSending(false);
    }
  }, [text, sending, sessionExpired, onSend, replyTo?.id]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setText(e.target.value);
      adjustHeight();
    },
    [adjustHeight]
  );

  // Ask the AI assistant for a suggested reply and drop it into the
  // composer for the agent to edit + send. Read-only server-side —
  // nothing is sent until the agent hits Send.
  const handleDraft = useCallback(async () => {
    if (drafting) return;
    setDrafting(true);
    try {
      const res = await fetch('/api/ai/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: conversationId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === 'ai_not_configured') {
          toast.error(
            "AI isn't set up yet — enable it in Settings → AI Assistant."
          );
        } else {
          toast.error(data.error ?? "Couldn't draft a reply.");
        }
        return;
      }
      const draftText = typeof data.draft === 'string' ? data.draft.trim() : '';
      if (!draftText) {
        toast.error("The assistant didn't return a reply.");
        return;
      }
      setText(draftText);
      // Let the textarea grow to fit and drop the cursor at the end so
      // the agent can tweak immediately.
      requestAnimationFrame(() => {
        adjustHeight();
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      });
    } catch {
      toast.error("Couldn't reach the AI assistant.");
    } finally {
      setDrafting(false);
    }
  }, [drafting, conversationId, adjustHeight]);

  // ---- Interactive message + quick replies --------------------------

  const openInteractiveBuilder = useCallback(
    (seed?: InteractiveMessagePayload) => {
      setInteractivePayload(seed ?? blankButtonsPayload());
      setInteractiveOpen(true);
    },
    []
  );

  const sendInteractive = useCallback(() => {
    const result = validateInteractivePayload(interactivePayload);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    onSendInteractive(interactivePayload, replyTo?.id);
    setInteractiveOpen(false);
    onClearReply?.();
  }, [interactivePayload, onSendInteractive, replyTo?.id, onClearReply]);

  // Persist the current builder payload as a reusable interactive snippet.
  const saveAsQuickReply = useCallback(async () => {
    const result = validateInteractivePayload(interactivePayload);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    const title = window.prompt(t('quickReplyNamePrompt'))?.trim();
    if (!title) return;
    setSavingQuickReply(true);
    try {
      const res = await fetch('/api/quick-replies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          kind: 'interactive',
          interactive_payload: interactivePayload,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t('quickReplySaveError'));
        return;
      }
      toast.success(t('quickReplySaved'));
    } catch {
      toast.error(t('quickReplySaveError'));
    } finally {
      setSavingQuickReply(false);
    }
  }, [interactivePayload, t]);

  // A picked quick reply: text fills the composer; interactive opens the
  // builder pre-filled so the agent can tweak before sending.
  const handlePickQuickReply = useCallback(
    (qr: QuickReply) => {
      setQuickReplyOpen(false);
      if (qr.kind === 'interactive' && qr.interactive_payload) {
        openInteractiveBuilder(qr.interactive_payload);
        return;
      }
      const body = qr.content_text ?? '';
      // Separate the snippet from any existing draft with a newline so the
      // words don't run together ("Thanks" + "we'll…" → "Thankswe'll…").
      setText((prev) =>
        prev && !/\s$/.test(prev) ? `${prev}\n${body}` : `${prev}${body}`
      );
      requestAnimationFrame(() => {
        adjustHeight();
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      });
    },
    [openInteractiveBuilder, adjustHeight]
  );

  // Upload selected files to chat-media. Images are independent uploads, so
  // run them in parallel and keep every success even if one file fails.
  const stageUploads = useCallback(
    async (kind: ComposerMediaKind, files: File[]) => {
      const current = draftsRef.current;
      const existingImageCount = current.every((draft) => draft.kind === 'image')
        ? current.length
        : 0;
      const available =
        kind === 'image' ? MAX_IMAGE_ATTACHMENTS - existingImageCount : 1;
      const selected = files.slice(0, Math.max(0, available));

      if (files.length > selected.length) {
        toast.error(t('photoLimit', { max: MAX_IMAGE_ATTACHMENTS }));
      }

      // Per-kind ceiling mirrors Meta's caps (image 5 MB, etc.) so we
      // reject before upload rather than orphaning an object that Meta
      // would then refuse at send.
      const max = MEDIA_MAX_BYTES_BY_KIND[kind];
      const valid = selected.filter((file) => {
        if (file.size <= max) return true;
        toast.error(
          `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB — ${kind} limit is ${Math.round(
            max / 1024 / 1024
          )} MB.`
        );
        return false;
      });
      if (valid.length === 0) return;

      setBusy(true);
      try {
        const results = await Promise.allSettled(
          valid.map((file) => uploadAccountMedia(CHAT_MEDIA_BUCKET, file))
        );
        const uploaded: MediaDraft[] = [];
        let failed = 0;

        for (let index = 0; index < results.length; index += 1) {
          const result = results[index];
          if (result.status === 'fulfilled') {
            uploaded.push({
              kind,
              mediaUrl: result.value.publicUrl,
              path: result.value.path,
              filename: valid[index].name,
              caption: '',
            });
          } else {
            failed += 1;
          }
        }

        if (failed > 0) {
          toast.error(
            kind === 'image'
              ? t('photosUploadFailed', { count: failed })
              : 'Upload failed.'
          );
        }
        if (uploaded.length === 0) return;

        if (kind === 'image' && current.every((draft) => draft.kind === 'image')) {
          const next = [...current, ...uploaded];
          draftsRef.current = next;
          setDrafts(next);
        } else {
          for (const draft of current) removeStaged(draft.path);
          draftsRef.current = uploaded;
          setDrafts(uploaded);
        }
      } finally {
        setBusy(false);
      }
    },
    [removeStaged, t]
  );

  const handlePicked = useCallback(
    (kind: 'image' | 'video' | 'document', files: File[]) => {
      if (files.length > 0) void stageUploads(kind, files);
    },
    [stageUploads]
  );

  // ---- Voice recording (client-side Ogg/Opus, no server transcode) ---

  // The encoded Ogg/Opus file from opus-recorder → upload as an audio
  // draft. WhatsApp renders Ogg/Opus as a playable voice note.
  const finalizeRecording = useCallback(
    async (bytes: Uint8Array) => {
      // Uint8Array is a valid BlobPart at runtime; the cast sidesteps the
      // lib.dom ArrayBufferLike-vs-ArrayBuffer generic mismatch.
      const file = new File(
        [bytes as unknown as BlobPart],
        `voice-${Date.now()}.ogg`,
        {
          type: 'audio/ogg',
        }
      );
      if (file.size === 0) return; // cancelled / empty take
      if (file.size > MEDIA_MAX_BYTES_BY_KIND.audio) {
        toast.error('Recording is too long (over 16 MB).');
        return;
      }
      setBusy(true);
      try {
        const { publicUrl, path } = await uploadAccountMedia(
          CHAT_MEDIA_BUCKET,
          file
        );
        for (const draft of draftsRef.current) removeStaged(draft.path);
        const nextDrafts: MediaDraft[] = [{
          kind: 'audio',
          mediaUrl: publicUrl,
          path,
          filename: file.name,
          caption: '',
        }];
        draftsRef.current = nextDrafts;
        setDrafts(nextDrafts);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Upload failed.');
      } finally {
        setBusy(false);
      }
    },
    [removeStaged]
  );

  const startRecording = useCallback(async () => {
    if (inputsDisabled || busy || recording) return;
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof AudioContext === 'undefined'
    ) {
      toast.error("Voice recording isn't supported in this browser.");
      return;
    }
    try {
      // Lazy-load the encoder (≈400 KB worker) only when the user records,
      // keeping it out of the main bundle.
      const { default: Recorder } = await import('opus-recorder');
      const recorder = new Recorder({
        encoderPath: OPUS_ENCODER_PATH,
        numberOfChannels: 1,
        encoderApplication: 2048, // VOIP — tuned for speech
        encoderSampleRate: 48000,
        streamPages: false, // one callback with the complete file on stop
      });
      cancelledRef.current = false;
      recorder.ondataavailable = (bytes) => {
        if (cancelledRef.current) return;
        void finalizeRecording(bytes);
      };
      recorderRef.current = recorder;
      await recorder.start();
      setRecording(true);
      setRecordSeconds(0);
      timerRef.current = setInterval(
        () => setRecordSeconds((s) => s + 1),
        1000
      );
    } catch {
      void recorderRef.current?.stop().catch(() => {});
      recorderRef.current = null;
      toast.error('Microphone access denied or unavailable.');
    }
  }, [inputsDisabled, busy, recording, finalizeRecording]);

  const stopRecording = useCallback(() => {
    clearTimer();
    setRecording(false);
    void recorderRef.current?.stop().catch(() => {});
  }, [clearTimer]);

  const cancelRecording = useCallback(() => {
    cancelledRef.current = true;
    clearTimer();
    setRecording(false);
    void recorderRef.current?.stop().catch(() => {});
  }, [clearTimer]);

  // Auto-stop at the cap so a forgotten recording can't blow the
  // upload size limit.
  useEffect(() => {
    if (recording && recordSeconds >= MAX_RECORDING_SECONDS) {
      stopRecording();
    }
  }, [recording, recordSeconds, stopRecording]);

  // ---- Draft send / discard -----------------------------------------

  const sendDrafts = useCallback(() => {
    if (drafts.length === 0 || busy) return;
    for (const draft of drafts) {
      onSendMedia({
        kind: draft.kind,
        mediaUrl: draft.mediaUrl,
        path: draft.path,
        // Audio takes no caption (Meta rejects it). Everything else: the
        // trimmed caption, or undefined when blank.
        caption:
          draft.kind === 'audio' ||
          (provider === 'twilio' &&
            (draft.kind === 'video' || draft.kind === 'document'))
            ? undefined
            : draft.caption.trim() || undefined,
        filename: draft.kind === 'document' ? draft.filename : undefined,
        replyToId: replyTo?.id,
      });
    }
    // The objects are now owned by their sent messages — clear without GC.
    draftsRef.current = [];
    setDrafts([]);
    onClearReply?.();
  }, [drafts, busy, onSendMedia, replyTo?.id, onClearReply, provider]);

  // Discard GCs only the selected staged object.
  const discardDraft = useCallback(
    (index: number) => {
      const draft = draftsRef.current[index];
      removeStaged(draft?.path);
      const next = draftsRef.current.filter(
        (_, currentIndex) => currentIndex !== index
      );
      draftsRef.current = next;
      setDrafts(next);
    },
    [removeStaged]
  );

  const setCaption = useCallback((caption: string) => {
    setDrafts((current) => current.map((draft) => ({ ...draft, caption })));
  }, []);

  // ---- Render --------------------------------------------------------

  return (
    <div className="border-border bg-card border-t p-3">
      {replyTo && (
        <div className="mb-2">
          <ReplyQuote
            authorLabel={replyTo.authorLabel}
            preview={replyTo.preview}
            onDismiss={onClearReply}
          />
        </div>
      )}
      {sessionExpired && (
        <div className="mb-2 flex items-center justify-between rounded-lg bg-amber-500/10 px-3 py-2">
          <p className="text-xs text-amber-400">
            {provider === 'twilio'
              ? t('twilioSessionExpiredHint')
              : t('sessionExpiredHint')}
          </p>
          {provider === 'meta' && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-amber-400 hover:text-amber-300"
              onClick={onOpenTemplates}
            >
              <LayoutTemplate className="mr-1 h-3 w-3" />
              {t('templates')}
            </Button>
          )}
        </div>
      )}

      {/* Hidden file inputs driven by the attach menu. */}
      <input
        ref={imageInputRef}
        type="file"
        accept={PICKER_ACCEPT.image}
        multiple
        className="hidden"
        onChange={(e) => {
          handlePicked('image', Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept={PICKER_ACCEPT.video}
        className="hidden"
        onChange={(e) => {
          handlePicked('video', Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
      <input
        ref={documentInputRef}
        type="file"
        accept={PICKER_ACCEPT.document}
        className="hidden"
        onChange={(e) => {
          handlePicked('document', Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />

      {drafts.length > 0 ? (
        <MediaDraftPreview
          drafts={drafts}
          busy={busy}
          readOnly={readOnly}
          onCaptionChange={setCaption}
          onDiscard={discardDraft}
          onSend={sendDrafts}
          t={t}
          provider={provider}
        />
      ) : recording ? (
        // Recording bar — replaces the composer while the mic is live.
        <div className="border-border bg-muted flex items-center gap-3 rounded-xl border px-4 py-2.5">
          <span className="flex h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-500" />
          <span className="text-foreground flex-1 text-sm">
            {t('recording', {
              current: formatDuration(recordSeconds),
              max: formatDuration(MAX_RECORDING_SECONDS),
            })}
          </span>
          <button
            type="button"
            onClick={cancelRecording}
            className="text-muted-foreground hover:bg-card hover:text-foreground rounded-md px-2 py-1 text-xs"
          >
            {t('cancel')}
          </button>
          <Button
            size="sm"
            onClick={stopRecording}
            className="bg-primary hover:bg-primary/90 h-9 w-9 shrink-0 p-0"
            title={t('stopAndAttach')}
          >
            <Square className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="flex items-end gap-2">
          {/* Attach menu — photo / video / document / voice. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={inputsDisabled || busy}
              title={
                readOnly
                  ? t('readOnlyTitle')
                  : inputsDisabled
                    ? undefined
                    : t('attachMedia')
              }
              className="text-muted-foreground hover:text-foreground inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md p-0 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Paperclip className="h-4 w-4" />
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="border-border bg-popover"
            >
              <DropdownMenuItem onClick={() => imageInputRef.current?.click()}>
                <ImageIcon className="mr-2 h-4 w-4" />
                {t('photo')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => videoInputRef.current?.click()}>
                <Video className="mr-2 h-4 w-4" />
                {t('video')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => documentInputRef.current?.click()}
              >
                <FileText className="mr-2 h-4 w-4" />
                {t('document')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void startRecording()}>
                <Mic className="mr-2 h-4 w-4" />
                {t('voiceNote')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* + menu — interactive messages + quick replies. Gated on the
              24h window like free-form text (interactive requires it). */}
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={inputsDisabled}
              title={
                readOnly
                  ? t('readOnlyTitle')
                  : inputsDisabled
                    ? undefined
                    : t('moreActions')
              }
              className="text-muted-foreground hover:text-foreground inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md p-0 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="border-border bg-popover"
            >
              <DropdownMenuItem onClick={() => openInteractiveBuilder()}>
                <MessageSquareDashed className="mr-2 h-4 w-4" />
                {t('interactiveMessage')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setQuickReplyOpen(true)}>
                <Zap className="mr-2 h-4 w-4" />
                {t('quickReplies')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {provider === 'meta' && (
            <GatedButton
              variant="ghost"
              size="sm"
              canAct={!readOnly}
              gateReason="send messages"
              title={readOnly ? undefined : t('sendTemplate')}
              className="text-muted-foreground hover:text-foreground h-9 w-9 shrink-0 p-0"
              onClick={onOpenTemplates}
            >
              <LayoutTemplate className="h-4 w-4" />
            </GatedButton>
          )}

          <GatedButton
            variant="ghost"
            size="sm"
            canAct={!readOnly}
            gateReason="send messages"
            disabled={drafting}
            title={readOnly ? undefined : t('draftWithAI')}
            className="text-muted-foreground hover:text-primary h-9 w-9 shrink-0 p-0"
            onClick={handleDraft}
          >
            {drafting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
          </GatedButton>

          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={
              readOnly
                ? t('readOnlyPlaceholder')
                : sessionExpired
                  ? provider === 'twilio'
                    ? t('twilioSessionExpiredPlaceholder')
                    : t('sessionExpiredPlaceholder')
                  : t('typeMessagePlaceholder')
            }
            disabled={sessionExpired || readOnly}
            rows={1}
            // Textarea keeps its own inline title — the GatedButton
            // wrapping pattern doesn't apply to non-button inputs.
            // The placeholder text also surfaces the read-only state.
            title={readOnly ? t('readOnlyTitle') : undefined}
            className={cn(
              'border-border bg-muted text-foreground placeholder-muted-foreground focus:border-primary/50 flex-1 resize-none rounded-xl border px-4 py-2.5 text-sm transition-colors outline-none',
              (sessionExpired || readOnly) && 'cursor-not-allowed opacity-50'
            )}
          />

          <GatedButton
            size="sm"
            canAct={!readOnly}
            gateReason="send messages"
            disabled={!text.trim() || sessionExpired || sending}
            onClick={handleSend}
            className="bg-primary hover:bg-primary/90 h-9 w-9 shrink-0 p-0 disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </GatedButton>
        </div>
      )}

      {/* Hint sits outside the flex row so its height doesn't push
          `items-end` buttons below the textarea. Indented to line up
          under the textarea left edge. */}
      {drafts.length === 0 && !recording && (
        <p className="text-muted-foreground mt-1 pl-[5.5rem] text-[10px]">
          {t('draftHint')}
        </p>
      )}

      {/* Interactive-message builder dialog. */}
      <Dialog open={interactiveOpen} onOpenChange={setInteractiveOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('interactiveMessage')}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto">
            <InteractiveBuilder
              value={interactivePayload}
              onChange={setInteractivePayload}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={savingQuickReply}
              onClick={saveAsQuickReply}
            >
              {savingQuickReply ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Zap className="mr-1 h-4 w-4" />
              )}
              {t('saveAsQuickReply')}
            </Button>
            <Button onClick={sendInteractive}>
              <Send className="mr-1 h-4 w-4" />
              {t('send')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick-reply picker. */}
      <QuickReplyPicker
        open={quickReplyOpen}
        onOpenChange={setQuickReplyOpen}
        onPick={handlePickQuickReply}
      />
    </div>
  );
}

/**
 * Staged-attachment preview with caption + send/discard. Declared at
 * module scope (not nested in MessageComposer) so React keeps it mounted
 * across the parent's re-renders — a nested component would remount the
 * caption input on every keystroke and drop focus.
 */
function MediaDraftPreview({
  drafts,
  busy,
  readOnly,
  onCaptionChange,
  onDiscard,
  onSend,
  t,
  provider,
}: {
  drafts: MediaDraft[];
  busy: boolean;
  readOnly: boolean;
  onCaptionChange: (caption: string) => void;
  onDiscard: (index: number) => void;
  onSend: () => void;
  t: ReturnType<typeof useTranslations>;
  provider: WhatsAppProvider;
}) {
  const first = drafts[0];
  const imagesOnly = drafts.every((draft) => draft.kind === 'image');

  return (
    <div className="border-border bg-muted/40 rounded-xl border p-3">
      {imagesOnly ? (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-muted-foreground text-xs font-medium">
              {t('photosSelected', { count: drafts.length })}
            </p>
            <span className="text-muted-foreground text-[10px]">
              {drafts.length}/{MAX_IMAGE_ATTACHMENTS}
            </span>
          </div>
          <div className="grid max-h-52 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-5">
            {drafts.map((draft, index) => (
              <div
                key={draft.path}
                className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-card"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={draft.mediaUrl}
                  alt={draft.filename}
                  className="h-full w-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => onDiscard(index)}
                  aria-label={t('removeAttachment')}
                  className="absolute right-1 top-1 rounded-full bg-black/65 p-1 text-white opacity-90 transition-opacity hover:bg-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {first.kind === 'video' && (
              <video
                src={first.mediaUrl}
                controls
                className="max-h-40 rounded-lg"
              />
            )}
            {first.kind === 'audio' && (
              <audio src={first.mediaUrl} controls className="w-full" />
            )}
            {first.kind === 'document' && (
              <div className="text-foreground flex items-center gap-2 text-sm">
                <FileText className="text-muted-foreground h-5 w-5 shrink-0" />
                <span className="truncate">{first.filename}</span>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => onDiscard(0)}
            aria-label={t('removeAttachment')}
            className="text-muted-foreground hover:bg-muted hover:text-foreground rounded p-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="mt-2 flex items-end gap-2">
        {first.kind !== 'audio' &&
          !(
            provider === 'twilio' &&
            (first.kind === 'video' || first.kind === 'document')
          ) && (
            <input
              value={first.caption}
              maxLength={MEDIA_CAPTION_MAX}
              onChange={(e) => onCaptionChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onSend();
                }
              }}
              placeholder={t('addCaption')}
              className="border-border bg-muted text-foreground placeholder-muted-foreground focus:border-primary/50 flex-1 rounded-xl border px-4 py-2.5 text-sm transition-colors outline-none"
            />
          )}
        <GatedButton
          size="sm"
          canAct={!readOnly}
          gateReason="send messages"
          disabled={busy}
          onClick={onSend}
          className={cn(
            'bg-primary hover:bg-primary/90 h-9 w-9 shrink-0 p-0 disabled:opacity-40',
            first.kind === 'audio' && 'ml-auto'
          )}
          title={
            imagesOnly ? t('sendPhotos', { count: drafts.length }) : t('send')
          }
        >
          <span className="relative">
            <Send className="h-4 w-4" />
            {drafts.length > 1 && (
              <span className="absolute -right-2.5 -top-2.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-[9px] font-bold text-primary">
                {drafts.length}
              </span>
            )}
          </span>
        </GatedButton>
      </div>
    </div>
  );
}
