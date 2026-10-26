# Spec Delta

## Purpose

Lets a lifter train with no signal: the app opens, a workout starts, and every
set, edit, delete and finish is kept on the device and delivered to the server
in the order it happened once a connection returns, exactly once.

## ADDED Requirements

### Requirement: The app opens without a connection
After one online visit, the installed app SHALL load its shell and the signed-in user's in-progress or most recently prefetched workout with no network connection.

#### Scenario: Airplane mode cold start
- **WHEN** a user who visited online earlier opens the app with airplane mode on
- **THEN** the app renders, and an in-progress workout can be resumed

### Requirement: Next workouts are cached ahead of training
Whenever what's next loads online, the device SHALL store what training each listed workout needs:
- its planned exercises and planned sets;
- the exercises' names and metrics;
- the user's unit settings;
- the previous-session numbers for those exercises.

A cached workout SHALL then be startable and trainable to the end with no network access.

#### Scenario: Signal drops after starting
- **WHEN** a user starts a workout online and then loses signal
- **THEN** every exercise, target and previous-session number stays visible and every set can be logged

#### Scenario: Starting in a basement
- **WHEN** a user opened the app online earlier, then starts that workout with no signal
- **THEN** the workout starts and is fully trainable, and the start is queued

### Requirement: Session writes apply locally first
Starting, logging, editing, deleting and finishing SHALL update the screen immediately, whether or not the device is online, and SHALL persist across reloads and app restarts until the server has acknowledged them.

#### Scenario: Logging offline
- **WHEN** a user logs a set with no signal
- **THEN** the set appears in the log at once, marked queued with no signal

#### Scenario: Restart before sync
- **WHEN** the app is closed with three queued sets and reopened offline
- **THEN** all three sets are still shown and still queued

### Requirement: Queued writes reach the server in order, one at a time
Queued writes for a session SHALL be sent serially in the order they were made. A write SHALL NOT be sent until every earlier write for that session has been acknowledged. A delete-and-renumber SHALL travel as one request.

#### Scenario: Reconnecting with a backlog
- **WHEN** a start, three set logs and a delete of set 2 are queued, then signal returns
- **THEN** the server receives them in exactly that order and ends with sets 1 and 2 renumbered from the original 1 and 3

#### Scenario: A later set never overtakes an earlier one
- **WHEN** set 3 is queued and the user logs set 4 just as signal returns
- **THEN** set 4 is not sent until set 3 is acknowledged

### Requirement: Every queued write is safe to replay
Every row a queued write creates SHALL carry an id minted on the device, and the server SHALL treat a repeated write as already applied. Retrying any write SHALL never create a duplicate.

#### Scenario: Response lost after commit
- **WHEN** the server commits a set but the response never arrives, and the client retries
- **THEN** exactly one set row exists

### Requirement: Failed deliveries retry, and the lifter can see it
Network failures and server errors SHALL be retried with backoff, indefinitely, without user action. The screen SHALL always show one sync state:
- all synced;
- syncing N;
- N queued with no signal;
- failed, retrying.

#### Scenario: Server error then recovery
- **WHEN** the API returns 503 for a queued set, then recovers
- **THEN** the set shows failed, retrying until it is accepted, then shows logged, without the user doing anything

### Requirement: A write the server permanently rejects stops the queue visibly
When the server rejects a queued write as invalid, forbidden or not entitled, the queue for that session SHALL stop at that write. The write SHALL be kept and shown as rejected, with the reason. Later writes SHALL NOT be sent past it.

#### Scenario: Rejected write
- **WHEN** the server answers a queued set with a validation error
- **THEN** that set is marked rejected with the reason, and later queued writes stay queued

### Requirement: Units are resolved on the device and checked on the server
Each logged weight SHALL carry the unit resolved on the device: the per-exercise override if one exists, otherwise the user's default. A write arriving without a unit SHALL get the same resolution on the server.

#### Scenario: Offline log with an override
- **WHEN** a user whose default is LB but whose Front Squat override is KG logs Front Squat offline
- **THEN** the stored set's unit is KG

### Requirement: Session history appears once synced
A session completed offline SHALL appear in history after its queued writes have been delivered, with every set as logged.

#### Scenario: The step 3 goal
- **WHEN** a user starts a workout, logs a set in airplane mode, finishes, and then turns airplane mode off
- **THEN** history shows that session with that set once the queue drains
