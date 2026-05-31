# 🇧🇪 Belgian Skills — Implementation Plan

## Feasibility Matrix

| # | Skill | Tier | API Required | Effort | Impact |
|---|---|---|---|---|---|
| 1 | KBO/CBE Company Lookup | 2 | Belgian Open Data (public) | 2 days | 🔴 High |
| 2 | VIES VAT Validation | 2 | VIES SOAP → REST proxy | 1 day | 🔴 High |
| 3 | Peppol E-Invoicing | 3 | Peppol Access Point | 1 week | 🟡 Medium |
| 4 | Tax Calendar & Deadlines | 1 | None (rule-based) | 0.5 day | 🔴 High |
| 5 | Real Estate Registration Tax | 1 | None (formula-based) | 0.5 day | 🟡 Medium |
| 6 | Itsme / E-Gov Navigator | 1 | None (guide-based) | 1 day | 🔴 High |
| 7 | Language Bridge (FR↔NL↔EN) | 1 | Gemini (already have) | 0.5 day | 🔴 High |
| 8 | Social Security Navigator | 1 | None (guide-based) | 1 day | 🟡 Medium |
| 9 | Labor Law Simplifier | 1 | None (lookup table) | 0.5 day | 🔴 High |
| 10 | Cross-Regional Mobility | 2 | iRail / Delijn / STIB | 2 days | 🟡 Medium |

## Tier Breakdown

### Tier 1 — Zero External API (Implement First)

These need zero external services. Pure logic, calculation, or the Gemini model's existing knowledge.

| Skill | What Beatrice does | Implementation |
|---|---|---|
| **Tax Calendar & Deadlines** | Reminds user of upcoming VAT, income tax, social security deadlines based on date + region | Rule-based date engine. No API needed. |
| **Real Estate Tax Calculator** | Calculates registration rights (3% Flanders, 12.5% Wallonia/Brussels) with first-time buyer discounts | Pure math function |
| **Labor Law Simplifier** | Explains notice periods, 13th month, indexation, CCT clauses in plain language | Knowledge-based — Gemini already has this. Tool just needs to prompt correctly. |
| **Language Bridge** | Translates commune/legal letters between FR↔NL↔EN with admin context | Uses Gemini's existing translation + cultural context. A tool with instruction to "maintain legal accuracy and explain cultural context." |
| **Itsme / E-Gov Navigator** | Tells user which portal to visit and what docs to bring | Rule-based guide. No API. |
| **Social Security Navigator** | Guides user through mutualiteit/ziekenfonds forms and reimbursements | Rule-based guide. No API. |

### Tier 2 — Public API Integration (Phase 2)

These need server-side API routes but use free/public endpoints.

| Skill | API Endpoint | Server Route |
|---|---|---|
| **KBO/CBE Company Lookup** | `https://api.entreprise1.be/v1/enterprise/{number}` or `https://opendata.mysocialsecurity.be/api/explore/v2.1/catalog/datasets/onderneming/records` | `POST /api/be/company` |
| **VIES VAT Validation** | `http://ec.europa.eu/taxation_customs/vies/services/checkVatService` (SOAP) or REST proxy at `https://jsonvat.com` | `POST /api/be/vat-check` |
| **Cross-Regional Transport** | iRail API: `https://irail.be/connections/{from}/{to}` | `POST /api/be/transport` |

### Tier 3 — Specialized Infrastructure (Phase 3)

| Skill | Requirements |
|---|---|
| **Peppol E-Invoicing** | Needs a Peppol Access Point or SMP/SML subscription. Not buildable as a simple API route. |

## Implementation Plan — Phase 1 (All Tier 1, 2 days)

1. **Add server routes** in `server/index.ts` for:
   - `POST /api/be/vat-check` — VIES VAT validation
   - `POST /api/be/company-lookup` — KBO/CBE lookup
   - `POST /api/be/transport` — iRail transport query

2. **Add tool declarations** in `BeatriceAgent.tsx`:
   - `be_vat_check` — Check Belgian/EU VAT number validity
   - `be_company_lookup` — Look up Belgian company via KBO/CBE
   - `be_transport` — Plan cross-regional transport (train + tram/bus)
   - `be_tax_calculator` — Calculate registration tax for real estate
   - `be_labor_explain` — Explain Belgian labor law clauses
   - `be_admin_guide` — Guide user through Belgian administrative processes
   - `be_language_bridge` — Translate/admin-clarify between FR↔NL↔EN

3. **Update VOICE_PERSONALITY_PROMPT** with a section:
   ```
   BELGIAN ADMIN SKILLS:
   You have specialized tools for Belgian administrative tasks.
   When the user asks about Belgian companies, VAT, taxes, real estate,
   labor law, or administrative procedures, use these tools.
   Always confirm the region (Flanders/Wallonia/Brussels) when applicable.
   ```

4. **Update Workspace** — generated documents (tax calculations, labors explanations)
   are auto-saved to workspace.

Want me to start building Phase 1?
