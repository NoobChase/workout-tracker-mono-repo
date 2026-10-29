# program-templates Specification

## Purpose

Default programs a user can start training from without building one, and the
exact program that starting a template creates for them.

## Requirements

### Requirement: Templates are listed to every signed-in user
The system SHALL offer a fixed set of default templates. Each template SHALL show its name, a one-line description, its workouts in order, and the exercises in each workout. Templates SHALL reference only standard catalog exercises that are active, weighted and rep-based, and SHALL contain no placeholder slots.

#### Scenario: Browsing templates
- **WHEN** a signed-in user opens the template list
- **THEN** every default template is shown with its name, description, workouts and exercises

#### Scenario: Template content is valid against the catalog
- **WHEN** the template data is checked against the standard catalog
- **THEN** every referenced exercise exists, is active, is standard, and declares weight and reps metrics

### Requirement: Starting a template creates an active open-ended program
Starting a template SHALL create, in one transaction, a program owned by the user with no cycle target (open-ended), status ACTIVE, and exactly one materialized cycle that copies the template's workouts, exercises, target set counts and rep targets. It SHALL prescribe no weights.

#### Scenario: First start of a template
- **WHEN** a user starts the "Push Pull Legs" template
- **THEN** the user has one new ACTIVE program with an open-ended cycle count, one cycle, and that template's workouts in order
- **AND** no planned set carries a target weight

#### Scenario: Failure leaves nothing behind
- **WHEN** creating the program fails partway
- **THEN** no program, cycle, workout, planned exercise or planned set from that attempt exists

### Requirement: Starting a template is idempotent on its client-minted id
A start request SHALL carry a program id minted by the client. Repeating the request with the same id SHALL NOT create a second program.

#### Scenario: Retried start
- **WHEN** the same start request is sent twice with the same program id
- **THEN** exactly one program exists and both responses describe it

### Requirement: Program names stay unique per user
When the user already has a program with the template's name, the new program SHALL take the name with the next free numeric suffix, as copying a program does.

#### Scenario: Starting the same template twice
- **WHEN** a user who already has "Push Pull Legs" starts that template again with a new id
- **THEN** the second program is named "Push Pull Legs (2)" and both are ACTIVE

### Requirement: Creating a program from scratch is announced, not built
The template list SHALL show a "Create from scratch" entry. In this change it SHALL state that the program builder is not available yet, and it SHALL write nothing.

#### Scenario: Choosing create from scratch
- **WHEN** a user selects "Create from scratch"
- **THEN** they see that the builder is coming, and no program is created

### Requirement: Starting a template requires an entitled account
Starting a template is a write. It SHALL be refused for an account that is not entitled.

#### Scenario: Lapsed account starts a template
- **WHEN** an account whose subscription status is not TRIALING or ACTIVE starts a template
- **THEN** the request is refused and no program is created
