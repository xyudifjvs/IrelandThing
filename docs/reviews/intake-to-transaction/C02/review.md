# Independent workspace theme review

**Candidate:** `a65c27d58155c214400c08d1098a7a37d276111c` in `/private/tmp/weatherly-handoff-c02`.

**Disposition:** Changes requested. The open mobile navigation can cover keyboard focus after it moves into the workspace.

## Mobile menu focus

In Chrome at 320 × 640, open Menu on the coordinator Overview, focus its last item, Sign out, and press Tab. Focus moves to Review submitted intakes. The disclosure stays open and overlays the focused link. The following Start manually and Refresh overview controls are also covered. At 390 × 640, the latter two controls are covered. Hit-testing the focused controls at their left, center, and right returned elements inside the menu instead of the controls.

`apps/web/app/(workspace)/workspace/_components/Shell.tsx:142` handles Escape and closes on navigation through its pathname key. Add focus-out behavior to close the disclosure when focus leaves it, retaining the destination focus. Verify Tab and Shift+Tab across the disclosure boundary and Escape within it.

## Checks that passed

- TypeScript and the candidate diff check passed independently. I started the candidate production build on loopback and ran a separate synthetic Chrome probe with all external network requests blocked.
- The ten retained workspace paths responded with HTTP 200. Desktop and mobile offered the same workspace links. Overview had the active marker. Enter opened Menu, Escape closed it and restored focus, and navigation closed it. Sign out used the existing POST endpoint, and the synthetic agent session saw the portal entry instead of coordinator navigation.
- The Overview document stayed within the viewport at 1440, 768, 390, and 320 pixels. The rendered cream background, dark sidebar, wordmark and handwritten mark follow the approved shell. The PNG files match the supplied artwork renders byte for byte. The shared brand component and opt-in theme cover the portal styling requirements for the later portal work.
- The workspace uses Montserrat for body text and the Cormorant Garamond heading token. The main, sidebar, accent, secondary and warning text contrast pairs measured 15.35:1, 14.15:1, 7.55:1, 6.50:1, and 5.79:1. The faint control outline measured 3.82:1 on white.
- The public homepage had no workspace theme wrapper and retained `/brand/icon.jpeg` as its favicon. Marketing files, global CSS, and existing Open Graph implementation are unchanged in the candidate. `og-1-cream.png` was absent from the supplied files. The final Roster, Notes and HTO destinations remain assigned to their respective chunks and shared integration.

## Follow-up review

**Candidate:** `f5b486b9d9cb89deccdec52e8a5709572cab4519`.

**Disposition:** Accepted. The mobile navigation focus issue is resolved.

- Built the exact candidate and reran the synthetic Chrome checks on a fresh production preview with external requests blocked. The build and `git diff --check` passed.
- At 320 × 640, 390 × 640, and 650 × 640, Tab from Sign out closed Menu and moved focus to Review submitted intakes. The next two Tabs focused Start manually and Refresh overview. Browser hit-testing at three points across each focused control confirmed it was unobscured.
- In reverse, Shift+Tab from Overview moved focus to Menu and kept the disclosure open. The next Shift+Tab focused the Weatherly logo and closed the disclosure. Backward Tab through the page actions returned to the closed Menu. Escape still closed the disclosure and restored focus to Menu.
- Mouse navigation to Calendar and sign-out passed. The synthetic sign-out request used POST and the browser moved to login. The rerun also passed all ten retained workspace routes, responsive overflow, role gating, public theme isolation, and favicon checks.
