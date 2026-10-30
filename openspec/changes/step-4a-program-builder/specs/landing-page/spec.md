# Spec Delta

## Purpose

What a signed-out visitor sees at the site root: a page that explains Tanren
and leads to sign-in or sign-up, built from the design agreed with the user.

## ADDED Requirements

### Requirement: Signed-out visitors land on the landing page
A visit to `/` by someone who is not signed in SHALL show the landing page agreed in this change's design session. It SHALL NOT show the Clerk sign-in form first.

#### Scenario: First visit
- **WHEN** a visitor with no session opens `https://tanrenstrength.com/`
- **THEN** they see the landing page, not a sign-in form

### Requirement: Signed-in users go straight to the app
A visit to `/` by a signed-in user whose device holds the last-user record SHALL show the app's home ("what's next"), not the landing page. A signed-in user whose device record was cleared SHALL see the landing page paint first and then be swapped to the app's home once Clerk reports the session, with no action from them (design D2); the landing page SHALL NOT wait on Clerk to paint.

#### Scenario: Returning user
- **WHEN** a signed-in user whose device holds the last-user record opens `/`
- **THEN** they see their home screen without passing through the landing page

#### Scenario: Signed in, device record cleared
- **WHEN** a signed-in user whose device record was cleared opens `/`
- **THEN** the landing page paints first
- **AND** once Clerk reports the session, the app's home replaces it without the user doing anything

### Requirement: Calls to action lead to Clerk
"Log in" SHALL open sign-in. "Get started" and the trial call to action SHALL open sign-up. Completing either SHALL land the user in the app.

#### Scenario: Getting started
- **WHEN** a visitor selects "Get started" and completes sign-up
- **THEN** they arrive at the app's home screen, signed in

#### Scenario: Logging in
- **WHEN** a visitor selects "Log in" and signs in
- **THEN** they arrive at the app's home screen

### Requirement: The landing page renders without the app bundle
The landing page SHALL render without first downloading the authenticated app and the Clerk bundle. It SHALL work at phone width with no horizontal scroll, in light and dark themes.

#### Scenario: Cold load on a phone
- **WHEN** a signed-out visitor loads `/` on a phone-width viewport
- **THEN** the landing content renders before the app and Clerk code has loaded, and the page doesn't scroll horizontally

### Requirement: The page states nothing untrue
The landing page SHALL NOT present unbuilt features as available, SHALL NOT show a price before one is set, and SHALL NOT show testimonials or data that are not real unless they are labelled as examples. It SHALL credit any third-party stroke data under its license.

#### Scenario: Pricing before billing exists
- **WHEN** the landing page is viewed before step 5 sets a price
- **THEN** no dollar amount for the subscription is shown

#### Scenario: Stroke-order attribution
- **WHEN** the page uses KanjiVG stroke data
- **THEN** the page credits KanjiVG and its CC BY-SA 3.0 license
