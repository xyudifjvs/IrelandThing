# Workspace theme handoff

Base `70c1994`. Branch `codex/handoff-c02-theme`. Worktree `/private/tmp/weatherly-handoff-c02`.

The coordinator workspace now uses the handoff palette, local Montserrat and Cormorant Garamond, white panels, brown actions and a dark sidebar. The desktop sidebar uses cream tiles for the supplied wordmark and handwritten mark. The narrow layout uses a native Menu disclosure with keyboard support and the same workspace links.

## Files and integration

| Path | Responsibility |
| --- | --- |
| `apps/web/app/workspace-theme.css` | Shared colors, type, radii, focus and cream tile styles. Apply `weatherly-theme` to an app or portal surface to inherit them. |
| `apps/web/app/layout.tsx` | Loads the existing licensed Montserrat file as a local CSS variable alongside the existing fonts. Public pages keep their existing theme. |
| `apps/web/app/_components/WeatherlyBrand.tsx` | Shared wordmark and handwritten mark component. Use the default wordmark in the portal header and `variant="mark"` in the client footer. Set `decorative` when the containing link or adjacent label already identifies Weatherly. |
| `apps/web/public/brand/handoffs/weatherly-wordmark.png` and `weatherly-mark.png` | Lossless PNG renderings of the supplied `Primary.pdf` and `icon .pdf`, respectively. The source artwork is unchanged. |
| `apps/web/app/(workspace)/workspace/_components/Shell.tsx` and `workspace-shell.module.css` | Coordinator shell, auth gate, sidebar, mobile navigation, sign-out and shell-specific layout. |
| `apps/web/app/(workspace)/workspace/_components/workspace-navigation.ts` | Single link list for desktop and mobile. Update the entries in the same integration that introduces Roster, Notes and HTO Operations and removes the old intake/onboarding/review destinations. The working routes are available until those replacements land. |
| `apps/web/app/(workspace)/workspace/_components/workspace.module.css` | Shared workspace panels, forms, tables, actions, headings and responsive layout consume the theme tokens. |

C13 can apply the shared theme and artwork to portal surfaces. The supplied `og-1-cream.png` social preview image is still needed. The existing Open Graph route and favicon remain in use pending that asset.

## Validation

- `npm run typecheck` and the isolated production `npm run build` passed. The build prerendered 34 pages and retained all workspace routes.
- The existing SEO and navigation suites passed all 12 tests.
- Chrome with synthetic API responses verified the desktop workspace, 1024 px and 768 px tablet sizes, and 390 px and 320 px mobile sizes. The document stayed within the viewport at each width. The existing transaction table scrolls inside its container at 320 px.
- Browser checks confirmed the exact background, white panel, dark sidebar and cream tile colors. The heading rendered in the Cormorant Garamond font and body text used Montserrat. The supplied PNG artwork decoded and matched the local renders byte for byte.
- Enter opened the mobile menu. Escape closed it and returned focus to Menu. The same ten workspace routes appeared on desktop and mobile. Navigating closed the menu, sign-out used the existing POST endpoint, and an agent session saw the portal entry instead of coordinator navigation. The public home had no theme wrapper and kept its favicon.
- Measured contrast was 15.35:1 for text on the workspace background, 14.15:1 for sidebar text, 7.55:1 for accent on white, 6.50:1 for secondary text on the workspace background and 5.79:1 for warning text. The faint token provides 3.82:1 for control outlines on white.
