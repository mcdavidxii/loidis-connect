# CLAUDE.md — Loidis Connect

Care management platform for Loidis Care Services Ltd (CQC-regulated home care,
Dorset). Current phase and plan: `README.md` and `docs/`.

## Rules that must never be broken

1. **No real personal data in git.** Real exports live in `data/private/` (git-ignored).
   Test data must be made up.
2. **Never invent regulatory, clinical or compliance claims.** If unsure, flag it.
3. **AI and the rota engine only suggest.** A person approves before anything is
   published, and no automated path may change care plans or medication records.

## How to work here

- Plan, then document, then build. Record meaningful choices in `docs/DECISIONS.md`
  with the trade-off.
- Keep `docs/` in sync with what is built.
- Security baseline in `docs/COMPLIANCE.md` applies to all code: role-based access,
  audit logging of personal-data access, encryption, no secrets in the repo.
