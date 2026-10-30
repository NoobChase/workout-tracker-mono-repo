# workout-sessions Specification

## Purpose

Training one workout from a program: knowing what is next, starting it, logging
what actually happened set by set, correcting it, and finishing it so the
program advances.

## Requirements

### Requirement: What's next is one workout per active program
The system SHALL list, for each of the user's ACTIVE programs, the earliest workout (by cycle, then position) that has no COMPLETED or SKIPPED session. A workout whose only session is IN_PROGRESS SHALL still be listed.

#### Scenario: Fresh program
- **WHEN** a user has just started a template
- **THEN** what's next shows that program's first workout of cycle 1

#### Scenario: After finishing a workout
- **WHEN** the user finishes cycle 1's first workout
- **THEN** what's next shows cycle 1's second workout

#### Scenario: Abandoned session stays next
- **WHEN** a workout has an IN_PROGRESS session and nothing resolved
- **THEN** it is still the program's next workout

#### Scenario: Other users' programs are invisible
- **WHEN** another user has active programs
- **THEN** none of them appear in this user's list

### Requirement: Starting a workout writes exactly one session row
Starting a workout SHALL create one IN_PROGRESS session for the user, linked to that workout and carrying a client-minted id. It SHALL create no session exercise or session set rows.

#### Scenario: Start
- **WHEN** a user starts the next workout
- **THEN** one session exists for it with status IN_PROGRESS and no exercises or sets beneath it

#### Scenario: Starting someone else's workout
- **WHEN** a start names a workout the user does not own
- **THEN** the request is refused and nothing is written

### Requirement: The workout screen shows the plan beside what was logged
While a session is open, each planned exercise SHALL show its target sets and rep target. It SHALL also show the weight and reps logged for the same exercise in the most recent COMPLETED session, when one exists, and the sets logged so far in this session.

#### Scenario: Second time through a workout
- **WHEN** a user starts a workout whose exercise they logged at 225 lb × 5 last time
- **THEN** that exercise shows 225 lb × 5 as last time, and the weight stepper starts at 225 lb

#### Scenario: First time on an exercise
- **WHEN** an exercise has never been logged
- **THEN** no previous numbers are shown and the weight stepper starts empty

### Requirement: Logging a set inserts one set row, creating its exercise row on first contact
Logging the first set of a planned exercise SHALL create its session exercise row (linked to the planned exercise) and the set. Later sets SHALL add one set row each, numbered in order. A set SHALL record reps, weight and a weight unit.

#### Scenario: First set of an exercise
- **WHEN** a user logs 135 lb × 8 for the first planned exercise
- **THEN** one session exercise row and one set row (set 1, 8 reps, 135 LB, NORMAL) exist

#### Scenario: Extra sets beyond the target
- **WHEN** a user logs a 6th set against a target of 5
- **THEN** set 6 is recorded; the target is not a limit

#### Scenario: Stopping short
- **WHEN** a user logs 3 sets against a target of 5 and finishes
- **THEN** exactly 3 set rows exist; nothing records the 2 missing sets

### Requirement: A logged set can be edited
A user SHALL be able to change a logged set's reps and weight. The set's number and its unit-stamping rule SHALL stay unchanged.

#### Scenario: Correcting reps
- **WHEN** a user edits set 2 from 5 reps to 4
- **THEN** set 2 reads 4 reps and no other set changes

### Requirement: Deleting a set renumbers the survivors atomically
Deleting a logged set SHALL remove it and renumber that exercise's later sets so numbering stays contiguous from 1, as one transaction. When the last set of a session exercise is deleted, the session exercise row SHALL be removed too.

#### Scenario: Deleting a middle set
- **WHEN** sets 1–4 exist and the user deletes set 2
- **THEN** three sets remain, numbered 1, 2, 3, in their original order

#### Scenario: Deleting the only set
- **WHEN** an exercise has one logged set and the user deletes it
- **THEN** neither the set nor its session exercise row remains, and the exercise reads as skipped

### Requirement: Skipping an exercise writes nothing
Moving past a planned exercise without logging SHALL write no rows.

#### Scenario: Skip
- **WHEN** a user skips an exercise and finishes the workout
- **THEN** that planned exercise has no session exercise row in the session

### Requirement: An unfinished session is offered for resumption
When the user has an IN_PROGRESS session, the home screen SHALL offer to resume it, and resuming SHALL show the sets already logged.

#### Scenario: Reopening the app mid-workout
- **WHEN** a user closes the app after logging two sets and opens it again
- **THEN** they are offered "resume", and resuming shows both sets logged

### Requirement: Finishing completes the session and keeps open-ended programs going
Finishing SHALL mark the session COMPLETED. In the same transaction, if every workout of the program now has a COMPLETED or SKIPPED session, an open-ended program SHALL gain one new cycle copied from its highest-numbered cycle and stay ACTIVE.

#### Scenario: Finishing mid-cycle
- **WHEN** a user finishes a workout that is not the last unresolved one
- **THEN** the session is COMPLETED and no cycle is added

#### Scenario: Finishing the last workout of the cycle
- **WHEN** a user finishes the last unresolved workout of an open-ended program's only cycle
- **THEN** cycle 2 exists with the same workouts, exercises, set targets and names as cycle 1
- **AND** what's next shows cycle 2's first workout

#### Scenario: Extension is retry-safe
- **WHEN** the finish for that session is delivered twice
- **THEN** exactly one new cycle exists

### Requirement: Session writes are scoped and entitled
Every session read and write SHALL be confined to the signed-in user's own rows, and every session write SHALL require an entitled account.

#### Scenario: Logging into another user's session
- **WHEN** a log-set request names a session exercise or session owned by another user
- **THEN** it is refused and nothing is written

#### Scenario: Lapsed account logs a set
- **WHEN** an account that is not TRIALING or ACTIVE logs a set
- **THEN** the request is refused

### Requirement: Slots the logger cannot log yet are shown, not dropped
The workout screen SHALL show every planned slot in position order. A placeholder slot, or an exercise whose metrics are not weight and reps, SHALL show its label or name, its target sets, and a note that logging it arrives soon. It SHALL offer Skip and accept no sets.

#### Scenario: Placeholder in a workout
- **WHEN** a user starts a workout containing a placeholder "conditioning finisher"
- **THEN** the slot appears in its position with its label and the "arrives soon" note, and no set can be logged against it

#### Scenario: Timed exercise in a workout
- **WHEN** a workout contains Plank (duration only)
- **THEN** Plank appears with the "arrives soon" note instead of weight and reps fields

#### Scenario: Finishing around them
- **WHEN** the user skips those slots and finishes
- **THEN** the session is COMPLETED and those slots have no session rows

### Requirement: Finishing a fixed program's last workout completes it
When a finish leaves every workout of a fixed-length program with a COMPLETED or SKIPPED session, the program SHALL become COMPLETED in the same transaction. It SHALL leave "what's next", and SHALL NOT gain a cycle on its own.

#### Scenario: Last workout of cycle 12 of 12
- **WHEN** a user finishes the last unresolved workout of a 12-cycle program
- **THEN** the program is COMPLETED, no cycle 13 exists, and it no longer appears in "what's next"

### Requirement: A whole workout can be skipped before it starts
From home, a user SHALL be able to skip the next workout of an active program when it has no session. Skipping SHALL write one SKIPPED session and nothing else, SHALL work offline through the same ordered queue as logging, and SHALL be idempotent on its client-minted session id.

#### Scenario: Skipping legs after a hike
- **WHEN** a user skips "Legs", the next workout of their program
- **THEN** a SKIPPED session exists for Legs, and "what's next" shows the following workout

#### Scenario: Skipping offline
- **WHEN** a user skips a workout with no signal
- **THEN** home shows the following workout at once, and the skip reaches the server in order when signal returns

#### Scenario: Started workouts are not skippable
- **WHEN** a workout has an IN_PROGRESS session
- **THEN** home offers Continue and Finish & start next for it, not Skip

### Requirement: Skipping the last workout rolls the program over like finishing
When a skip leaves every workout of the program resolved, the same transaction SHALL extend an open-ended program by one cycle, or complete a fixed one, exactly as finishing does.

#### Scenario: Skipping the cycle's last workout
- **WHEN** a user skips the last unresolved workout of an open-ended program's newest cycle
- **THEN** the program gains one cycle and "what's next" shows its first workout

### Requirement: A forgotten workout can be finished and the next started in one action
For an IN_PROGRESS session, home SHALL offer to finish it and start that program's next workout in one action, queuing the finish before the start.

#### Scenario: Yesterday's workout left open
- **WHEN** a user chooses Finish & start next on yesterday's unfinished Push A
- **THEN** Push A is finished with the sets it has, and the workout screen opens on the program's next workout
