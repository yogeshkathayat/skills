---
name: nextjs
version: 2.0.0
description: |
  Next.js App Router reference skill covering pages, layouts, components, metadata, i18n,
  API-backed data access, server actions, caching, accessibility, analytics, and testing. Use when
  the task touches a Next.js code path and should follow the project's App Router conventions.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
paths:
  - "app/**/*.ts"
  - "app/**/*.tsx"
  - "src/**/*.ts"
  - "src/**/*.tsx"
  - "components/**/*.ts"
  - "components/**/*.tsx"
  - "messages/**/*.json"
  - "next.config.*"
  - "proxy.ts"
  - "middleware.ts"
  - "tests/**/*.ts"
  - "tests/**/*.tsx"
  - "playwright.config.*"
argument-hint: "[Next.js page, component, route, or caching task]"
arguments:
  - request
when_to_use: |
  Use when the task touches Next.js pages, layouts, components, routing, metadata, server actions,
  caching, i18n, logging, analytics, or tests. Examples: "build this App Router page", "fix this
  server action", "update metadata", "wire translations", "change caching behavior".
effort: high
---

<EXTREMELY-IMPORTANT>
This skill is a routing shell over the Next.js reference set, not the full framework manual.

Non-negotiable rules:
1. Read `references/stack.md` first.
2. Then load only the references needed for the actual task.
3. Keep user-visible text translated.
4. Keep data access in the project’s API-client pattern.
5. Keep the heavy Next.js guidance in `references/`, not inline here.
</EXTREMELY-IMPORTANT>

# nextjs

## Inputs

- `$request`: The Next.js page, component, routing, caching, or testing task

## Goal

Route Next.js work through the project's App Router conventions so implementation follows the established patterns for data access, metadata, localization, and rendering boundaries.

## Step 0: Read the stack contract

Always start with:

- `references/stack.md`

That establishes the locked decisions for runtime, config, and project-wide Next.js patterns.

**Success criteria**: The project’s Next.js architecture assumptions are explicit before editing.

## Step 1: Load only the relevant references

Use the routing table to pick reference files that match the task. Do not bulk-load the full reference tree.

| Task | Read |
|------|------|
| Folder layout, file conventions, project structure | `references/folder-structure.md` |
| Route groups, dynamic routes, parallel/intercepting routes | `references/routing.md` |
| Creating or editing a page or layout | `references/page-checklist.md` |
| Component structure, client/server boundaries | `references/component-anatomy.md` |
| Data fetching, API client, fetch wrappers | `references/api-client-pattern.md` |
| Server actions, mutations, revalidation | `references/server-actions.md` |
| Caching, ISR, on-demand revalidation | `references/caching-strategy.md` |
| Translations, locale routing, message files | `references/i18n-conventions.md` |
| Error boundaries, error.tsx, not-found.tsx | `references/error-handling.md` |
| Structured logging, log levels | `references/logging.md` |
| Analytics, event tracking, consent | `references/tracking.md` |
| Authentication, middleware, session | `references/auth.md` |
| Security headers, CSP, CSRF, rate limiting | `references/security.md` |
| SEO, metadata, Open Graph, sitemap | `references/seo.md` |
| Accessibility, ARIA, keyboard navigation | `references/accessibility.md` |
| Unit tests, component tests | `references/testing-unit.md` |
| E2E tests, Playwright | `references/testing-e2e.md` |
| Machine-readable output, JSON-LD, structured data | `references/machine-readable.md` |

Multiple tasks? Read multiple files. The references are self-contained.

**Success criteria**: The active context only contains the task-relevant Next.js conventions.

## Step 2: Implement with the core Next.js guardrails

Keep these rules active:

- async request-bound APIs are awaited
- data access uses the project API client, not ad hoc fetches or ORM calls
- visible strings go through the localization layer
- pages and layouts stay server-first unless a leaf component truly needs client mode
- metadata and SEO requirements stay attached to page work

**Success criteria**: The change fits the project’s App Router architecture instead of generic framework defaults.

## Step 3: Verify the affected surface

Use the narrowest relevant verification:

- unit tests
- e2e tests
- linting or type checks
- page or route smoke validation

**Success criteria**: The changed Next.js surface still behaves correctly.

## Guardrails

- Do not inline the whole Next.js handbook in `SKILL.md`.
- Do not skip `references/stack.md`.
- Do not hardcode user-facing strings when i18n is required.
- Do not bypass the project’s API-client and caching conventions.
- Do not add `disable-model-invocation`; this is a normal domain skill.

## When To Load References

- `references/stack.md`
  Always.

- then only the task-relevant files under `references/`

## Output Contract

Report:

1. which Next.js references were loaded
2. the architecture pattern chosen
3. the change made
4. the verification run
