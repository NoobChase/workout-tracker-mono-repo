/*
 * Clerk's bundled UI in the Tanren world, as far as its appearance API
 * reaches. Every color is one of our tokens by reference (Clerk accepts CSS
 * variables), so both themes follow `data-theme` and the device with no
 * second copy of a value. The sign-in card sits on the page, so it is flat:
 * a hairline, no shadow (DESIGN.md, "The Only Floaters Cast Rule").
 */

const inkLink = {
  color: "var(--text) !important",
  textDecoration: "underline",
  textDecorationColor: "var(--line-2)",
  textUnderlineOffset: "3px",
};

/** Lucide's `user`, as a mask: the avatar glyph takes `--text` per theme. */
const USER_GLYPH = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'><path d='M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2'/><circle cx='12' cy='7' r='4'/></svg>",
)}") center / 18px 18px no-repeat`;

const variables = {
  colorPrimary: "var(--copper-btn)",
  colorPrimaryForeground: "var(--on-copper)",
  colorBackground: "var(--bg)",
  colorForeground: "var(--text)",
  colorMuted: "var(--card)",
  colorMutedForeground: "var(--muted)",
  colorNeutral: "var(--text)",
  colorInput: "var(--bg)",
  colorInputForeground: "var(--text)",
  colorBorder: "var(--line-2)",
  colorRing: "var(--copper)",
  colorDanger: "var(--danger)",
  colorShadow: "var(--shadow)",
  colorModalBackdrop: "var(--scrim)",
  fontFamily: '"Albert Sans Variable", system-ui, sans-serif',
  fontFamilyButtons: '"Albert Sans Variable", system-ui, sans-serif',
  fontFamilyMono: '"Geist Mono Variable", ui-monospace, monospace',
  fontSize: "16px",
  borderRadius: "0.5rem",
};

export const signInAppearance = {
  variables,
  elements: {
    rootBox: { width: "100%" },
    cardBox: {
      width: "100%",
      maxWidth: "100%",
      boxShadow: "none",
      border: "1px solid var(--line)",
      borderRadius: "12px",
    },
    // On the first step the page's own heading says what this is; later
    // steps ("Check your email") keep Clerk's header, which names the step.
    header: { ".cl-signIn-start &": { display: "none" } },
    headerTitle: {
      fontSize: "20px",
      fontWeight: 700,
      letterSpacing: "-0.01em",
    },
    headerSubtitle: { fontSize: "15px", color: "var(--muted)" },
    footer: { background: "var(--bg)", borderTop: "1px solid var(--line)" },
    formFieldLabel: {
      fontSize: "14px",
      fontWeight: 500,
      color: "var(--muted)",
    },
    // Clerk draws edges as box-shadows (border width 0) at a faint alpha of
    // colorBorder, and its own rules outrank these, hence `!important`:
    // the field boundary must be Edge (3:1), as every field in the app.
    formFieldInput: {
      height: "48px",
      fontSize: "16px",
      boxShadow: "0 0 0 1px var(--edge) !important",
      "&:focus": { boxShadow: "0 0 0 1px var(--copper) !important" },
    },
    formButtonPrimary: {
      // Flat copper, as our primary button: no sheen, no drop shadow.
      height: "48px",
      fontSize: "15px",
      fontWeight: 600,
      boxShadow: "0 0 0 1px var(--copper-btn) !important",
      "&::after": { display: "none" },
    },
    socialButtonsBlockButton: {
      height: "48px",
      boxShadow: "0 0 0 1px var(--line-2) !important",
    },
    otpCodeFieldInput: { boxShadow: "0 0 0 1px var(--edge) !important" },
    // Copper is for the primary action only (the One Copper Rule): Clerk
    // colors its links with colorPrimary, so they come back to ink here,
    // underlined so they still read as links.
    socialButtonsBlockButtonText: { color: "var(--text) !important" },
    dividerLine: { backgroundColor: "var(--line-2) !important" },
    dividerText: { color: "var(--muted) !important" },
    footerActionLink: inkLink,
    formFieldAction: inkLink,
    formResendCodeLink: inkLink,
    identityPreviewEditButton: inkLink,
    alternativeMethodsBlockButton: { color: "var(--text) !important" },
    backLink: inkLink,
    formFooterAction: inkLink,
    formFooterActionLink: inkLink,
    // Any other link Clerk adds to the card ("Use another method", …).
    card: {
      boxShadow: "none",
      background: "var(--bg)",
      padding: "24px",
      "& a, & .cl-link": inkLink,
    },
  },
};

export const userButtonAppearance = {
  variables,
  elements: {
    // The account control as a control, not a photo: a 36px square of card
    // stock with a Strong Hairline edge and the user glyph in ink, inside a
    // 44px target. Clerk's generated avatar (a saturated gradient) would be
    // the only color on the page besides copper.
    userButtonTrigger: { padding: "4px", borderRadius: "8px" },
    avatarBox: {
      position: "relative",
      width: "36px",
      height: "36px",
      borderRadius: "8px",
      backgroundColor: "var(--card)",
      boxShadow: "0 0 0 1px var(--line-2) !important",
      "& img": { display: "none" },
      "&::after": {
        content: '""',
        position: "absolute",
        inset: 0,
        backgroundColor: "var(--text)",
        WebkitMask: USER_GLYPH,
        mask: USER_GLYPH,
      },
    },
    userButtonPopoverCard: {
      border: "1px solid var(--line-2)",
      boxShadow: "0 24px 48px -12px var(--shadow)",
    },
  },
};
