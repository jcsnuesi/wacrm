# Kiro board - Omnichannel Customer 360

This document is the versioned Kiro board for the WACRM omnichannel stream.

## Stages

- [x] Stage 0: Discovery and compatibility assessment
- [x] Stage 1: Canonical Customer and channel catalogue migration
- [x] Stage 2: Legacy WhatsApp contact and identity backfill design
- [x] Stage 3: Omnichannel conversation/message schema bridge
- [x] Stage 4: Apply and verify migrations in Supabase
- [~] Stage 5: Route WhatsApp writes through CustomerIdentity (implemented; activation pending migrations)
- [~] Stage 6: Identity resolution service and IdentityMatch review queue (schema and candidate rules implemented)
- [~] Stage 7: Customer merge with immutable audit history (RPC and history migration implemented)
- [~] Stage 8: Provider adapter contract and WhatsApp adapter (normalizer implemented; routing cutover pending)
- [~] Stage 9: Instagram provider and inbound webhook pipeline (external activation pending)
- [~] Stage 10: Facebook provider and inbound webhook pipeline (external activation pending)
- [~] Stage 11: Customer 360 read API and profile detail (tests, typecheck, lint, and format verified; production build and signed-in browser acceptance pending)
- [~] Stage 12: TikTok capability boundary and rollout hardening (product access pending)

## Current architecture

- Persistence: PostgreSQL through Supabase JS; no ORM.
- Tenant / organization: `accounts` (`account_id` is used in the new model).
- Legacy customer: `contacts`, including WhatsApp phone and BSUID fields.
- Legacy inbox: `conversations.contact_id`, `messages.conversation_id`.
- Existing identity bridge: `contact_identities` (migration 043).
- Existing channel-account bridge: `channel_accounts` (migration 044).
- Active inbound providers: Meta WhatsApp and Twilio WhatsApp webhooks.

## Implemented changes

### Stage 0: Discovery and compatibility assessment

Status: [x] Completed

Relevant files:

- `supabase/migrations/001_initial_schema.sql`
- `supabase/migrations/017_account_sharing.sql`
- `supabase/migrations/037_twilio_inbox_provider.sql`
- `supabase/migrations/041_whatsapp_bsuid_identities.sql`
- `supabase/migrations/043_contact_identities.sql`
- `supabase/migrations/044_channel_accounts.sql`
- `src/app/api/whatsapp/webhook/route.ts`
- `src/app/api/whatsapp/webhook/twilio/inbound/route.ts`
- `src/lib/contacts/identities.ts`

Decision: retain `contacts` and current WhatsApp routes during migration. `customers` becomes canonical while `contacts` remains a compatibility projection.

### Stage 1: Canonical Customer and channel catalogue migration

Status: [x] Implemented; [ ] Applied to Supabase

Migration: `supabase/migrations/045_customer_360_core.sql`

Acceptance criteria:

1. `channels` is seeded idempotently with WhatsApp, Instagram, Facebook, and TikTok.
2. `customers` is tenant-scoped and has no provider-specific IDs.
3. Every existing `contacts` row receives one `customers` row.
4. New legacy contact writes automatically receive a canonical customer.
5. Existing `contact_identities` gain `customer_id` without changing current WhatsApp callers.
6. `channel_accounts` gains the canonical `channel_id` reference.

### Stage 2: Legacy WhatsApp contact and identity backfill design

Status: [x] Implemented; [ ] Applied to Supabase

Acceptance criteria:

1. Existing WhatsApp phone and BSUID identities retain their legacy contact association.
2. The same identities receive the corresponding canonical `customer_id`.
3. No legacy contact, conversation, message, or credential is deleted.
4. Ambiguous `channel_account_id` mappings are intentionally left null rather than guessed; runtime adapters will supply them.

### Stage 3: Omnichannel conversation/message schema bridge

Status: [x] Implemented; [ ] Applied to Supabase

Migration: `supabase/migrations/046_omnichannel_conversation_bridge.sql`

Acceptance criteria:

1. Conversations gain `customer_id`, `customer_identity_id`, `channel_account_id`, and `external_conversation_id`.
2. Messages gain `external_message_id`, `direction`, `sender_identity_id`, lifecycle timestamps, and JSON metadata.
3. Existing WhatsApp conversation writes receive `customer_id` and a deterministic channel-account mapping when available.
4. Legacy columns remain active until the provider adapter cutover.

### Stage 5: Route WhatsApp writes through CustomerIdentity

Status: [x] Implemented and regression-tested; [ ] Activated in production

Changes:

1. Meta WhatsApp webhook records the resolved generic identity on the conversation.
2. Twilio WhatsApp inbound webhook records the resolved generic identity on the conversation.
3. Existing contact lookup, recipient resolution, conversation lookup, and WhatsApp fields remain intact.
4. This code must be activated only after migrations 045 and 046 are applied.
5. Regression run passed: 82 test files / 745 tests and TypeScript typecheck.

### Stage 6: Identity resolution and review queue

Status: [x] Schema and candidate rules implemented; [ ] Provider persistence pending

Migration: `supabase/migrations/047_identity_match_review.sql`

Acceptance criteria:

1. `identity_matches` keeps an account-scoped, auditable status history for review.
2. Exact external ID, normalized phone, and normalized email remain deterministic paths.
3. Exact display-name and username signals produce only `PENDING_REVIEW` candidates.
4. No weak-signal candidate can merge or reassign a customer automatically.

### Stage 7: Explicit customer merge

Status: [x] Database RPC and audit migration implemented; [ ] API/UI activation pending

Migration: `supabase/migrations/048_customer_merge_history.sql`

Acceptance criteria:

1. Source and target must be distinct, active customers in the same account.
2. The operation moves canonical identities and conversations in one transaction.
3. The source customer remains with `status = merged`; it is not silently deleted.
4. `customer_merge_history` captures immutable pre-merge snapshots, reason, score, actor, and time.
5. Legacy `contacts` stay unchanged until their dedicated compatibility cutover.

### Stage 8: Provider adapters

Status: [x] Common contract and WhatsApp normalizer implemented; [ ] Webhook routing cutover pending

Changes:

1. `ChannelProvider` defines normalized inbound parsing and outbound send contracts.
2. `WhatsAppProvider` converts Meta Cloud messages into `NormalizedInboundEvent`.
3. Existing Meta/Twilio webhook verification and persistence paths remain authoritative during transition.
4. Instagram, Facebook, and TikTok adapters are not yet created.

### Stage 9: Instagram readiness

Status: [~] Meta app identified; [ ] product, credentials, and webhook pending

- Meta App: `seventh-barbershop` (`1118069360647176`).
- Current state: development mode, no granted privileges, and no privacy/support URLs.
- Required before activation: add Instagram Messaging, connect a professional Instagram account, create the `channel_accounts` record with encrypted token, and subscribe a verified HTTPS callback.
- Testing is restricted to app-role users until the app has the required access and is live.

### Stage 9 and 10: Meta social inbound pipeline

Status: [x] Implemented locally; [ ] external activation pending

Changes:

1. Instagram and Facebook providers normalize the common Meta Messenger webhook envelope and ignore outbound echoes.
2. Both webhook routes verify the raw HMAC payload, resolve a connected `channel_accounts` receiver, and acknowledge before asynchronous persistence.
3. Canonical social events create or update `customers`, `contact_identities`, `conversations`, and `messages` without creating legacy contacts.
4. Migration 049 removes only the legacy non-null requirements that prevented social-only customers and adds per-channel-account idempotency indexes.
5. Outbound social sending remains deliberately disabled until a connected account has a configured Meta send credential and product permission.
6. Settings → Channels now lets an administrator connect or update Instagram/Facebook receiver accounts; the Meta token is encrypted server-side and never returned by the API.

### Stage 11: Customer 360 read surface

Status: [x] Read API, list navigation, and profile detail implemented; [~] automated verification (production build pending); [ ] signed-in browser acceptance

Completion spec: `../.kiro/specs/customer-360-profile/spec.md`

- `GET /api/customers` lists the tenant-scoped canonical profiles with identities and conversation counts.
- `GET /api/customers/:id` returns a canonical profile and its channel activity.
- `POST /api/customers/:id/merge` activates the existing transactional merge RPC for agents.
- `/customers` presents a searchable, channel-oriented overview whose semantic cards open `/customers/:id`; legacy Contacts remains unchanged.
- `/customers/:id` renders canonical summary data, identity fallbacks and empty state, newest-first channel activity, Inbox deep-links, loading, 404, unauthorized, and recoverable failure states.
- Automated coverage validates card destinations, detail rendering, empty states, identity fallback labels, Inbox links, API account scoping, and API error behavior.

### Stage 12: TikTok rollout boundary

Status: [x] Capability boundary implemented; [ ] product/API access pending

`TikTokProvider` explicitly returns no inbound events and rejects outgoing messages. This prevents a connected-looking integration from silently dropping or sending traffic before the approved TikTok product supports messaging.

## User stories

### US-001: Single customer

Status: [~] Schema ready; runtime integration pending

WhatsApp and Instagram identities can point to the same canonical `customer_id`; the Instagram adapter has not been implemented yet.

### US-002: New identity

Status: [~] Schema ready; runtime integration pending

Unknown identities will create a customer only after the generic provider pipeline is introduced.

### US-003: Identity resolution

Status: [~] Deterministic rules unit-tested; persistence/review queue pending

Implemented rule order: existing external identity, normalized phone, normalized email, new customer. Name and username never auto-merge.

### US-004: Omnichannel conversation

Status: [~] Schema bridge ready; provider runtime pending

### US-005: New provider adapter

Status: [ ] Pending

## Validation

- [x] New resolver tests: known identity, phone match, unknown identity, email match.
- [x] Meta and Twilio identity projection tests passed with the Stage 5 change.
- [x] Pending identity-match candidate tests passed.
- [x] Customer-merge invariant tests passed.
- [x] WhatsApp provider-normalization tests passed.
- [x] Instagram, Facebook, and TikTok provider tests added.
- [x] Full project suite after Stage 9–12 local implementation: 85 files / 748 tests passed.
- [x] Stage 11 automated tests: 89 test files / 762 tests passed; TypeScript, ESLint, Prettier, and `git diff --check` passed.
- [~] Stage 11 final acceptance remains pending: complete the production build in a runner where its workers terminate, then complete the signed-in browser acceptance at desktop and mobile widths. The local runner has no authenticated test session, and both Turbopack/PostCSS and Webpack build workers did not terminate reliably.
- [x] TypeScript typecheck and ESLint passed after Stage 9–12 local implementation.
- [x] Full project suite at time of implementation: 79 files / 737 tests passed.
- [x] TypeScript typecheck passed.
- [x] New files pass Prettier and `git diff --check`.
- [x] SQL migrations applied and counted in Supabase: 357 customers, 380 identities, 356 conversations, and 2 channel accounts.
- [x] Canonical-reference integrity: no null `customer_id` in contacts, identities, or conversations; no null `channel_id` in channel accounts.
- [x] Migration 050 production smoke test: a temporary legacy contact created its canonical customer with matching bidirectional references; all temporary rows were removed afterward.
- [~] End-to-end WhatsApp regression from a previously unknown number is pending after the production migration 050 smoke test.

## WhatsApp inbound production incident

Production logs showed PostgreSQL error `23503` on
`customers_legacy_contact_id_fkey` while the webhook created previously unknown
contacts. Migration 045 installed `ensure_customer_for_legacy_contact` as a
`BEFORE INSERT` trigger, but the reverse foreign key from
`customers.legacy_contact_id` to `contacts.id` was immediate. PostgreSQL
therefore rejected the canonical customer before the new contact row became
visible, rolled back contact creation, and prevented the inbound message from
being stored. Existing contacts were unaffected, which made message delivery
appear intermittent.

Migration `050_defer_customer_legacy_contact_fk.sql` makes that foreign key
`DEFERRABLE INITIALLY DEFERRED`, so it is checked at transaction commit after
both rows exist. Migration 050 was applied in production and a database smoke
test successfully created a temporary contact and its canonical customer with
matching `contacts.customer_id` and `customers.legacy_contact_id` references.
The temporary records were removed successfully. Exercise an inbound message
from a number that has never contacted the CRM before marking the end-to-end
WhatsApp regression complete.

## Stage 4 execution note

Migrations 043 through 048 were applied manually through the Supabase SQL Editor. Validation used the configured service-role client and returned no missing canonical references. The WhatsApp runtime regression remains pending before production activation.

## Current progress

- Current stage: local implementation through Stage 12 is complete where it does not require third-party permissions; Stage 11 automated verification is complete.
- Immediate next action: perform the signed-in Customer 360 browser acceptance at desktop and mobile widths, then exercise a WhatsApp inbound message from a new number. Continue with the Instagram/Facebook channel activation afterward.

## Related files

- Core migration: `../supabase/migrations/045_customer_360_core.sql`
- Deferred legacy-contact FK fix: `../supabase/migrations/050_defer_customer_legacy_contact_fk.sql`
- Conversation bridge: `../supabase/migrations/046_omnichannel_conversation_bridge.sql`
- Deterministic resolver: `../src/lib/customers/identity-resolution.ts`
- Resolver tests: `../src/lib/customers/identity-resolution.test.ts`
- Review candidates: `../src/lib/customers/identity-match-candidates.ts`
- Merge validation: `../src/lib/customers/customer-merge.ts`
- Provider contract: `../src/lib/channels/provider.ts`
- Customer profile completion spec: `../.kiro/specs/customer-360-profile/spec.md`
