# API Design — REST Conventions

## URL Structure

```
GET    /api/v1/users              List (paginated)
GET    /api/v1/users/:id          Get one
POST   /api/v1/users              Create
PATCH  /api/v1/users/:id          Partial update
PUT    /api/v1/users/:id          Full replace (rare)
DELETE /api/v1/users/:id          Delete
```

- Plural nouns for collections: `/users`, not `/user`
- Nested resources max 2 levels: `/users/:id/orders`, not `/users/:id/orders/:orderId/items`
- Version prefix: `/api/v1/` — only bump on breaking changes
- Query params for filtering, sorting, pagination: `?status=active&sort=-createdAt&page=2&limit=20`

## Pagination

```typescript
interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

// Implementation
const page = Math.max(1, Number(req.query.page) || 1);
const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
const offset = (page - 1) * limit;

const [data, total] = await Promise.all([
  db.user.findMany({ skip: offset, take: limit, where: filters }),
  db.user.count({ where: filters }),
]);

return {
  data,
  meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
};
```

- Default limit: 20, max limit: 100
- Page-based (not cursor-based) for simple CRUD. Cursor-based for feeds/timelines.
- Always return `meta` with total count and pagination info.

## Error Responses

```typescript
// Consistent error shape
interface ErrorResponse {
  error: {
    code: string;          // Machine-readable: "VALIDATION_FAILED", "NOT_FOUND"
    message: string;       // Human-readable
    details?: unknown;     // Validation errors, field-level info
  };
}

// HTTP status mapping
// 400 — validation error, bad input
// 401 — not authenticated
// 403 — authenticated but not authorized
// 404 — resource not found
// 409 — conflict (duplicate, version mismatch)
// 422 — semantically invalid (business rule violation)
// 429 — rate limited
// 500 — unexpected server error (never expose internals)
```

## Response Shaping

Never return database models directly. Use explicit response types.

```typescript
// ✗ Bad — leaks internal fields
return res.json(user);

// ✓ Good — explicit shape
return res.json({
  id: user.id,
  email: user.email,
  name: user.name,
  createdAt: user.createdAt.toISOString(),
});
```

## Versioning

- URL-based: `/api/v1/`, `/api/v2/`
- Only create v2 when breaking changes are unavoidable
- Run v1 and v2 in parallel during migration
- Deprecation: add `Deprecation` and `Sunset` headers to v1 responses

## Never

- **No verbs in URLs** — `POST /api/users`, not `POST /api/createUser`
- **No unbounded queries** — always paginate list endpoints
- **No internal IDs in error messages** — return codes, not database details
- **No 200 for errors** — use appropriate 4xx/5xx status codes
