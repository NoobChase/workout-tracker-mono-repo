# Spec Delta

## ADDED Requirements

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
