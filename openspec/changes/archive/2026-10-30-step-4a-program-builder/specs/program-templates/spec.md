# Spec Delta

## ADDED Requirements

### Requirement: Create from scratch opens the builder
The template list SHALL show a "Create from scratch" entry that opens the program builder. Choosing it SHALL write nothing until the user creates the program.

#### Scenario: Choosing create from scratch
- **WHEN** a user selects "Create from scratch"
- **THEN** the program builder opens with an empty first cycle, and no program exists yet

## REMOVED Requirements

### Requirement: Creating a program from scratch is announced, not built
**Reason**: The program builder exists now (step 4a). The entry point opens it instead of announcing it.
**Migration**: See "Create from scratch opens the builder" above. Nothing is stored, so no data changes.
