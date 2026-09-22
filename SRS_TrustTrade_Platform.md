# Software Requirements Specification (SRS)

## Project: TrustTrade — Verified P2P Resale & Safe-Trade Platform for India

**Version:** 1.0 (Draft)
**Prepared for:** Yuvraj
**Document type:** SRS (IEEE 830-style structure, adapted for a startup MVP)

---

## 1. Introduction

### 1.1 Purpose
This document specifies the functional and non-functional requirements for **TrustTrade**, a trust and safety layer for peer-to-peer (P2P) resale in India (used electronics, furniture, vehicles, and other second-hand goods currently traded on OLX, Facebook Marketplace, Quikr, and WhatsApp resale groups). The purpose of TrustTrade is to reduce fraud in P2P transactions by providing identity verification, scam-pattern detection, safe-meetup coordination, and (in a later phase) payment protection.

### 1.2 Scope
TrustTrade is **not** a listings marketplace competing with OLX/Facebook Marketplace. It is a **trust layer** that sits alongside existing marketplaces:
- Users can link/paste an existing OLX/FB Marketplace listing OR create a native listing.
- Both buyer and seller can verify identity, chat safely, get real-time scam-pattern warnings, and (Phase 2) transact through a protected payment flow.
- Out of scope for v1: full listings marketplace with search/discovery competing head-on with OLX; holding user funds directly (regulatory reasons — see Section 2.5); logistics/shipping.

### 1.3 Definitions, Acronyms, Abbreviations
| Term | Meaning |
|---|---|
| KYC | Know Your Customer — identity verification |
| OTP | One-Time Password |
| PPI | Prepaid Payment Instrument (RBI-regulated) |
| Escrow | Third party holds funds until conditions are met |
| Verified Badge | Visual trust indicator on a user profile |
| Scam-pattern detection | Automated detection of known fraud scripts in chat |
| MVP | Minimum Viable Product |
| RBI | Reserve Bank of India |
| DPDP Act | Digital Personal Data Protection Act, 2023 (India) |

### 1.4 References
- RBI Payment and Settlement Systems Act, guidelines on Payment Aggregators/PPIs
- DPDP Act 2023 (India) — personal data handling
- Razorpay Route / Escrow+ documentation
- OLX Safer Internet Day Study (fraud prevalence data)

### 1.5 Overview
Section 2 describes the product at a high level. Section 3 gives detailed functional requirements. Section 4 covers external interfaces. Section 5 covers non-functional requirements. Section 6 covers data requirements. Section 7 covers the phased roadmap.

---

## 2. Overall Description

### 2.1 Product Perspective
TrustTrade is a new, standalone mobile-first web app (PWA or native app later) with a companion **browser extension** (optional, Phase 2) that can overlay trust signals directly onto OLX/Facebook Marketplace listings. Core product is independent of any existing marketplace.

### 2.2 Product Functions (Summary)
1. User onboarding with phone + government ID verification
2. Verified Badge issuance
3. Listing creation or linking an external listing
4. In-app chat between buyer and seller
5. Real-time scam-pattern detection engine scanning chat messages
6. Safe-meetup suggestion (public, well-lit, camera-covered locations; partnered locations in Phase 2)
7. Transaction logging and dispute filing
8. Ratings and reviews post-transaction
9. Admin moderation dashboard
10. (Phase 2) Protected payment flow via Razorpay Route with hold/release logic
11. (Phase 3) Full escrow via Razorpay Escrow+ once company is incorporated and has transaction volume

### 2.3 User Classes and Characteristics
| User class | Description | Technical proficiency |
|---|---|---|
| Buyer | Wants to purchase a used item safely | Low–medium |
| Seller | Wants to sell a used item and reach verified buyers | Low–medium |
| Admin/Moderator | Reviews flagged accounts, disputes, fraud reports | High |
| Support Agent | Handles dispute mediation | Medium |

### 2.4 Operating Environment
- **Client:** Android (primary, since majority of Indian users are Android-first), Progressive Web App for cross-platform reach, iOS in a later phase.
- **Server:** Cloud-hosted (AWS/GCP Mumbai region for data residency and latency).
- **Network:** Must work reasonably on 4G in tier-2/3 cities; optimize payload sizes.

### 2.5 Design and Implementation Constraints
- **Regulatory constraint:** TrustTrade **cannot hold user funds directly** in v1/v2 without a Payment Aggregator (PA) license from RBI, which requires a registered company, minimum net worth requirements, and a lengthy approval process. Payment protection in early phases must be implemented via a **licensed third party** (Razorpay Route with hold/release logic) rather than a self-built wallet/escrow.
- **Data protection constraint:** Government ID data (Aadhaar/PAN/Driving License) is sensitive personal data under the DPDP Act. Must not be stored in plaintext; must use a licensed verification API (e.g., DigiLocker-based, Karza, IDfy, Signzy, HyperVerge) rather than storing raw ID images/numbers on our own servers wherever possible.
- **Cost constraint:** ID verification APIs charge per verification (typically ₹3–15 per check depending on provider and check type) — this must be priced into the "verified seller" fee.

### 2.6 Assumptions and Dependencies
- Assumes access to a third-party KYC/identity verification API (not building this in-house).
- Assumes Razorpay Route (or Cashfree equivalent) can be integrated without full Escrow+ in Phase 2.
- Assumes smartphone + UPI penetration among target users (already very high in urban/semi-urban India).

---

## 3. Functional Requirements (Detailed)

### 3.1 User Registration & Verification
**FR-1.1** System shall allow registration via mobile number + OTP.
**FR-1.2** System shall allow optional email addition for account recovery.
**FR-1.3** System shall integrate with a third-party KYC API to verify:
  - Government ID (Aadhaar/PAN/DL) authenticity
  - Name-match between ID and profile
  - Liveness check (selfie match against ID photo) to prevent stolen-ID reuse
**FR-1.4** Upon successful verification, system shall issue a **Verified Badge** visible on the user's profile and listings.
**FR-1.5** System shall allow users to remain on the platform unverified but restrict them from certain actions (e.g., cannot initiate high-value chats above a configurable threshold, e.g., ₹10,000, without verification).
**FR-1.6** System shall store only a verification status (boolean/token) + non-sensitive metadata locally; raw ID data shall reside with the KYC vendor per DPDP-compliant data flow, not in TrustTrade's own database, unless legally required for dispute evidence, in which case it must be encrypted at rest.

### 3.2 Listing Management
**FR-2.1** Users shall be able to create a listing with: title, category, price, description, up to 8 photos, condition (new/like-new/used/for parts).
**FR-2.2** Users shall be able to **paste an external URL** (OLX/FB Marketplace) to import listing details (title, price, photos) via scraping/OG-tag parsing, and mark it as "Verify this trade."
**FR-2.3** System shall categorize listings (Electronics, Furniture, Vehicles, Appliances, Other) with category-specific fields (e.g., IMEI field for phones, registration number for vehicles).
**FR-2.4** System shall allow sellers to mark high-risk categories (phones, laptops, vehicles) for mandatory escrow/protected payment recommendation.

### 3.3 Chat & Scam Detection
**FR-3.1** System shall provide in-app chat between buyer and seller once a listing conversation is initiated.
**FR-3.2** System shall run every incoming/outgoing message through a **scam-pattern detection engine** that flags known fraud scripts, including but not limited to:
  - Requests to scan a QR code to "receive" payment (classic UPI-reversal scam)
  - Claims of being defense/police personnel unable to meet in person
  - Requests for advance deposit before any verification
  - Fake courier/shipping insurance payment requests
  - Overpayment-then-refund requests
**FR-3.3** On detection, system shall show an **inline warning banner** to the potential victim in real time (e.g., "⚠️ This matches a known UPI scam. Never scan a QR code to receive money.") without needing the user to leave the chat.
**FR-3.4** System shall allow either party to report a chat/user for review by moderators.
**FR-3.5** System shall log flagged conversations (with consent per ToS) for continuous improvement of the detection model and for evidence in disputes.

### 3.4 Safe Meetup Coordination
**FR-4.1** System shall suggest public, well-lit meeting locations near both parties (police station help desks where "safe exchange zones" exist, malls, cafés) — Phase 1: static curated list per city; Phase 2: partnered/verified physical "TrustTrade Points" (e.g., at partner cafés/retail counters) with optional CCTV coverage.
**FR-4.2** System shall allow users to share live location with each other only for the duration of the meetup (auto-expiring share).
**FR-4.3** System shall allow a user to designate an emergency contact to be notified with the meetup location/time.

### 3.5 Payment Protection (Phase 2)
**FR-5.1** System shall integrate Razorpay Route to enable a hold-and-release payment flow:
  - Buyer pays into a linked account.
  - Funds are held (not yet released to seller).
  - Buyer confirms item received/matches description → funds released to seller.
  - Dispute raised → funds frozen pending moderator review.
**FR-5.2** System shall charge a protection fee (1–3%, configurable) only on transactions using protected payment, clearly disclosed before payment.
**FR-5.3** System shall NOT process protected payments for categories/amounts outside what the payment partner's compliance allows.

### 3.6 Verified Seller / Trust Score
**FR-6.1** System shall compute a Trust Score per user based on: verification status, completed transaction count, ratings, dispute history, account age.
**FR-6.2** System shall display Trust Score and badges prominently on profile and within chat.

### 3.7 Ratings & Reviews
**FR-7.1** After a marked-complete transaction, both parties shall be prompted to rate each other (1–5 stars + optional text).
**FR-7.2** Reviews shall be immutable once submitted (editable only by admin in abuse cases).

### 3.8 Dispute Resolution
**FR-8.1** Either party shall be able to open a dispute within a configurable window (e.g., 48 hours) post-transaction.
**FR-8.2** System shall route disputes to a moderator queue with chat logs, photos, and transaction metadata attached.
**FR-8.3** Moderator shall be able to: release funds to seller, refund buyer, or escalate to manual investigation.

### 3.9 Admin/Moderation Panel
**FR-9.1** Admin shall be able to view flagged users, flagged conversations, and open disputes in a single dashboard.
**FR-9.2** Admin shall be able to suspend/ban accounts, and blacklist phone numbers/device IDs associated with confirmed fraud.
**FR-9.3** Admin shall be able to update the scam-pattern detection ruleset without a full app redeploy (rules stored server-side/config-driven).

### 3.10 Notifications
**FR-10.1** System shall send push/SMS notifications for: new messages, scam warnings, meetup reminders, payment status changes, dispute updates.

---

## 4. External Interface Requirements

### 4.1 User Interfaces
- Mobile-first responsive web app (React/Next.js) or Flutter for native Android/iOS.
- Key screens: Onboarding/KYC, Home Feed/Search (Phase 2), Listing Detail, Chat, Trade Summary, Profile, Dispute Center, Admin Dashboard (separate web app).

### 4.2 Hardware Interfaces
- Device camera (for liveness check during KYC, and for photo capture of items/condition proof).
- Device GPS (for live location sharing during meetups).

### 4.3 Software Interfaces
| Interface | Purpose | Candidate providers |
|---|---|---|
| KYC/Identity verification | Aadhaar/PAN/DL verification + liveness | IDfy, HyperVerge, Signzy, Karza |
| Payments | Protected payment flow (Phase 2) | Razorpay Route, Cashfree |
| SMS/OTP | Phone verification, notifications | MSG91, Twilio, Razorpay's own SMS partners |
| Maps | Safe meetup location & live sharing | Google Maps Platform |
| Push notifications | Real-time alerts | Firebase Cloud Messaging |
| NLP/scam detection | Chat message classification | Custom model (fine-tuned classifier) initially; can start with a rules/regex + keyword engine before ML |

### 4.4 Communications Interfaces
- HTTPS/TLS 1.2+ for all client-server communication.
- WebSocket (or Firebase Realtime DB/Firestore) for live chat.

---

## 5. Non-Functional Requirements

### 5.1 Performance
- Chat messages shall be delivered within 1 second under normal network conditions.
- Scam-pattern detection shall run inline with < 300ms added latency per message.

### 5.2 Security
- All PII shall be encrypted at rest (AES-256) and in transit (TLS).
- ID verification tokens only; no raw Aadhaar numbers stored on TrustTrade servers.
- Role-based access control for admin panel.
- Rate-limiting on OTP requests to prevent abuse.

### 5.3 Compliance
- DPDP Act 2023 compliance: explicit consent for data collection, right to erasure, data localization where applicable.
- RBI compliance: no direct fund custody without proper licensing (see Section 2.5); all protected-payment flows routed through a licensed payment aggregator.

### 5.4 Reliability & Availability
- Target uptime: 99.5% for MVP (can be hosted on standard cloud infra without multi-region redundancy initially).

### 5.5 Scalability
- Architecture should support horizontal scaling of chat and API services independently as user base grows (start with a monolith is fine for MVP; design data models to allow future service extraction).

### 5.6 Usability
- Must support Hindi + English at minimum (India's resale users are not all English-first); consider adding 2–3 regional languages in Phase 2.
- Onboarding (registration → verified badge) should take under 3 minutes.

---

## 6. Data Requirements (High-Level Data Model)

**Users**: user_id, phone (hashed/encrypted), name, verification_status, trust_score, created_at
**Listings**: listing_id, seller_id, title, category, price, photos[], external_url (nullable), status
**Conversations**: conversation_id, listing_id, buyer_id, seller_id, created_at
**Messages**: message_id, conversation_id, sender_id, content, flagged (bool), flag_reason, created_at
**Transactions**: transaction_id, listing_id, buyer_id, seller_id, amount, payment_status (none/held/released/refunded/disputed), created_at
**Disputes**: dispute_id, transaction_id, raised_by, reason, status, resolution, resolved_by, created_at
**Reviews**: review_id, transaction_id, reviewer_id, reviewee_id, rating, comment

---

## 7. Phased Roadmap (tied back to regulatory reality)

### Phase 1 — MVP (no payment handling)
- Registration + KYC verification + Verified Badge
- Listing creation/import
- Chat + scam-pattern detection (rules-based to start)
- Safe meetup suggestions
- Ratings/reviews
- Admin moderation panel
- **Goal:** prove people will use verification + scam-warnings even without payment protection. This alone directly addresses the fraud patterns found in research (QR scams, fake army personnel, courier fraud) without touching payment regulation at all.

### Phase 2 — Protected Payments
- Integrate Razorpay Route (or Cashfree equivalent) for hold/release flow — does not require full Escrow+/PA license if structured as a marketplace split-payment rather than direct fund custody. **Requires TrustTrade to be a registered company (Pvt Ltd) at this stage** — needed anyway to open a business current account and sign with a payment partner.
- Dispute resolution flow goes live.

### Phase 3 — Scale
- Apply for RBI Payment Aggregator license or partner-based Escrow+ (once transaction volume justifies it — this is a sales-led, documentation-heavy process, not self-serve).
- Browser extension overlay for OLX/FB Marketplace.
- Partnered physical "TrustTrade Points" for meetups.
- Regional language expansion.

---

## 8. Open Questions / Decisions Needed
1. Native app (Flutter) vs. PWA for v1 — recommend PWA first to move faster and cheaper, native later once traction is proven.
2. Which KYC vendor to pilot with (cost per verification vs. accuracy) — needs a quick comparison call with 2–3 vendors.
3. Legal structure and timeline for incorporating as a Pvt Ltd (needed before Phase 2 regardless of payment partner chosen).
4. City to pilot in first (recommend one city, not national, to make safe-meetup curation and support manageable).

---

*End of Document*
