# Spec Delta

## Purpose

Creating a program from nothing and editing its cycles afterwards, including
carrying an edit into the cycles that follow without destroying ones the user
made different on purpose.

## ADDED Requirements

### Requirement: A program is created from its first cycle in one step
A user SHALL create a program by giving a name, a length (a number of cycles, or open-ended) and cycle 1's content. The program and every row of every materialized cycle SHALL be written in one transaction. A new program SHALL be a DRAFT.

#### Scenario: Fixed-length program
- **WHEN** a user creates "Summer Strength" with 12 cycles and a three-workout cycle 1
- **THEN** a DRAFT program exists with 12 identical cycles of three workouts each, numbered 1–12

#### Scenario: Open-ended program
- **WHEN** a user creates "Base Building" as open-ended
- **THEN** a DRAFT program exists with exactly one cycle and no cycle count

#### Scenario: Failure leaves nothing
- **WHEN** creating a program fails partway
- **THEN** no program, cycle, workout, planned exercise or planned set from that attempt remains

### Requirement: Creating a program is safe to retry
Creating a program SHALL be idempotent on its client-minted ids: repeating the same request SHALL return the same program and write nothing. Reusing a program id for different content SHALL be refused.

#### Scenario: Double submit
- **WHEN** the same create request is sent twice
- **THEN** one program exists and both responses describe it

### Requirement: A manually named program must have a free name
Creating or renaming a program SHALL be refused with a message naming the clash when the user already has a program with that exact name. Only copy and template start pick a free name automatically.

#### Scenario: Name taken
- **WHEN** a user creates "Summer Strength" and already has one
- **THEN** the request is refused, saying the name is in use, and nothing is created

### Requirement: A cycle holds ordered workouts of ordered slots
Each workout SHALL have a name, a position and optional notes. Each slot in it SHALL be either one exercise from the user's catalog or a free-text placeholder label, never both and never neither, with a target set count of at least one.

#### Scenario: Placeholder slot
- **WHEN** a user adds a slot labelled "do something that feels good" with 3 sets
- **THEN** the workout holds that slot at its position, with no exercise

#### Scenario: Another user's private exercise
- **WHEN** a cycle references an exercise the user cannot see
- **THEN** the request is refused and nothing is written

### Requirement: Per-set prescriptions are optional and partial
A slot MAY prescribe individual sets numbered from 1, each with an optional rep target (exact or a min–max range, min ≤ max) and an optional weight with a unit. A weight SHALL always carry its unit. A slot SHALL NOT prescribe more sets than its target set count.

#### Scenario: Partial prescription
- **WHEN** a slot targets 4 sets and prescribes sets 1–3 as 8–12 reps at 135 lb
- **THEN** sets 1–3 carry those targets and set 4 is freeform

#### Scenario: Inverted rep range
- **WHEN** a prescribed set has a rep max below its rep min
- **THEN** the request is refused with a message naming the workout, slot and set

### Requirement: A prescribed set may carry an effort target, RIR or RPE
A prescribed set MAY carry one effort target: reps in reserve (RIR, 0–10) or rate of perceived exertion (RPE, 1–10), in steps of 0.5, never both. The target SHALL be stored as written and shown beside the set's prescription in the builder and on the workout screen. Logging still records weight and reps only.

#### Scenario: RIR target
- **WHEN** a user prescribes Back Squat set 3 as 5 reps at 225 lb, RIR 2
- **THEN** the builder and the workout screen show "5 × 225 lb · RIR 2" for that set

#### Scenario: Both targets
- **WHEN** a prescribed set carries both an RIR and an RPE
- **THEN** the request is refused with a message naming the workout, slot and set

### Requirement: Exercises are grouped into supersets within a workout
A user SHALL be able to group two or more slots of one workout into a superset. Order within the group SHALL follow slot position, and labels such as A1/A2 SHALL be derived when shown, not stored.

#### Scenario: Superset
- **WHEN** a user groups Bench Press and Barbell Row
- **THEN** both slots share a group and are shown as A1 and A2 in position order

### Requirement: Editing a cycle changes only that cycle
A user SHALL be able to edit any cycle's workouts, slots, prescriptions, groups and notes, and save the cycle in one transaction. Saving SHALL change no other cycle unless the user also applies the edit to later cycles.

#### Scenario: Deload in cycle 9
- **WHEN** a user lowers every weight in cycle 9 and saves without applying
- **THEN** cycle 9 changes and cycles 8 and 10 do not

### Requirement: Trained workouts are frozen
A workout with any logged session SHALL NOT be edited, removed or moved, and nothing SHALL be inserted before it in the same cycle. Untrained workouts in the same cycle stay editable. Attempts SHALL be refused with a message naming the workout.

#### Scenario: Mid-cycle tweak
- **WHEN** a user has trained Push in cycle 3 and edits Legs in cycle 3
- **THEN** the Legs edit is saved and Push is unchanged

#### Scenario: Editing a trained workout
- **WHEN** a save changes a trained workout
- **THEN** the save is refused with a message naming that workout, and nothing is written

### Requirement: An edit is offered to later cycles at save time only
When saving a cycle, the user SHALL be able to apply the edit to later cycles. The edited cycle and each chosen later cycle SHALL then be identical in structure and prescriptions, all written in the same transaction as the edit. There SHALL be no way to apply an edit after it was saved.

#### Scenario: Add an exercise to every remaining cycle
- **WHEN** a user adds Face Pulls to cycle 5 of 12 and applies to cycles 6–12
- **THEN** cycles 5–12 all contain Face Pulls, and cycles 1–4 do not

### Requirement: The apply choice shows each later cycle's status
Before a save that applies, the user SHALL see every later cycle with one status. Trained cycles SHALL be locked and excluded. A cycle matching the edited cycle's pre-edit structure SHALL be pre-selected. A cycle that differs SHALL be unselected and annotated as looking intentionally different. Notes SHALL NOT count as a difference.

#### Scenario: Authored deload
- **WHEN** cycle 9 of 12 has different weights and the user edits cycle 5
- **THEN** cycles 6–8 and 10–12 are pre-selected, and cycle 9 is unselected and marked as looking intentionally different

#### Scenario: Notes only
- **WHEN** cycle 7 differs from the pre-edit cycle 5 only in workout notes
- **THEN** cycle 7 is pre-selected

#### Scenario: User overrides the guard
- **WHEN** the user selects the flagged cycle 9 anyway
- **THEN** cycle 9 is replaced like the others

### Requirement: A stale apply choice is refused
A save SHALL be refused, writing nothing, if the edited cycle or any chosen later cycle changed after the user saw the apply choice, or if a chosen cycle became trained. The message SHALL say to reload and try again.

#### Scenario: Trained since preview
- **WHEN** a session is logged against cycle 6 after the apply choice was shown, and the user saves with cycle 6 selected
- **THEN** the save is refused and no cycle changes

### Requirement: Saving a cycle is safe to retry
Repeating a cycle save whose effect is already in place SHALL succeed and write nothing.

#### Scenario: Retried save
- **WHEN** a save that applied to cycles 6–12 is sent again after it succeeded
- **THEN** the response reports success and no row is rewritten

### Requirement: Builder writes require an entitled account
Creating a program and saving a cycle are writes, and SHALL be refused for an account that is not entitled. Reading programs and cycles SHALL stay open.

#### Scenario: Lapsed account
- **WHEN** an account that is neither TRIALING nor ACTIVE creates a program
- **THEN** the request is refused and nothing is written
