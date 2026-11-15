# Rota data

Templates for the one-week anonymised rota sample used by the prototype.

## Rules

1. **Get Loidis's agreement** before exporting any data.
2. **Remove names, phone numbers, emails and health details.** Use IDs instead
   (`C001` for clients, `K001` for carers).
3. Full postcodes are allowed for travel times, with Loidis's agreement.
4. **Real exports go in `data/private/` only.** That folder is git-ignored; never commit
   real data anywhere else.

`sample/problem.json` is an entirely made-up agency used by the engine prototype.

## Templates (`templates/`)

| File | One row per | Notes |
|---|---|---|
| `clients.csv` | Client | `commissioned_hours_week` from the care package; `preferences` and `do_not_send` use `;` between items |
| `carers.csv` | Carer | `travel_mode`: car, foot, bus or bike; `skills` use `;` between items |
| `availability.csv` | Carer availability block | One row per available block per weekday; leave is a block with `type` = leave |
| `visits.csv` | Visit in the sample week | `window_mins` is how far the start can move either way; `carers_needed` is 1 or 2 |

The example rows in each template are made up. Replace them with the real sample.
