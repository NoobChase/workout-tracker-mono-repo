# Views

**There are no views in this database.**

`legacy-schema.txt` was produced by `mysqldump` of the full database and
contains four `CREATE TABLE` statements and nothing else — no `CREATE VIEW`, no
`CREATE ALGORITHM=... VIEW`. The dump's "Dumping events" and "Dumping routines"
sections are both empty.

If the export was somehow filtered to tables only, this should be re-confirmed
against the live server with:

```sql
SELECT table_name, view_definition
FROM information_schema.views
WHERE table_schema = DATABASE();
```

but there is no indication in the export that any views exist.
