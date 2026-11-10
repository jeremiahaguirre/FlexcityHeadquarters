# Payroll rules: how they're checked

Payroll touches tax and employment-standards law, so rates and rules are **data that FH verifies**,
not code anyone assumes is right.

## Tax and contributions (yearly)

| What | Source to compare with | Where | Gate |
| --- | --- | --- | --- |
| Federal tax, CPP/CPP2, EI | CRA T4127 *Payroll Deductions Formulas* (January and July editions) | Dev console, Payroll tax tables, `CA` | A pay run can't be approved until the year's table is marked verified by FH, with the source recorded |
| Provincial and territorial tax (all 13) | T4127 provincial sections | Each province's table | Same |
| Quebec: QPP/QPP2, QPIP, Quebec tax, employer contributions | Revenu Québec TP-1015.F, TPZ-1015.R, QPIP rate notice | `QC` table | Same |

Method follows T4127 option 1 (annualize, compute, divide by pay periods). Unit tests check the
method on round numbers (`apps/api/test/unit/tax.test.ts`); integration tests check each pay run
end to end, including Quebec (`quebec.test.ts`) and benefits (`benefits.test.ts`).

## Employment standards

Overtime, rest periods, statutory holidays and young-worker rules are per province
(`apps/api/src/services/compliance/provincialRules.ts`), each marked `verified: false` until
employment counsel reviews it against [COMPLIANCE.md](COMPLIANCE.md). Collective-agreement
overrides apply on top. Until then every pay run shows a warning.

## Benefits and deductions

Pension (RPP) and union dues reduce taxable income; employer-paid taxable benefits are taxed and
pensionable but not insurable; amounts go on T4 boxes 20, 40 and 44 (RL-1 D, F, L). Tested in
`benefits.test.ts`.

## Controls around paying people

Two-person approval and a passkey to release pay (on by default); a bank account change is
verified by someone other than whoever entered it, and never by the account holder; edited
approved punches go back for approval; pay files are audited and SINs are only unsealed into
filing files, with a passkey.

## Before the first live pay run

1. FH verifies the year's federal and provincial tables against T4127 (record the edition).
2. Employment counsel reviews the province's rules; flip `verified`.
3. Run a parallel payroll (the old system and FH side by side) for at least two pay periods and
   reconcile every statement to the cent.
