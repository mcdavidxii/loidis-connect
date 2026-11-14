# Compliance checklist

Start the first group now so everything is signed off by MVP go-live. Costs are rough
estimates; get quotes. This is general guidance, not legal advice.

Because the development team builds and runs the software for Loidis, the roles split:

- **Development team (software maker / data processor):** clinical safety as manufacturer
  (DCB0129), security, hosting, backups, penetration testing, Cyber Essentials.
- **Loidis (care provider / data controller):** DPIA, clinical safety as deployer
  (DCB0160), DSPT, CQC record-keeping, privacy notices, staff training.
- A **data processing agreement** between the development team and Loidis is required.

| # | Item | Owner | Where | Est. cost | Start | Status |
|---|---|---|---|---|---|---|
| 1 | Check council contracts: required call monitoring provider, UK-only hosting, NHS-assured system requirement | Loidis | Contracts | £0 | Now | Not started |
| 2 | Check CareLineLive contract: notice period, full data export, API | Loidis | Account manager | £0 | Now | Not started |
| 3 | Contract and data processing agreement between the development team and Loidis | Both | Solicitor | £1k–£3k | Now | Not started |
| 4 | Clinical Safety Officer (registered clinician) trained or hired | Both | NHS clinical safety training; IPEM course | £35 e-learning, ~£475 course, or £5k–£15k consultant | Now | Not started |
| 5 | Clinical risk management plan and hazard log, kept during build | Dev team | DCB0129 / DCB0160 | In CSO cost | Design | Not started |
| 6 | DPIA, including GPS tracking of carers and any AI features | Loidis | ICO guidance and template | £0–£3k | Design | Not started |
| 7 | Hosting decision (UK vs EEA) after item 1; processing agreements with host and other providers | Dev team | Provider terms | £1.2k–£6k/year | Design | Not started |
| 8 | Cyber Essentials, then Cyber Essentials Plus | Dev team | IASME certification body | From £320 + VAT; CE+ ~£1.6k–£3.3k | Now / after build | Not started |
| 9 | Retention schedule for care, medication and staff records | Loidis | NHS Records Management Code of Practice | £0 | Design | Not started |
| 10 | Backup and restore plan, monthly restore tests | Dev team | Internal | In hosting | Build | Not started |
| 11 | Travel time and minimum wage rules for payroll | Both | GOV.UK minimum wage guidance | £0 | Before payroll | Not started |
| 12 | Penetration test by an accredited tester | Dev team | CREST members | £3k–£8k | 6–8 weeks before go-live | Not started |
| 13 | Clinical safety case report signed by the CSO | Both | Internal | In CSO cost | Before go-live | Not started |
| 14 | Update DSPT for the new system | Loidis | dsptoolkit.nhs.uk; Digital Care Hub | Free | Before go-live | Not started |
| 15 | Update privacy notices for clients, families and staff | Loidis | Internal | £0–£1k | Before go-live | Not started |
| 16 | Downtime plan with paper fallback | Loidis | Internal | £0 | Before go-live | Not started |
| 17 | Cyber and professional indemnity insurance covering the software | Both | Broker | £1k–£3k/year | Before go-live | Not started |
| 18 | Staff training on the new system and data security | Loidis | Internal | Staff time | Before go-live | Not started |

## Security baseline (build requirements)

- HTTPS everywhere; encryption at rest, including offline data on carers' phones.
- Two-factor login for office staff; session timeouts; remote logout of lost phones.
- Role-based access: carers see only clients they are booked with, around visit time.
- Append-only audit log of every view, create, change and delete of personal data.
- Automated encrypted backups stored separately, with monthly restore tests.
