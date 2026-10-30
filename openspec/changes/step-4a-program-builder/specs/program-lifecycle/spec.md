# Spec Delta

## Purpose

A user's programs as a set: seeing them, starting and stopping them, copying
an old one, renaming, and running one more cycle of a fixed program.

## ADDED Requirements

### Requirement: Users see all their programs by status
A user SHALL see every program they own with its name, status (DRAFT, ACTIVE, COMPLETED or ARCHIVED) and progress. A fixed program SHALL show "cycle n of N", and an open-ended one "cycle n" with no total. Other users' programs SHALL never appear.

#### Scenario: Mixed statuses
- **WHEN** a user has one DRAFT, two ACTIVE and one ARCHIVED program
- **THEN** all four appear, each with its status

#### Scenario: Open-ended progress
- **WHEN** an open-ended program is in its fourth cycle
- **THEN** its progress reads "Cycle 4" with no total

### Requirement: Activating a program never touches another
A user SHALL be able to activate a DRAFT or ARCHIVED program. Activation SHALL change only that program's status, and any number of programs MAY be active at once. An activated program SHALL appear in "what's next".

#### Scenario: Second active program
- **WHEN** a user with an active lifting program activates a running program
- **THEN** both are ACTIVE and "what's next" offers a workout from each

### Requirement: Archiving is how a program stops
A user SHALL be able to archive a DRAFT, ACTIVE or COMPLETED program. An archived program SHALL leave "what's next", keep its history, and never be marked COMPLETED by archiving.

#### Scenario: Stopping a program early
- **WHEN** a user archives an ACTIVE program halfway through
- **THEN** it is ARCHIVED, not COMPLETED, and its logged sessions remain in history

### Requirement: Copying a program creates an independent DRAFT
A user SHALL be able to copy any of their programs. The copy SHALL be a new DRAFT built from the source's cycle 1 with the source's length, sharing no rows with it. A colliding name SHALL be auto-suffixed ("Name (2)", then the next free number), and the user MAY rename it in the same flow.

#### Scenario: Copy keeps the source intact
- **WHEN** a user copies "Summer Strength" and then edits the copy
- **THEN** the original program and its history are unchanged

#### Scenario: Name collision
- **WHEN** a user copies "Summer Strength" while "Summer Strength" and "Summer Strength (2)" exist
- **THEN** the copy is named "Summer Strength (3)"

#### Scenario: Retried copy
- **WHEN** the same copy request, with the same new program id, is sent twice
- **THEN** one copy exists

### Requirement: Users rename programs
A user SHALL be able to rename any of their programs. A name already used by another of their programs SHALL be refused with a message naming the clash.

#### Scenario: Rename
- **WHEN** a user renames "Base Building" to "Winter Base"
- **THEN** the program, its history entries and "what's next" show "Winter Base"

### Requirement: A fixed program can run one more cycle
A user SHALL be able to extend a fixed-length program by one cycle. The extension SHALL clone the highest-numbered cycle, increase the cycle count by one, and set the program ACTIVE, all in one transaction. Open-ended programs SHALL NOT offer this, because they extend automatically.

#### Scenario: Extending a completed program
- **WHEN** a user extends a COMPLETED 12-cycle program
- **THEN** it is ACTIVE with 13 cycles, and cycle 13 matches cycle 12

#### Scenario: Retried extend
- **WHEN** the same extend request is sent twice
- **THEN** the program gains exactly one cycle

### Requirement: Lifecycle writes require an entitled account
Activate, archive, copy, rename and extend are writes, and SHALL be refused for an account that is not entitled. The program list SHALL stay open.

#### Scenario: Lapsed account
- **WHEN** an account that is neither TRIALING nor ACTIVE copies a program
- **THEN** the request is refused and nothing is written
