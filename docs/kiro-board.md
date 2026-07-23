# Kiro board - multi-account WhatsApp by session

This document is the versioned Kiro board for the multi-account implementation stream.

## Stages

- [x] Stage 0: Kickoff and scope definition
- [x] Stage 1: Multi-account membership model (compatibility)
- [x] Stage 2: Session active account (backend)
- [x] Stage 3: UI account switch (non-disruptive)
- [x] Stage 4: Security and regression testing
- [x] Stage 5: Gradual rollout with legacy fallback

## User stories

### US-01

As a user with multiple businesses,
I want to belong to multiple accounts,
So I can switch context without signing out.

Acceptance criteria:

1. User can have multiple account memberships.
2. If user has only one account, behavior remains unchanged.
3. Compatibility with profiles.account_id is preserved during transition.

Status: [x] Completed

### US-02

As an authenticated user,
I want to select an active account in my session,
So inbox, contacts, and settings run in that context.

Acceptance criteria:

1. activeAccountId exists per session.
2. If activeAccountId is missing, legacy fallback is used.
3. Existing API contracts remain stable.

Status: [x] Completed

### US-03

As a security administrator,
I want account switching to be limited to accounts where I am a member,
So unauthorized access is prevented.

Acceptance criteria:

1. Switch validates membership before applying.
2. Unauthorized account returns 403.
3. No data from unauthorized accounts is exposed.

Status: [x] Completed

### US-04

As an operational user,
I want to switch accounts from the existing UI without major redesign,
So UX stays stable with minimal learning.

Acceptance criteria:

1. Account selector is visible in header and sidebar.
2. Account-scoped data refreshes after switching.
3. Active account is clearly indicated.

Status: [x] Completed

### US-05

As a system owner,
I want to roll out multi-account switching gradually,
So production risk is reduced.

Acceptance criteria:

1. Feature flag enables/disables switching.
2. Legacy users remain on current flow.
3. No-regression target is validated before full rollout.

Status: [x] Completed

## Current progress

- Current stage: Stage 0-5 complete.
- Next action: Execute production activation window with Go/No-Go checklist and capture evidence log.

## Related docs

- Multi-account rollout runbook: ./multi-account-rollout.md
- Release window playbook: ./multi-account-release-window.md
- Release notes: ./multi-account-release-notes.md
- Go-live checklist: ./multi-account-go-live-checklist.md
