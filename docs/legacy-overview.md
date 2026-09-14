# Legacy Backend Overview — `workout_tracker_backend`

Reference document for rebuilding the workout-tracker backend from scratch.
Analysis target: `/home/wannabe_programmer/dev/workout_tracker_backend` (git
branch `master`, latest commit `45a4a62` "New server update", 2025-06-26).

**Scope:** this document covers the **backend API service** only. Every source
file in that repository was read. It is a single small Node/Express service.
A companion analysis of the production MySQL database it talks to already exists
at `docs/legacy-db/` and `docs/legacy-db-export/`; this document cross-references
it but does not repeat it.

Nothing in the target repository was modified.

---

## 0. SECRETS FOUND — ROTATE THESE

Credentials are committed in plaintext, in source files, and are present
throughout git history. All of the following must be rotated before or
independently of any rewrite.

| Secret | Location | Value in repo | Notes |
|--------|----------|---------------|-------|
| Production MySQL password (current) | `util/db.js:4` | `[REDACTED]` (10–12 char string, contains punctuation) | Live credential for RDS user `workouttrackerdb`. Committed on branch `master`. |
| Production MySQL password (previous) | git history — commit `45a4a62` diff of `util/db.js` | `[REDACTED]` | Superseded but still recoverable from history; rotate if it was ever reused. |
| Production MySQL password (original) | git history — commit `50efb0d` `index.js` | `[REDACTED]` | Oldest of three; same account. |
| MySQL username | `util/db.js:4` | `workouttrackerdb` | Not secret by itself, but names the account to rotate. |
| MySQL database name | `util/db.js:4` | `dbname` | Literal string `'dbname'` — this is the actual schema name (confirmed by `docs/legacy-db-export/legacy-schema.txt`). |
| RDS host (current) | `util/config.js:4` | `workouttrackerdb.c6muniumz33n.us-east-1.rds.amazonaws.com` | AWS RDS, `us-east-1`. Publicly resolvable endpoint. |
| RDS host (previous) | `util/config.js:5` (comment) and git history | `rds-mysql-workouttracker.c6muniumz33n.us-east-1.rds.amazonaws.com` | Left in a code comment. |

Additional exposure: the database contains **plaintext user passwords**
(`users.password`), and `GET /api/users` returns them to any caller. See §8.

There are no API keys, OAuth secrets, JWT signing keys, or third-party tokens in
the codebase — because there is no authentication layer at all (see §6).

---

## 1. Tech stack

| Layer | Technology | Version (from `package.json` / `node_modules`) | Status |
|-------|-----------|-----------------------------------------------|--------|
| Language | JavaScript (CommonJS modules, `require`) | ES2017-ish, no transpiler | — |
| Runtime | Node.js | **unknown** — no `engines` field, no `.nvmrc`, no CI config, no Dockerfile. `package-lock.json` is `lockfileVersion: 2` (npm 7–8 era, ~Node 15–18). | Cannot confirm the deployed version. |
| Web framework | Express | `4.17.3` (released Feb 2022) | Old. Express 4 is in maintenance; 4.17.3 has known advisories in its dependency tree that later 4.18/4.19/4.21 patched. Express 5 is current. |
| ORM | Sequelize | `6.17.0` (Feb 2022) | Sequelize 6 is still supported but 6.17 is ~30 minor versions behind (6.37+). Sequelize 7 is current-generation. |
| DB driver | `mysql2` | `2.3.3` (Feb 2022) | Old. `mysql2` 2.3.3 predates several security fixes (e.g. prototype-pollution / RCE advisories fixed in 3.9.x). Should be on 3.x. |
| CORS | `cors` | `2.8.5` | Last release 2018; unmaintained but stable and tiny. |
| Body parsing | `body-parser` | `1.19.2` **declared but never imported** | Dead dependency. `index.js` uses the built-in `express.json()` / `express.urlencoded()` instead. |
| Serverless adapter | `serverless-http` | `2.7.0` **declared but never imported** | Dead dependency. No Lambda handler is exported anywhere. Signals an abandoned "deploy to AWS Lambda" intent. |
| Dev tooling | `nodemon` | `2.0.15` | Dev-only, fine. |
| Config loader | `dotenv` | **not a dependency** | Referenced only in commented-out lines (`index.js:1`, `util/config.js:1`). Abandoned intent to externalize config. |

**Build tooling:** none. No bundler, no compiler, no lint config, no formatter
config, no test runner. `package.json` scripts are `start` (`node index.js`),
`dev` (`nodemon index.js`), and `test` (`echo "Error: no test specified" && exit 1`).

**Committed `node_modules`:** the entire `node_modules/` directory is checked
into git (`git ls-files` lists thousands of vendored files; there is no
`.gitignore`). The installed tree matches `package.json`.

**End-of-life / unmaintained summary:**
- `cors@2.8.5` — unmaintained (no releases since 2018), low risk.
- `body-parser`, `serverless-http`, `dotenv` — dead weight; drop them.
- `express@4.17.3`, `sequelize@6.17.0`, `mysql2@2.3.3` — all frozen at
  Feb-2022 versions, none ever `npm audit`ed. `mysql2` in particular is the
  one to worry about.

---

## 2. Structure and conventions

### Layout

```
index.js                 # entry point: app setup, route mounting, boot
util/
  config.js              # PORT + hardcoded DB host
  db.js                  # Sequelize instance + connectToDatabase()
models/
  index.js               # imports the 4 models, calls .sync() on each
  user.js                # Sequelize model -> table `users`
  exercise.js            # Sequelize model -> table `exerciseList`
  workoutPlan.js         # Sequelize model -> table `workoutPlans`
  dataPoint.js           # Sequelize model -> table `data`
controllers/
  users.js               # Express Router for /api/users
  exercises.js           # Express Router for /api/exercises
  workoutPlans.js        # Express Router for /api/workoutPlans
  data.js                # Express Router for /api/data
package.json
package-lock.json
node_modules/            # committed
```

There is no `README`, no `docs/`, no `.env.example`, no migrations directory, no
tests.

### Pattern

It is a **thin two-layer "router + model" arrangement** — a partial, informal
MVC where the "controller" is an Express `Router` and the "model" is a Sequelize
class. There is:

- **no service / business-logic layer** — routers call model methods directly;
- **no validation layer** — request bodies are passed straight to Sequelize;
- **no middleware layer** beyond `cors()` and the two body parsers;
- **no error-handling middleware** — each handler does its own (inconsistent)
  try/catch or none at all;
- **no repository / DAO abstraction** — Sequelize is the data layer.

The four controllers are **near-identical copy-paste**. Each exposes exactly
`GET /`, `POST /`, `GET /:id`, `DELETE /:id`, `PUT /:id` against one model. The
only meaningful per-file difference is which columns the `PUT` handler writes
(see §3). The local variable holding a fetched row is called `x` in every
handler.

### Naming conventions (inconsistent)

- Model classes are lower-case (`class user`, `class exercise`, `class
  workoutPlan`) except `dataPoint.js` which declares `class DataPoint` but
  exports it and registers it as `modelName: 'DataPoint'` while
  `models/index.js` re-exports it under the key `dataPoint`.
- Table mapping is done three different ways: `modelName` + Sequelize
  auto-pluralization (`user`→`users`, `workoutPlan`→`workoutPlans`), explicit
  `tableName: 'exerciseList'`, and explicit `tableName: 'data'`.
- `order` is used as a column name in two models — a SQL reserved word (Sequelize
  quotes it, so it works, but it is a smell).

### Model ↔ database mismatches

The Sequelize models do **not** faithfully describe the real table schema
(`docs/legacy-db-export/legacy-schema.txt`):

| Model declares | Real column is | Effect |
|----------------|----------------|--------|
| `DataTypes.TEXT` for almost every string field | `varchar(45)` in MySQL | Models over-state capacity. Because `.sync()` is plain (not `{alter:true}`), existing columns are untouched; MySQL still enforces the 45-char limit and will truncate/error on long input regardless of the model. |
| `dataPoint.submissionTime` has `defaultValue: DataTypes.NOW` | `datetime DEFAULT NULL`, DB does not auto-populate | If a client omits `submissionTime`, Sequelize supplies "now" on `create`; a direct SQL insert would leave it NULL. |
| `dataPoint` has no `important` field | no `important` column exists | `PUT /api/data/:id` writes `x.important` — a no-op (see §8). |

`models/index.js` calls `workoutPlan.sync()`, `user.sync()`, `exercise.sync()`,
`dataPoint.sync()` at import time, **not awaited**. Against the existing DB these
are effectively no-ops (`CREATE TABLE IF NOT EXISTS`). Against an empty DB they
would create `TEXT` columns instead of `varchar(45)` — schema drift.

---

## 3. Functionality (user-facing capabilities)

The service is a **generic REST CRUD API over four MySQL tables**. Base path for
everything is `/api`. All request and response bodies are JSON. **No endpoint
requires authentication or performs any authorization.**

There is essentially no business logic in the backend. The rules the data model
implies — session grouping by shared `submissionTime`, keeping `sets` in sync
with the populated set columns, advancing `users.nextWorkout`, allocating
`workoutPlan_id` / `workoutDay_id`, treating `''` as "set not performed",
plaintext password checks on login — are **not implemented here**. They must live
in the client application (see `docs/legacy-db/programmability.md`, which assumes
"the app" does this work; that app is not this repo). The backend just reads and
writes rows.

### 3.1 Root

| Method | Path | Behaviour |
|--------|------|-----------|
| `GET` | `/` | Returns the string `Hello World`. Health-check-ish; no DB touch. (`index.js:24`) |

### 3.2 Users — `/api/users` (table `users`)

Fields: `id`, `username`, `password` (plaintext), `workoutPlan` (name of the
user's currently selected plan, `''` if none), `nextWorkout` (integer pointer
into the plan's day sequence).

| Method | Path | Behaviour | Source |
|--------|------|-----------|--------|
| `GET` | `/api/users` | Returns **all** user rows, including plaintext `password`. No pagination, no filtering. | `controllers/users.js:5` |
| `POST` | `/api/users` | Creates a user from the raw request body (`user.create(req.body)`). Any column can be set by the caller, including `id`. On error returns `400` with the raw Sequelize error object. | `controllers/users.js:10` |
| `GET` | `/api/users/:id` | Returns one user by primary key, or `404`. | `controllers/users.js:19` |
| `DELETE` | `/api/users/:id` | Deletes the user by PK if it exists; **always returns `204`** whether or not a row was found. No cascade to `data` / `workoutPlans` / `exerciseList`. | `controllers/users.js:28` |
| `PUT` | `/api/users/:id` | Updates **only** `nextWorkout` and `workoutPlan` from the body; ignores all other fields. `404` if not found. Leaves debug `console.log('hi')` / `console.log(x)`. | `controllers/users.js:36` |

There is **no login / authentication endpoint.** Username/password verification,
if it happens at all, happens in the client by fetching users and comparing.

### 3.3 Exercises — `/api/exercises` (table `exerciseList`)

A per-user exercise "notebook": setup details and form cues.
Fields: `id`, `user` (username string), `exercise` (name), `muscleGroup`
(appears unused — NULL in all DB samples), `settings` (equipment setup text,
e.g. rack pin heights), `notes` (form cues; the real column is `varchar(45)` and
has already truncated real notes mid-sentence).

| Method | Path | Behaviour | Source |
|--------|------|-----------|--------|
| `GET` | `/api/exercises` | All rows. | `controllers/exercises.js:5` |
| `POST` | `/api/exercises` | Create from raw body. `400` + raw error on failure. | `controllers/exercises.js:10` |
| `GET` | `/api/exercises/:id` | One row by PK or `404`. | `controllers/exercises.js:19` |
| `DELETE` | `/api/exercises/:id` | Delete by PK if present; always `204`. | `controllers/exercises.js:28` |
| `PUT` | `/api/exercises/:id` | Updates **only** `settings` and `notes`. `404` if not found. | `controllers/exercises.js:36` |

### 3.4 Workout plans — `/api/workoutPlans` (table `workoutPlans`)

The plan **template**, stored fully denormalized: **one row per exercise
scheduled on a plan day.**
Fields: `id`, `user`, `workoutPlan` (plan name), `workoutDayOrder` (0-based day
index), `workoutDay` (day name, e.g. "Chest"), `exercise` (name), `order`
(0-based position of the exercise in the day), `sets` (target set count),
`workoutPlan_id` (**NOT NULL**, groups all rows of one `(user, plan)` — no
parent table), `workoutDay_id` (**NOT NULL**, groups all rows of one
`(user, plan, day)` — no parent table).

| Method | Path | Behaviour | Source |
|--------|------|-----------|--------|
| `GET` | `/api/workoutPlans` | All rows across all users and all plans. | `controllers/workoutPlans.js:5` |
| `POST` | `/api/workoutPlans` | Create from raw body. **Will fail** unless the caller supplies `workoutPlan_id` and `workoutDay_id` (both NOT NULL, no DB default, nothing in the backend generates them). `400` + raw error on failure. | `controllers/workoutPlans.js:10` |
| `GET` | `/api/workoutPlans/:id` | One row by PK or `404`. | `controllers/workoutPlans.js:19` |
| `DELETE` | `/api/workoutPlans/:id` | Delete one row by PK; always `204`. Deleting a whole plan means deleting many rows one call at a time. | `controllers/workoutPlans.js:28` |
| `PUT` | `/api/workoutPlans/:id` | Updates **only** `exercise` and `sets`. `404` if not found. | `controllers/workoutPlans.js:36` |

### 3.5 Workout log — `/api/data` (table `data`)

The **log** of what was actually performed. One row per exercise performed in a
session; rows from the same session are expected to share `submissionTime` (the
client must set this — the backend does not group).
Fields: `id`, `submissionTime`, `user`, `workoutPlan`, `workoutDayOrder`,
`workoutDay`, `exercise`, `order`, `sets`, `repsSet1`..`repsSet6` (digit
strings; `''` for an unused set), `weightSet1`..`weightSet6` (numeric strings;
unit not recorded).

| Method | Path | Behaviour | Source |
|--------|------|-----------|--------|
| `GET` | `/api/data` | **All** log rows for **all** users. No date filter, no user filter, no pagination. | `controllers/data.js:5` |
| `POST` | `/api/data` | Create a log row from raw body. Logs the entire body to stdout (`console.log('this is the sent data ', req.body)`). `400` + raw error on failure. | `controllers/data.js:11` |
| `GET` | `/api/data/:id` | One row by PK or `404`. | `controllers/data.js:21` |
| `DELETE` | `/api/data/:id` | Delete by PK if present; always `204`. | `controllers/data.js:30` |
| `PUT` | `/api/data/:id` | **Intended** to set an `important` flag on a log entry (`x.important = req.body.important`). **Actually a no-op** — `important` is not a column or a model attribute, Sequelize drops the assignment, `save()` writes nothing. Still returns `200` with the unchanged row. | `controllers/data.js:38` |

### 3.6 Capabilities NOT present (but implied by the domain)

Rebuild candidates that the current backend does **not** provide:

- User registration with a hashed password; login; logout; sessions/tokens.
- "Get the current user's plan / log / exercises" — everything is global list
  endpoints; per-user scoping is done client-side by filtering the full list.
- Creating a plan as a unit (it is N separate `POST`s, and the client must
  invent `workoutPlan_id` / `workoutDay_id`).
- Recording a workout session as a unit (N separate `POST`s to `/api/data` with
  a client-chosen shared `submissionTime`).
- Advancing `nextWorkout` after a session.
- Any reporting / aggregation (e.g. "best bench set this month").
- Filtering, sorting, pagination on any collection.

---

## 4. Data flow

### Request lifecycle

```
Client (browser / mobile app — not in this repo)
  |
  |  HTTP/1.1, JSON, CORS: any origin
  v
Express app (index.js)
  app.use(cors())                     # all origins, all methods
  app.use(express.json())             # parse application/json
  app.use(express.urlencoded({extended:true}))
  |
  |  path-prefix routing
  v
One of four Routers (controllers/*.js)
  match METHOD + /:id?
  |
  v
Handler body (no validation, no auth check)
  await Model.findAll()  /  .findByPk(id)  /  .create(req.body)  /  x.save()  /  x.destroy()
  |
  v
Sequelize 6.17  ->  mysql2 driver  ->  TCP :3306
  |
  v
AWS RDS MySQL 8.0.45  (database `dbname`, us-east-1)
  |
  v  rows
back up the stack, res.json(rows)  (Sequelize model instances serialized directly)
```

### Boot sequence (`index.js`)

1. `require` the four controller modules. This transitively runs
   `models/index.js`, which `require`s each model, which `require`s `util/db.js`
   and constructs the single `Sequelize` instance, then fires
   `Model.sync()` × 4 (**not awaited** — runs before step 3).
2. Routers mounted at `/api/workoutPlans`, `/api/users`, `/api/exercises`,
   `/api/data`; `GET /` added.
3. `start()`: `await connectToDatabase()` (calls `sequelize.authenticate()`; on
   failure logs and `process.exit(1)`), then `app.listen(PORT)`.

Note the ordering bug: the un-awaited `.sync()` calls from step 1 race ahead of
the `authenticate()` in step 3, and any rejection there is an unhandled promise
rejection.

### Where state lives

- **All persistent state is in the one RDS MySQL database.** There is no cache,
  no session store, no queue, no file storage, no in-memory state that outlives a
  request.
- The service is **stateless** between requests (it holds only the Sequelize
  connection pool). It could run as multiple instances behind a load balancer
  with no coordination — though nothing indicates it currently does.
- Connection pooling is Sequelize's default (max 5 connections). `util/db.js`
  sets `dialectOptions.connectTimeout: 60000`; a nested
  `options.requestTimeout: 3000` is in the wrong place for the `mysql2` dialect
  and has no effect.

### What talks to what

- Backend → RDS MySQL (the only outbound dependency).
- Client → Backend (HTTP). The client is not in this repo; based on the
  mono-repo name (`workout-tracker-mono-repo`) and the wide-open CORS, it is a
  separate SPA/mobile front end.

---

## 5. External dependencies

| Service / system | What it is | How the code uses it | Where |
|------------------|-----------|----------------------|-------|
| **AWS RDS for MySQL** | Managed MySQL 8.0.45 instance, `us-east-1`, endpoint `workouttrackerdb.c6muniumz33n.us-east-1.rds.amazonaws.com:3306`, database `dbname`, user `workouttrackerdb`. | The sole data store. All four models read/write it via Sequelize + `mysql2`. Connection is **not TLS-secured** — no `ssl` in `dialectOptions` (the original `index.js` had an `ssl: { rejectUnauthorized: false }` block, but it was commented out and never carried forward). | `util/config.js`, `util/db.js` |

That is the complete list. There are **no** other third-party services: no auth
provider (Auth0/Cognito/Firebase), no email/SMS, no object storage (S3), no
analytics, no error tracking (Sentry), no payment processor, no push
notifications, no external HTTP APIs called.

`serverless-http` in `package.json` implies an intent to run behind **AWS API
Gateway + Lambda**, but no handler is exported and `index.js` unconditionally
calls `app.listen()`, so it currently only runs as a long-lived server (bare
EC2, a container, or local). The actual deployment target is **unknown** — there
is no Dockerfile, Procfile, `serverless.yml`, systemd unit, PM2 config, or CI/CD
file in the repo. Commit messages ("pleasse work api", "pleasse work api2/3",
"Previous URL when everything was working") suggest the deployment has been
fragile and may not currently be live.

---

## 6. Auth and authorization

**There is none.** This is the single most important fact for the rewrite.

- **Identification:** none. No login endpoint, no registration endpoint, no
  token issuance. The backend never learns who is calling.
- **Sessions:** none. No cookies, no `express-session`, no JWT, no bearer tokens,
  no CSRF protection. The service is fully stateless because there is no session
  concept at all.
- **Authorization:** none. Every route is reachable by any unauthenticated
  caller. Any client can:
  - `GET /api/users` and read **every username and plaintext password**;
  - create, modify, or delete **any** user, plan, exercise, or log row;
  - read the entire workout history of every user.
- **Password handling:** `users.password` is stored and returned as **plaintext**
  (`DataTypes.TEXT` in the model, `varchar(45)` in the DB). The backend never
  hashes, never compares, never checks a password. `POST /api/users` writes
  whatever `password` string the caller sends. Per `docs/legacy-db/observations.md`,
  several real accounts have a single-space `" "` password.
- **User "ownership" of data** is expressed only as a `user` **name string**
  copied onto every `data` / `workoutPlans` / `exerciseList` row, compared under
  a case-insensitive collation, with no foreign key and no uniqueness on
  `users.username` (`Alyssa` and `alyssa` are distinct rows that a name lookup
  cannot disambiguate). The backend does not filter by it at all — the client
  must fetch everything and filter locally.
- **CORS:** `app.use(cors())` with no options → `Access-Control-Allow-Origin: *`,
  all methods. Combined with the lack of auth, the API is completely open.

Whatever "login" the product has is implemented entirely in the front-end
client (not in this repo) — presumably: `GET /api/users`, find a matching
`username`, compare `password` string in the browser. That is an
**authentication anti-pattern** and must not be carried forward.

---

## 7. Configuration

The app reads almost nothing from the environment. "Configuration" is mostly
hardcoded literals.

| Name | Source | Type | Default | Controls | Notes |
|------|--------|------|---------|----------|-------|
| `PORT` | `process.env.PORT` | env var | `3001` | TCP port `app.listen()` binds. | The **only** value actually read from the environment. (`util/config.js:3`) |
| `DATABASE_URL` | **hardcoded** in `util/config.js:4` | string constant | — | The RDS **hostname** (despite the name, it is not a URL — no scheme, port, or credentials). Consumed by `util/db.js` as `host`. | A previous value is left in a comment on line 5. |
| DB name | **hardcoded** `'dbname'` | `util/db.js:4` arg 1 | — | Sequelize database name. | Matches the real schema name. |
| DB username | **hardcoded** `'workouttrackerdb'` | `util/db.js:4` arg 2 | — | MySQL account. | |
| DB password | **hardcoded** `'[REDACTED]'` | `util/db.js:4` arg 3 | — | MySQL password. | **Secret in source.** See §0. |
| DB port | **hardcoded** `3306` | `util/db.js:6` | — | MySQL port. | |
| DB dialect | **hardcoded** `'mysql'` | `util/db.js:7` | — | Sequelize dialect. | |
| `dialectOptions.connectTimeout` | **hardcoded** `60000` | `util/db.js:9` | — | ms before a connection attempt to MySQL times out. | |
| `dialectOptions.options.requestTimeout` | **hardcoded** `3000` | `util/db.js:11` | — | **Nothing.** This key is for the `tedious`/mssql dialect; `mysql2` ignores it. Dead config. | |

Commented-out `require('dotenv').config()` appears at `index.js:1` and
`util/config.js:1`. `dotenv` is not installed. There is no `.env`, `.env.example`,
or documentation of expected environment. **To run this against a different
database you must edit `util/config.js` and `util/db.js` and redeploy.**

---

## 8. Problems and technical debt

### Security

1. **Committed database credentials** (`util/db.js:4`, `util/config.js`), three
   distinct passwords across git history. §0.
2. **No authentication or authorization on any endpoint** (§6). The API is
   world-readable and world-writable.
3. **Plaintext passwords**, stored and **returned by `GET /api/users`**
   (`controllers/users.js:5`). Anyone can harvest all credentials in one
   request.
4. **Mass assignment.** `create(req.body)` in all four `POST` handlers passes the
   unfiltered request body to Sequelize. A caller can set `id`, or any column not
   meant to be client-writable. No allow-list.
5. **Unencrypted DB connection.** No TLS to RDS (`util/db.js` has no `ssl`
   option). Credentials and data travel in clear over the network path to
   `us-east-1`.
6. **Wide-open CORS** (`app.use(cors())`, `index.js:7`). Any website can drive
   the API from a visitor's browser.
7. **Raw error objects leaked to clients.** `POST` handlers do
   `res.status(400).json({ error })` with the Sequelize error. This exposes SQL,
   column names, and constraint details; also, native `Error` objects often
   serialize to `{}`, so the client frequently gets `{"error":{}}`.
8. **No rate limiting, no request-size cap beyond Express defaults, no `helmet`,
   no logging/audit framework** (only ad-hoc `console.log`).

### Bugs / behaviour that contradicts intent

9. **`PUT /api/data/:id` does nothing.** It assigns `x.important` but there is no
   `important` column or model attribute; `save()` persists nothing and the
   endpoint still returns `200`. Appears intended to let users flag notable log
   entries; that column was never added. (`controllers/data.js:38`)
10. **`DELETE /:id` always returns `204`,** even when the id does not exist, in
    all four controllers. Callers cannot tell a successful delete from a no-op.
11. **`POST /api/workoutPlans` cannot succeed with an intuitive body.**
    `workoutPlan_id` and `workoutDay_id` are `NOT NULL` with no DB default and
    nothing server-side generates them, so the client must compute and send
    grouping ids for tables that don't exist. Undocumented contract.
12. **Un-awaited `Model.sync()` at import** (`models/index.js:6-9`) races the
    `authenticate()` call and can produce unhandled promise rejections; against
    an empty DB it would create `TEXT` columns where the real schema is
    `varchar(45)`.
13. **No try/catch on the `GET` handlers.** A transient DB error in
    `findAll()` / `findByPk()` rejects with no handler → Express leaves the
    request hanging (Express 4 does not catch async rejections) until the socket
    times out; repeated occurrences can crash the process.
14. **Model type inaccuracy.** Every string field is `DataTypes.TEXT` while the
    DB is `varchar(45)`; `dataPoint.submissionTime` has a model-level `NOW`
    default the DB does not have. Behaviour differs depending on whether writes
    go through Sequelize or raw SQL.

### Dead code / cruft

15. **`node_modules/` committed** to git; no `.gitignore`.
16. **Unused dependencies:** `body-parser`, `serverless-http`, and the
    commented-out `dotenv` (not even installed).
17. **Leftover debug logging:** `console.log('hi')` and `console.log(x)` in
    `controllers/users.js:40-41`; `console.log('this is the sent data ', req.body)`
    in `controllers/data.js:12` (logs full request bodies, including plaintext
    passwords if posted); commented-out `console.log` in `controllers/data.js:7`.
18. **Stale value in a comment:** previous RDS host left in `util/config.js:5`.
19. **`requestTimeout` option in the wrong place** for the `mysql2` dialect —
    silently ineffective (`util/db.js:11`).
20. **No `test` script** (exits 1); no tests exist.

### Duplication

21. **Four controllers are ~95% identical.** The CRUD skeleton
    (`GET /`, `POST /`, `GET /:id`, `DELETE /:id`, `PUT /:id`) is copy-pasted;
    only the model name and the two or three columns the `PUT` writes differ.
    A single generic CRUD router factory would replace all four.
22. **Domain concept "workout plan" has three competing representations:**
    `users.workoutPlan` (name string), `workoutPlans.workoutPlan` (name string),
    `workoutPlans.workoutPlan_id` (number, no parent). Same for "workout day".
23. **`data` and `workoutPlans` share seven identical columns** — the plan
    template is re-copied into every log row (see `docs/legacy-db/observations.md`).

### Workarounds / signs of struggle

24. Commit history: `bc168b1` "pleasse work api", `a6a1b7e` "…api2", `4108356`
    "…api3", `37cbe5c` "error print", `e3cc0d7` "added hello" — iterative
    "make it deploy" attempts. Suggests the hosting story was never solid.
25. `util/config.js:5` comment "Previous URL when everything was working"
    implies the **current** DB host may not work; deployment state is unknown.
26. `connectTimeout` bumped to 60 s — a very long connect timeout, usually a
    reaction to flaky connectivity (RDS security-group / VPC reachability, or
    cold Lambda networking).

---

## 9. What not to carry forward

| Discard | Why | Do instead |
|---------|-----|------------|
| **Client-side / plaintext authentication** and the whole "no auth on the API" model | Passwords in clear, credentials returned by a list endpoint, every record mutable by anyone. This is unsafe at the design level. | Real auth: hashed passwords (argon2/bcrypt), a login endpoint issuing a session cookie or JWT, `requireAuth` middleware on every route, and per-user scoping enforced **server-side**. |
| **Hardcoded config and secrets in source** | Cannot rotate, cannot run multiple environments, leaked in history. | 12-factor config: read host/port/name/user/password (or a single `DATABASE_URL`) from the environment; secrets from a secret manager. Keep a `.env.example`. |
| **Generic table-CRUD endpoints** (`GET /api/data` returns every row for every user, etc.) | No per-user scoping, no pagination, forces the client to download everything and filter. Leaks other users' data. | Resource endpoints scoped to the authenticated user, with filtering/pagination: `GET /me/plan`, `GET /me/sessions?from=…`, etc. |
| **The denormalized `workoutPlans` table** (one row per exercise per day, plan/day/exercise as repeated strings, orphan `workoutPlan_id`/`workoutDay_id`) | String-keyed joins under a case-insensitive collation, renames break history, no referential integrity, `NOT NULL` ids pointing at non-existent tables. | Normalize: `workout_plans` → `workout_days` → `plan_exercises`, all with real FKs. The `_id` columns show the original design already knew this. See the target schema in `docs/legacy-db/observations.md`. |
| **`repsSet1..6` / `weightSet1..6` repeating groups** and `''`-means-absent | 1NF violation, hard-caps sets at 6, forces string parsing and the empty-string convention into the app. | A `session_sets` child table: `(entry_id, set_number, reps INT, weight DECIMAL, unit)`; an absent set is simply a missing row. |
| **Reps/weights stored as strings** (`varchar(45)`) | No numeric validation, no aggregation without casting, `'0'` vs `''` ambiguity. | Typed numeric columns. |
| **`users.workoutPlan` + `users.nextWorkout` denormalized pointers** | Duplicate state the app must hand-maintain; `nextWorkout` is a bare int index with no referent. | `users.current_plan_id` FK, and either a computed "next day" or a small `user_plan_progress` row. |
| **Splitting a single logical write (a plan, a workout session) into N HTTP calls** with client-generated grouping ids | Non-atomic, race-prone, leaks ID allocation to the client. | Accept the whole aggregate in one request; wrap the inserts in a DB transaction; generate ids server-side. |
| **`serverless-http` / Lambda ambiguity** | Declared but unused; `index.js` is a plain long-lived server. Pick one. | Decide the deployment model up front (container vs Lambda) and build to it; don't leave both half-wired. |
| **`Model.sync()` for schema management** | No history, no rollback, drifts from the real schema, races startup. | Real migrations (Sequelize CLI, Umzug, Prisma Migrate, Flyway…). |
| **Returning Sequelize model instances / raw error objects directly** | Leaks internal shape and DB details; `{"error":{}}` in practice. | Explicit response DTOs and a central error handler that maps to safe `{ code, message }` payloads. |
| **Committed `node_modules`, no `.gitignore`, no lint/test/CI** | Bloated repo, no quality gate, Feb-2022 dependency versions never audited. | `.gitignore`, lockfile only, `npm audit` in CI, a linter, and at least smoke tests on the endpoints. |
| **Case-insensitive username matching with no uniqueness** | `Alyssa`/`alyssa` are ambiguous owners today. | `UNIQUE` on a normalized (lower-cased or citext) username. |

### Worth keeping (concepts, not code)

- The **domain model** is sound: users → a workout plan → ordered days → ordered
  exercises with a target set count; and sessions → per-exercise entries →
  performed sets. Rebuild it normalized (sketch in
  `docs/legacy-db/observations.md`).
- The **REST surface** (`users`, `exercises`, `workoutPlans`/plans, `data`/log)
  is a reasonable starting inventory of resources — it just needs auth, scoping,
  aggregate endpoints, and pagination.
- The **`exerciseList` idea** (a per-user library of exercises with setup notes
  and form cues) is a nice feature; keep it, widen the text columns, give it a
  real `exercise_id` FK.
- **Existing data values** — timestamps in `data`, the text in
  `exerciseList.settings` / `notes` — are worth a one-off transform into the new
  schema. **Do not** copy `users.password`; force a reset.

---

## 10. Unknowns (could not be determined from the code)

| Question | What is needed to answer it |
|----------|-----------------------------|
| Node.js runtime version in production | The deployment host / container image / CI config. Not in the repo. |
| Where and how the service is actually deployed (EC2? ECS? Lambda? still running at all?) | Infra config or access to the AWS account. The `serverless-http` dep and long `connectTimeout` hint at Lambda; `app.listen()` says plain server. Contradictory. |
| Whether the current RDS host in `util/config.js` is live and working | A connection test, or the owner's confirmation. Comments and commit messages suggest it may be broken. |
| How the client authenticates users | The front-end repo (elsewhere in / alongside the mono-repo). The backend has no login code. |
| Whether `data` / `workoutPlans` string columns hold usernames or user ids | The DB analysis (`docs/legacy-db/`) infers **usernames**; confirm against full data. |
| How `workoutPlan_id` / `workoutDay_id` values are generated | The client code. The backend does not create them and there is no parent table or sequence. |
| Whether `muscleGroup` and set columns 5–6 are used at all | `SELECT COUNT(...)` against the full table (sample suggests mostly empty). |
| The unit of `weightSetN` (lb? kg?) | Not stored anywhere; ask the product owner. |
| Whether any client relies on the (non-functional) `important` field in `PUT /api/data/:id` | The front-end code. |
