# Constraints and Indexes

Read directly from the `CREATE TABLE` statements in `legacy-schema.txt`.

## Primary keys

| Table | Primary key | Identity |
|-------|-------------|----------|
| `data` | `id` | `int AUTO_INCREMENT`, next value 1178 |
| `exerciseList` | `id` | `int AUTO_INCREMENT`, next value 250 |
| `users` | `id` | `int AUTO_INCREMENT`, next value 29 |
| `workoutPlans` | `id` | `int AUTO_INCREMENT`, next value 248 |

All primary keys are synthetic single-column surrogates. No natural or
composite primary keys.

## Unique constraints

**None.** In particular:

- `users.username` is **not unique** — duplicate and case-variant usernames can
  and do coexist (`Alyssa` / `alyssa`).
- No uniqueness on `workoutPlans` for a `(user, workoutPlan, workoutDay, exercise)`
  or `(workoutDay_id, order)` tuple, so a plan can contain the same exercise
  twice on a day with no guard.

## Check constraints

**None.** Nothing constrains, for example, `order` / `sets` / `workoutDayOrder`
to be non-negative, `repsSetN` / `weightSetN` to be numeric, or
`submissionTime` to be non-null.

## Indexes

**Only the primary-key (clustered) index on `id` for each table.** There are no
secondary indexes.

Every access path the application actually uses is therefore a **full table
scan**:

- `WHERE user = ?` on `data`, `exerciseList`, `workoutPlans`
- `WHERE username = ?` on `users` (the login lookup)
- `WHERE user = ? AND workoutPlan = ?` on `workoutPlans`
- ordering by `submissionTime`

At current volumes (~1k rows in the largest table) this is not a runtime
problem, but it is a schema-quality problem the redesign should fix by default:
index every foreign key and every documented lookup column.

## Defaults

- Every non-key column is declared `DEFAULT NULL`.
- No column has a non-null default, no `ON UPDATE CURRENT_TIMESTAMP`, no
  generated columns.
- `submissionTime` is **not** auto-populated by the database — the application
  must supply it.

## Engine / charset

All four tables: `ENGINE=InnoDB`, `DEFAULT CHARSET=utf8mb4`,
`COLLATE=utf8mb4_0900_ai_ci` (case-insensitive, accent-insensitive — relevant
to every string comparison, see `relationships.md`).
