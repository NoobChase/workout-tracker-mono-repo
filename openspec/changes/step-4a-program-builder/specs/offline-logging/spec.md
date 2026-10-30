# Spec Delta

## ADDED Requirements

### Requirement: Public pages take a new version at once
When a new version of the app has installed and is waiting, the landing page, `/about`, sign-in and sign-up, and any page with nobody signed in SHALL reload into it at once, with no prompt, unless a text field has focus or a dialog is open, in which case it SHALL wait for the next change of screen or the next time the page is hidden or shown (design D18).

#### Scenario: Signed out after a deploy
- **WHEN** a signed-out visitor whose device runs the previous version opens the site after a deploy
- **THEN** the page reloads into the new version by itself, with no prompt

### Requirement: The signed-in app takes a new version at a safe moment
Signed in, with no workout in progress on this device, a waiting version SHALL install with no prompt at the next change of screen or the next time the page is hidden or shown. It SHALL first write any pending builder draft to the device, and SHALL wait while a dialog is open, a text field has focus, or a plan-side write is on the wire.

#### Scenario: Signed in, nothing in progress
- **WHEN** a new version is waiting while a signed-in user with no workout in progress is on home
- **THEN** home stays as it is with no prompt, and the next screen they open is the new version

### Requirement: Mid-workout, a new version only asks
With a workout in progress on this device, a waiting version SHALL NOT install on its own, including on a change of screen; a prompt SHALL offer "Reload". A reload SHALL NOT lose any queued write: every unacknowledged write SHALL be sent, in order, after it.

#### Scenario: Mid-workout
- **WHEN** a new version is waiting while a workout is in progress on this device
- **THEN** a prompt offers "Reload" and the app does not reload on its own, even on a change of screen

#### Scenario: Reloading with sets queued
- **WHEN** the lifter reloads from the prompt with a set queued and no signal
- **THEN** the set is still queued after the reload, and is delivered once a connection returns
