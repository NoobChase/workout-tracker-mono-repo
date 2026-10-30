# exercise-catalog Specification

## Purpose

The exercise list a user picks from when building programs: standard
exercises plus their own custom ones, with their metrics, muscles, equipment
and personal setup notes.

## Requirements

### Requirement: Users browse standard and their own active exercises
The catalog SHALL list every active standard exercise and every active exercise the user created, ordered by name, each with its metrics, muscles and equipment. It SHALL NOT list another user's custom exercises.

#### Scenario: Browsing
- **WHEN** a user opens the exercise list
- **THEN** standard exercises and their own active custom exercises appear by name, and no other user's custom exercise appears

### Requirement: The catalog filters by muscle, equipment and name
A user SHALL be able to narrow the list by a muscle (primary or secondary), by equipment, and by a case-insensitive name search, in any combination.

#### Scenario: Muscle filter
- **WHEN** a user filters by QUADS
- **THEN** only exercises with QUADS among their primary or secondary muscles are listed

#### Scenario: Name search
- **WHEN** a user searches "row"
- **THEN** exercises whose name contains "row" in any case are listed

### Requirement: Users create custom exercises with their metrics
A user SHALL be able to create an exercise with a name, at least one metric, each metric marked required or optional, and optionally muscles and equipment. The exercise and its metrics SHALL be written together, or not at all.

#### Scenario: Usually bodyweight, sometimes loaded
- **WHEN** a user creates "Reverse Hyper" with REPS required and WEIGHT optional
- **THEN** it appears in their catalog with those two metrics

#### Scenario: Retrying a create
- **WHEN** the same create request, with the same exercise id, is sent twice
- **THEN** one exercise exists, and the second request returns it

### Requirement: Exercise names are unique per owner
A custom exercise's name SHALL NOT duplicate one of the user's other exercises or a standard exercise, ignoring case; retired exercises still hold their names. A clash SHALL be refused with a message naming the existing exercise.

#### Scenario: Clash with a standard exercise
- **WHEN** a user creates a custom exercise named "back squat"
- **THEN** the request is refused, saying "Back Squat" already exists

### Requirement: Muscle classification follows the catalog rules
A primary muscle SHALL be required for any secondary muscle, and no muscle SHALL be both primary and secondary. A violation SHALL be refused with a message saying which rule failed.

#### Scenario: Secondary without primary
- **WHEN** a user saves an exercise with secondary muscles and no primary
- **THEN** the save is refused with a message that a primary muscle is required first

### Requirement: Users edit their own exercises but not their metrics
A user SHALL be able to rename their own custom exercise and change its muscles and equipment. They SHALL NOT be able to change its metrics, or edit a standard exercise.

#### Scenario: Editing a standard exercise
- **WHEN** a user tries to rename "Back Squat"
- **THEN** the request is refused and the exercise is unchanged

#### Scenario: Renaming their own
- **WHEN** a user renames their "Reverse Hyper" to "Reverse Hyperextension"
- **THEN** the new name appears everywhere it is used, including history

### Requirement: Users record setup and cues for any exercise
A user SHALL be able to save free-text setup (such as rack heights) and cues for any exercise they can see, standard or their own. These persist across programs, and other users never see them.

#### Scenario: Annotating a standard exercise
- **WHEN** a user saves setup "pins at 4" on Back Squat
- **THEN** they see it on Back Squat in any program, and another user doesn't

### Requirement: Users retire their own exercises
A user SHALL be able to retire their own custom exercise. A retired exercise SHALL disappear from pickers and the browse list while staying in existing plans and history. A user SHALL be able to see their retired exercises and reactivate one.

#### Scenario: Retiring a used exercise
- **WHEN** a user retires a custom exercise that their logged sessions reference
- **THEN** it no longer appears in pickers, and history still shows it by name

#### Scenario: Reactivating
- **WHEN** a user reactivates a retired exercise
- **THEN** it appears in pickers again

### Requirement: Catalog writes require an entitled account
Creating, editing, annotating, retiring and reactivating exercises are writes, and SHALL be refused for an account that is not entitled. Browsing SHALL stay open.

#### Scenario: Lapsed account
- **WHEN** an account that is neither TRIALING nor ACTIVE creates a custom exercise
- **THEN** the request is refused and nothing is written
