# Legacy Database Reference

These documents describe the existing **workout tracker** MySQL database so a
replacement schema can be designed from scratch. They are reference material
only — no migration code, no schema changes.

## Source and method

The analysis is based entirely on the export in `docs/legacy-db-export/`:

- `legacy-schema.txt` — `mysqldump --no-data` of all four tables.
- `legacy-sample.txt` — `mysqldump` of the same tables with `WHERE 1 LIMIT 5`,
  i.e. **5 rows per table**.

There was **no live database access**, so:

- Row counts are **inferred** from `AUTO_INCREMENT` values, not `COUNT(*)`.
- Statements about "always null" / "never null" / "always the same value" are
  **inferred from the 5-row sample** and must be re-checked against the full
  data before relying on them.
- Anything read directly from the `CREATE TABLE` text (types, nullability,
  defaults, keys) is stated as fact.

The dump header names an Amazon RDS host (`workouttrackerdb...us-east-1.rds.amazonaws.com`),
server version `8.0.45` (MySQL 8, despite the MariaDB dump client), database
`dbname`, charset `utf8mb4` / collation `utf8mb4_0900_ai_ci` (accent- and
case-insensitive comparisons).

## What this database is for

It backs a personal **weight-training workout tracker**. A user picks a named
**workout plan** made of ordered **workout days** (e.g. "Chest", "Back"), each
day being an ordered list of **exercises** with a target set count
(`workoutPlans`). When the user trains, the app records what was actually
performed — reps and weight for up to six sets per exercise — as rows in
`data`, stamped with a shared `submissionTime` per session. `users` holds the
login (username + **plaintext** password), the currently selected plan name,
and a `nextWorkout` pointer into the plan's day sequence. `exerciseList` is a
per-user notebook of exercise setup details and cues (rack pin heights, form
reminders).

The schema is broadly two parallel wide tables — `workoutPlans` (the template)
and `data` (the log) — that repeat the same user / plan / day / exercise names
as strings on every row, with no foreign keys, no secondary indexes, no views,
and no stored programs.

## Files

| File | Contents |
|------|----------|
| `tables.md` | Every table: columns, types, nullability, defaults, identity columns, approximate row counts. |
| `relationships.md` | The (zero) enforced foreign keys, plus the relationships implied by the data — called out explicitly. |
| `constraints-and-indexes.md` | Primary keys, unique constraints, check constraints, indexes. |
| `views.md` | Views (there are none). |
| `programmability.md` | Stored procedures, functions, triggers, events (there are none) — and the business logic that therefore lives in the app. |
| `sample-data.md` | 5 synthesized rows per table, with value patterns described. Real personal data is not reproduced. |
| `observations.md` | Nullability mismatches, unused columns, denormalization, string-typed data that should be typed, abandoned tables, and a redesign recommendation. |
