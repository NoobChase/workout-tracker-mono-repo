# Spec Delta

## Purpose

Lets a lifter look back at the workouts they have finished: when each one
happened, what it was, and every set they logged in it.

## ADDED Requirements

### Requirement: History lists completed sessions, newest first
History SHALL list the user's COMPLETED sessions in descending order of when they were performed. Each entry SHALL show the date, the program and workout name, the cycle number, and the count of sets that count. In-progress sessions SHALL NOT appear in history.

#### Scenario: Three finished workouts
- **WHEN** a user has finished three workouts on different days
- **THEN** history lists all three, the most recent first

#### Scenario: Warm-ups and drop sets are not counted
- **WHEN** a session has 5 normal sets, 2 warm-up sets and 1 drop-set child
- **THEN** its entry counts 5 sets

#### Scenario: Only the user's own sessions
- **WHEN** another user has completed sessions
- **THEN** none of them appear

### Requirement: History pages through long records
History SHALL return a bounded page of entries and a way to fetch the next page, so a long training record never loads all at once.

#### Scenario: Older sessions
- **WHEN** a user with more sessions than one page scrolls to the end
- **THEN** the next page of older sessions loads, with no repeats and no gaps

### Requirement: A session opens to its full log
Opening a history entry SHALL show each exercise performed in order, with its sets in set-number order. Each set SHALL show its weight with the unit it was logged in, and its reps. Planned exercises that were skipped SHALL be shown as skipped.

#### Scenario: Session detail
- **WHEN** a user opens a session in which they logged 3 sets of squat in LB and skipped curls
- **THEN** the squat shows its three sets in order with LB, and curls show as skipped

#### Scenario: Another user's session id
- **WHEN** a user requests a session id that belongs to someone else
- **THEN** the response is the same as for a session that does not exist

### Requirement: History reads stay open to lapsed accounts
Reading history SHALL require a signed-in account but SHALL NOT require an entitled one.

#### Scenario: Lapsed account reads history
- **WHEN** an account whose subscription status is not TRIALING or ACTIVE opens history
- **THEN** its sessions are shown
