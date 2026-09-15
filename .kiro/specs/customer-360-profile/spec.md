# Kiro spec - Customer 360 profile navigation

## Status

- Spec: ready for implementation
- Delivery stage: not started
- Owner: WACRM
- Related board: `kiro-customer-360.md`, Stage 11

## Problem statement

The Customer 360 list renders cards with hover feedback and the label "Vista de
perfil canónico", but the cards are static `<article>` elements. Selecting a
card has no effect, and the application has no `/customers/[id]` page even
though `GET /api/customers/:id` already exposes the canonical profile and its
channel activity.

This creates a false interaction affordance and prevents agents from inspecting
the identities and conversations grouped under a canonical customer.

## Goal

Make every Customer 360 card an accessible entry point to a read-only customer
profile that shows canonical data, channel identities, and conversations, with
links that open each conversation in the existing inbox.

## Scope

### Included

- Navigate from `/customers` to `/customers/[id]` by selecting a card.
- Support mouse, keyboard, modified clicks, and opening in a new tab through a
  semantic link.
- Render canonical customer information, identities, and channel activity.
- Open an existing conversation through `/inbox?c={conversationId}`.
- Handle loading, empty, unauthorized, not-found, and unexpected-error states.
- Preserve account isolation through the existing viewer-scoped API.
- Add automated coverage for navigation and detail states.

### Excluded

- Editing canonical customer fields.
- Merging customers or building the merge-review UI.
- Deleting customers or identities.
- Sending messages directly from the profile.
- Changing Customer 360 database tables or applying another migration.
- Activating Instagram, Facebook, or TikTok providers.

## User stories

### US-360-01: Open a canonical profile

As an account member, I want to select a customer card so that I can inspect the
person represented by the canonical profile.

### US-360-02: Understand channel identities

As an agent, I want to see the customer's identities grouped by channel so that
I understand how the person contacts the business.

### US-360-03: Continue a conversation

As an agent, I want to open a conversation from the profile so that I can
continue working in the existing inbox.

## EARS requirements

### Functional requirements

#### REQ-360-01 — Card navigation

WHEN a user selects a customer card, THE SYSTEM SHALL navigate to
`/customers/{customerId}` for that card.

#### REQ-360-02 — Semantic interaction

THE SYSTEM SHALL expose each customer card as a semantic link with a visible
focus state and an accessible name derived from the customer's display name.

#### REQ-360-03 — Detail retrieval

WHEN `/customers/{customerId}` is opened, THE SYSTEM SHALL request
`GET /api/customers/{customerId}` and render only the customer returned for the
authenticated account.

#### REQ-360-04 — Canonical summary

WHEN customer detail is available, THE SYSTEM SHALL display the canonical name,
status, phone, email, identity count, and conversation count.

#### REQ-360-05 — Identity list

WHERE the customer has channel identities, THE SYSTEM SHALL display each
identity's channel and the best available label in this order: username,
display name, external identifier.

#### REQ-360-06 — Empty identities

WHERE the customer has no channel identities, THE SYSTEM SHALL display an
explicit empty state instead of an empty container.

#### REQ-360-07 — Conversation activity

WHERE the customer has conversations, THE SYSTEM SHALL display each
conversation's channel, connected account label, status, last message preview,
and last activity time when those values are available.

#### REQ-360-08 — Open inbox conversation

WHEN a user selects a conversation in the customer profile, THE SYSTEM SHALL
navigate to `/inbox?c={conversationId}`.

#### REQ-360-09 — Empty conversations

WHERE the customer has no conversations, THE SYSTEM SHALL state that no channel
activity has been recorded.

#### REQ-360-10 — Loading state

WHILE customer detail is being requested, THE SYSTEM SHALL display a stable
loading layout that does not present stale data from another customer.

#### REQ-360-11 — Not found

IF the detail API returns HTTP 404, THEN THE SYSTEM SHALL display a customer
not-found state with a link back to `/customers`.

#### REQ-360-12 — Unauthorized access

IF the detail API returns HTTP 401 or 403, THEN THE SYSTEM SHALL preserve the
application's existing authentication behavior and SHALL NOT expose customer
data.

#### REQ-360-13 — Unexpected failure

IF the detail request fails unexpectedly, THEN THE SYSTEM SHALL display a
recoverable error state with retry and back actions.

#### REQ-360-14 — Direct URL access

WHEN an authorized user opens a valid `/customers/{customerId}` URL directly,
THE SYSTEM SHALL render the same profile shown after card navigation.

#### REQ-360-15 — Back navigation

WHEN a user activates the profile's back action, THE SYSTEM SHALL return to the
Customer 360 list without requiring a full page reload.

### Non-functional requirements

#### REQ-360-16 — Tenant isolation

THE SYSTEM SHALL enforce customer access by both authenticated membership and
`account_id`; a client-provided customer ID SHALL NOT bypass account isolation.

#### REQ-360-17 — Responsive presentation

WHILE the viewport is narrower than the desktop layout, THE SYSTEM SHALL stack
the summary, identities, and conversations without horizontal page overflow.

#### REQ-360-18 — Accessibility

THE SYSTEM SHALL preserve keyboard navigation, visible focus, meaningful
headings, link semantics, and text labels that do not rely on color alone.

#### REQ-360-19 — Compatibility

THE SYSTEM SHALL leave `/contacts` and the legacy WhatsApp contact workflow
unchanged.

## Design

### Route structure

```text
/customers
  └── semantic card link → /customers/[id]
                              ├── canonical summary
                              ├── channel identities
                              └── conversation link → /inbox?c=[conversationId]
```

Add the dashboard route:

```text
src/app/(dashboard)/customers/[id]/page.tsx
```

The route should render a dedicated client component, proposed as:

```text
src/components/customers/customer-360-detail-page.tsx
```

### Data contract

Reuse `GET /api/customers/[id]`. Keep authorization in
`requireRole('viewer')` and retain the `account_id` filter. The response must
provide:

- Canonical fields: `id`, `display_name`, `first_name`, `last_name`, `email`,
  `phone`, `status`, `created_at`, and `updated_at`.
- Identities: `id`, `channel`, `username`, `display_name`, `external_id`,
  `phone`, and `last_seen_at` when present.
- Conversations: `id`, `status`, `last_message_text`, `last_message_at`, plus
  the related channel-account `channel` and `display_name`.

Define shared Customer 360 response types outside the list component so the
list and detail views do not maintain incompatible local copies.

### List interaction

Wrap the entire card content in Next.js `Link` targeting
`/customers/${customer.id}`. Do not simulate navigation with only an `onClick`
handler. Add `focus-visible` styling and a pointer cursor while retaining the
existing hover treatment.

### Detail presentation

The first delivery is read-only and contains three sections:

1. Profile header with back action, canonical name, status, and contact fields.
2. Channel identities with a channel badge and best available identity label.
3. Conversation activity ordered newest-first, with each row linking to the
   existing inbox query parameter `c`.

Dates should be formatted for the current locale. Missing optional values must
use concise placeholders and must not render strings such as `null` or
`undefined`.

### Error behavior

- Loading: render skeletons or a stable placeholder layout.
- Empty collections: render purpose-specific explanatory text.
- 404: render "Cliente no encontrado" and a return link.
- 401/403: use the established authentication/session handling.
- Network or 5xx error: render retry and return actions.

No detail from a previously opened customer may remain visible while another
customer ID is loading.

### Security

- Treat the route parameter as untrusted input.
- Do not query Supabase directly from the client for detail data.
- Keep authorization and tenant filtering in the API route.
- Do not include provider credentials or channel-account metadata in the
  response.

## Implementation plan

- [x] 11.1 Read the installed Next.js 16 route, dynamic-segment, Link, loading,
      and error-handling guides under `node_modules/next/dist/docs/` before coding.
      _Requirements: project AGENTS.md_

- [x] 11.2 Extract shared `Customer360Summary`, `Customer360Identity`, and
      `Customer360Conversation` types for the list, API response, and detail view.
      _Requirements: REQ-360-03 through REQ-360-09_

- [x] 11.3 Update the customer-detail API selection and response typing to
      return only the fields required by the profile, preserving viewer role and
      account filters.
      _Requirements: REQ-360-03, REQ-360-07, REQ-360-12, REQ-360-16_

- [x] 11.4 Convert every list card to a semantic Next.js link with hover,
      pointer, focus-visible, and accessible-name behavior.
      _Requirements: REQ-360-01, REQ-360-02, REQ-360-18_

- [x] 11.5 Add `/customers/[id]` and the read-only detail component with the
      canonical summary and back action.
      _Requirements: REQ-360-03, REQ-360-04, REQ-360-14, REQ-360-15_

- [x] 11.6 Implement the channel-identity section, including fallback labels
      and its empty state.
      _Requirements: REQ-360-05, REQ-360-06_

- [x] 11.7 Implement the newest-first conversation activity section and link
      rows to `/inbox?c={conversationId}`.
      _Requirements: REQ-360-07, REQ-360-08, REQ-360-09_

- [x] 11.8 Add loading, 404, unauthorized, unexpected-error, and retry states;
      ensure stale profile data is cleared when the ID changes.
      _Requirements: REQ-360-10 through REQ-360-14_

- [ ] 11.9 Verify responsive layout and keyboard-only operation at mobile,
      tablet, and desktop breakpoints.
      _Requirements: REQ-360-17, REQ-360-18_

- [x] 11.10 Add automated tests for card destinations, successful detail
      rendering, identity-label fallbacks, empty states, inbox links, 404, retry,
      and account-isolation behavior.
      _Requirements: REQ-360-01 through REQ-360-18_

- [ ] 11.11 Run targeted tests, full test suite, TypeScript typecheck, ESLint,
      Prettier check, production build, and `git diff --check`.
      _Requirements: all_

- [ ] 11.12 Perform a signed-in browser regression: open a card, reload the
      direct detail URL, open a conversation in Inbox, navigate back, test a
      nonexistent ID, and repeat at a mobile viewport.
      _Requirements: REQ-360-01, REQ-360-08, REQ-360-11, REQ-360-14 through
      REQ-360-18_

- [ ] 11.13 Mark Stage 11 fully verified in `kiro-customer-360.md` after the
      remaining signed-in browser acceptance checks pass. The board now records
      the completed automated verification and this explicit manual hold.
      _Requirements: all_

## Acceptance matrix

| Scenario                              | Expected result                            |
| ------------------------------------- | ------------------------------------------ |
| Select a card                         | Opens `/customers/{id}`                    |
| Keyboard-focus a card and press Enter | Opens the same customer profile            |
| Open profile URL directly             | Loads the authorized canonical customer    |
| Customer belongs to another account   | No customer data is exposed                |
| Customer has multiple identities      | All identities appear with channel labels  |
| Customer has no identities            | Identity empty state appears               |
| Customer has conversations            | Newest activity appears first              |
| Select a conversation                 | Opens `/inbox?c={conversationId}`          |
| Unknown customer ID                   | Not-found state and back link appear       |
| API/network failure                   | Retry and back actions appear              |
| Mobile viewport                       | Sections stack without horizontal overflow |
| Legacy Contacts workflow              | Behavior remains unchanged                 |

## Definition of done

- All requirements REQ-360-01 through REQ-360-19 are implemented or explicitly
  waived with rationale.
- The automated and browser acceptance checks pass.
- No database migration is introduced for this UI delivery.
- No regression is introduced in `/contacts` or `/inbox`.
- Stage 11 in the main Customer 360 Kiro board reflects the verified result.

## Risks and mitigations

| Risk                                                | Mitigation                                                                  |
| --------------------------------------------------- | --------------------------------------------------------------------------- |
| Card looks clickable but is not keyboard accessible | Use a semantic `Link` around the card                                       |
| Customer ID is used without tenant filtering        | Retain viewer authorization and `account_id` filtering in the API           |
| Detail and list types drift                         | Use shared Customer 360 response types                                      |
| Inbox opens without selecting the intended thread   | Reuse the established `?c=` conversation query parameter                    |
| Old customer data flashes during navigation         | Clear detail state when the route ID changes and use a stable loading state |
| Scope expands into merge/edit workflows             | Keep this delivery read-only and track those workflows separately           |

## Rollout and rollback

This change requires no database migration or feature flag. Deploy it through
the normal application pipeline after all checks pass. Rollback consists of
reverting the UI/API commit; canonical customer data remains unchanged.
