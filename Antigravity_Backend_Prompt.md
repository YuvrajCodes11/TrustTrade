# TrustTrade — Antigravity Backend Build Prompt

Paste this into Google Antigravity alongside your actual TrustTrade frontend repo.

---

You are building the production backend for TrustTrade, a trust/verification layer for peer-to-peer resale in India. A working frontend already exists — inspect it fully (data model, every function call, every simulated behavior) before writing any backend code. Build the API to match what the UI actually does, not a generic CRUD backend bolted on afterward.

## 1. STACK — use exactly this unless you find a concrete reason not to, and state the reason if you deviate
- Runtime: Node.js (LTS), TypeScript throughout — no plain JS.
- Framework: Express or Fastify (Fastify preferred for built-in schema validation and lower overhead) — pick one and be consistent.
- Database: PostgreSQL.
- ORM: Prisma (gives you migrations, type safety, and makes the schema audit in Section 9 easier to verify).
- Auth: JWT access tokens (short-lived, 15 min) + refresh tokens (httpOnly, secure, sameSite=strict cookie, 30 days, rotated on use).
- Validation: zod, applied on every route boundary.
- Rate limiting: express-rate-limit or fastify-rate-limit backed by Redis (not in-memory — in-memory limits reset on redeploy and don't work across multiple server instances).
- Logging: pino (structured JSON logs).
- File/image storage: S3-compatible object storage (AWS S3 or Cloudflare R2), never store uploads on the app server's local disk.
- Hosting: Railway or Render for the API, managed Postgres (Railway/Render/Supabase), Redis add-on for rate limiting and OTP storage.

## 2. DATA MODEL — build from the actual frontend, these are the confirmed entities
users: id (uuid), name, phone (unique, E.164 format), phone_verified_at, kyc_status (enum: none/pending/verified/rejected), kyc_provider_ref, banned (bool), banned_reason, created_at
listings: id, seller_id (FK), title, category (enum), price_inr (integer), condition (enum), description, photo_urls (text[]), protect_recommended (bool), status (enum: active/sold/removed), created_at
conversations: id, listing_id (FK), buyer_id (FK), seller_id (FK), created_at — unique constraint on (listing_id, buyer_id)
messages: id, conversation_id (FK), sender_id (FK), content (text), flagged (bool), flag_reason (text, nullable), created_at
transactions: id, listing_id (FK), buyer_id (FK), seller_id (FK), status (enum: none/active/completed/disputed/refunded), payment_provider_ref (nullable, Phase 2 placeholder), amount_inr, created_at, completed_at
disputes: id, transaction_id (FK), raised_by (FK), reason (text), status (enum: open/investigating/resolved_buyer/resolved_seller), resolution_notes, resolved_by (FK admin), created_at, resolved_at
reviews: id, transaction_id (FK), reviewer_id (FK), reviewee_id (FK), rating (1-5), comment (nullable), created_at — unique on (transaction_id, reviewer_id)
admin_roles: user_id (FK), granted_at, granted_by — do NOT use a boolean is_admin flag on the users table; use a separate table so admin grants are auditable
audit_log: id, actor_id, action, target_type, target_id, metadata (jsonb), created_at — every admin action (ban, dispute resolution, rule change) must write here

## 3. REAL AUTHENTICATION — replace the frontend's simulated OTP entirely
The current frontend generates a fake 4-digit OTP client-side and displays it on screen for demo purposes. That must not exist in production. Build real auth:
- POST /auth/otp/request { phone } → generate a 6-digit OTP server-side, store it in Redis with a 5-minute TTL keyed by phone, send via SMS provider (integrate MSG91 or Twilio Verify — pick one, put the API key in an environment variable, never hardcode or log it).
- POST /auth/otp/verify { phone, otp } → check against Redis, on success issue access + refresh tokens, create the user record if new (phone_verified_at = now()), delete the OTP from Redis immediately after use (single-use, not just TTL-expired).
- Rate-limit OTP requests: max 3 per phone per 10 minutes, max 10 per IP per hour. Wire this into the actual route — verify with a test that the 4th request in a window is rejected, don't just define a limiter and forget to attach it.
- Refresh flow: POST /auth/refresh reads the httpOnly cookie, rotates the refresh token (invalidate the old one), issues a new access token.
- Account recovery: since there's no password, recovery is inherently OTP-based — if a phone number is ever compromised or changed, require re-verification of the new number plus a cool-down/notification to the old number if one exists on file, to reduce account-takeover risk.
- Logout: invalidate the refresh token server-side (store a denylist or track valid token IDs in Redis), don't just delete the cookie client-side.

## 4. AUTHORIZATION AND DATA ISOLATION — the most important section, read carefully
Every request must be checked server-side against the authenticated user's id from the verified JWT — never trust a user id sent in the request body or query string.
- A user can only read/modify: their own listings, conversations they're a buyer or seller in, messages in those conversations, transactions they're party to, disputes they raised or are party to, reviews they wrote.
- Write an explicit authorization middleware/guard function used on every protected route — don't reimplement the check inline in each handler, that's how one gets missed.
- Required test suite: as authenticated User A, attempt every mutating and reading endpoint against a resource owned by User B (swap in B's listing id, conversation id, transaction id, etc.) and assert every one returns 403 or 404. This test suite is not optional — list it explicitly in your final audit as PASS or BLOCKER.
- If using Postgres directly (not just through Prisma app-layer checks), consider Row-Level Security policies as a second layer of defense, not a replacement for the application-layer checks.
- Admin routes require a row in admin_roles for the requesting user, checked server-side, and every admin action writes to audit_log.

## 5. INPUT VALIDATION AND API SECURITY
- Every route validates its input with a zod schema before touching the database — reject malformed/unexpected fields rather than silently ignoring them.
- Parameterized queries only (Prisma handles this by default — do not drop into raw SQL string interpolation anywhere).
- File uploads: validate MIME type and file size server-side (not just via the file extension), generate short-lived signed upload URLs to object storage rather than proxying uploads through your own server where possible.
- CORS restricted to the actual frontend origin(s) by exact match, not wildcard. CORS is not an authentication mechanism — don't treat it as one.
- Standard security headers on every response (helmet.js covers most of this for Express/Fastify: CSP, X-Content-Type-Options, X-Frame-Options, etc.).
- Sanitize any content that might ever be rendered as HTML to prevent stored XSS (message content, listing descriptions, dispute reasons).

## 6. SCAM-DETECTION ENGINE — server-side source of truth
The frontend prototype flags messages client-side using a fixed regex ruleset for instant UI feedback — that must be duplicated server-side and treated as the actual source of truth; never trust a "flagged" boolean sent from the client.
- On every message write, run it through the same rule set server-side, store the real flagged/flag_reason.
- Store the ruleset in a config table (not hardcoded in application code) so moderators can add/edit rules without a redeploy — expose an admin-only endpoint to manage rules, fully audit-logged.

## 7. TRUST SCORE
- Compute server-side only, using the same formula as the prototype (verified +35, completed trades +6 each capped at 30, average rating × 6, disputes against them −12 each, account age bonus). No endpoint should allow a client to set or override this value directly.
- Recompute on read for now; move to a scheduled job with caching only if this becomes a measurable performance issue at scale — don't pre-optimize.

## 8. DISPUTES AND MODERATION
- POST /disputes: only a party to a completed transaction, only within 48 hours of transaction.completed_at — enforce this window server-side.
- Admin-only resolution endpoints; every resolution writes to audit_log with the admin's id, the decision, and the reasoning.

## 9. PAYMENTS — explicitly out of scope for this build
Do not integrate live payments or escrow. Leave transactions.payment_provider_ref and amount_inr as schema placeholders for a future Cashfree Easy Split or Razorpay Route integration. The "active"/"completed" transaction states in this phase represent a logged agreement between two verified parties, not real money movement — do not build or imply any payment confirmation UI or logic that suggests otherwise.

## 10. RATE LIMITING (beyond OTP, covered in Section 3)
Apply Redis-backed limits to: message sending, listing creation, dispute creation, review submission, and any admin action. Confirm each is actually attached to its route in your final audit, not just defined as a utility.

## 11. ERROR HANDLING
- Centralized error-handling middleware. Every 400/401/403/404/409/422/429/500 returns a consistent JSON shape: { error: { code, message } }.
- Never expose stack traces, SQL errors, internal file paths, or infrastructure details in any response — log the real error internally via pino, return a generic message externally.
- Handle and test: database connection failures, third-party API timeouts (SMS/KYC provider down), malformed JSON bodies, oversized payloads.

## 12. LOGGING AND MONITORING
- Structured logs (pino) for: all auth failures, all 403 authorization failures, KYC/SMS provider failures, all 5xx errors, all admin actions.
- Never log: OTPs, JWT contents, refresh tokens, raw KYC documents/numbers, passwords (n/a here, but the principle applies to any future secret).
- Set up at minimum a webhook-based alert (Slack/Discord) for error-rate spikes and third-party provider outages — this doesn't need to be sophisticated at this stage, it needs to exist.

## 13. DATABASE PERFORMANCE
Add indexes on: users.phone (unique), listings(seller_id, status), conversations(listing_id, buyer_id) unique, messages(conversation_id), transactions(listing_id, buyer_id), disputes(transaction_id), reviews(transaction_id, reviewer_id) unique. Don't index everything blindly — index what's actually queried, and say why for each one.
Use Prisma Migrate for all schema changes — no manual production schema edits, ever.

## 14. KYC INTEGRATION
- Integrate one vendor (IDfy, HyperVerge, or Signzy — pick one, document the choice, and design the integration behind an interface so the vendor is swappable later).
- Store only a verification status and vendor reference token in your own database. Do not store raw Aadhaar/PAN numbers or ID images longer than the vendor's own flow requires — confirm and mirror their data retention policy (DPDP Act data-minimization requirement).
- Handle vendor timeouts and rejections explicitly with real user-facing states — never default to "verified" on any error path.

## 15. DEPLOYMENT, SECRETS, AND ROLLBACK
- All secrets (DB URL, JWT signing secret, SMS provider key, KYC vendor key, S3 credentials, Redis URL) via environment variables — none hardcoded, none committed, add a .env.example with placeholder names only.
- Health check endpoint (/health) for uptime monitoring.
- Use the hosting platform's built-in rollback to a previous deploy if something breaks — confirm this actually works before calling it done, don't just assume the platform supports it.
- Document precisely what I need to provide manually: SMS provider account + API key, KYC vendor account + API key, Postgres connection string, Redis connection string, S3/R2 bucket + credentials, production domain (for CORS and any callback URLs).

## 16. TESTING
- The authorization test suite from Section 4 is mandatory, not optional.
- Unit tests for: trust score calculation, scam-detection rule matching, OTP generation/expiry/single-use behavior.
- Integration tests for the full signup → verify → list → chat → transaction → review flow.

## 17. FINAL PRODUCTION SECURITY AUDIT — go through this explicitly, item by item
Check for and report on each: hardcoded secrets anywhere in the codebase, exposed API keys, debug mode left on, any test/seed accounts reachable in production, mock data reachable in production, unprotected admin routes, missing auth on any route, missing authorization checks (cross-reference Section 4's test suite), insecure cookie flags, missing security headers, dependency vulnerabilities (run npm audit), environment variable handling, CORS configuration, storage bucket public/private permissions, session/token handling correctness.
Do not grep for words like "auth" or "rateLimit" and assume the feature works — trace the actual request flow for each and verify the behavior.

## 18. DELIVERABLE FORMAT — classify every item above
For each section, report:
PASS — verified working
FIXED — was missing or broken, now fixed
WARNING — implemented but has a real limitation I should know about
UNVERIFIED — could not test without credentials I don't have
BLOCKER — needs a decision or credential from me before it can be completed
List explicitly anything requiring my action — don't silently skip it.

## 19. CONTEXT LIMIT CHECKPOINT
If you approach your context/token limit before finishing, stop and give me: what's fully done, what's in progress, what's not started, key architectural decisions made and why, files/areas changed, what you verified vs. couldn't verify, and the exact next steps to continue from. Do not silently keep going until you run out of context, and do not claim something is finished if it hasn't actually been verified.
