# PostHog website tracking

The public marketing pages send pageviews and masked interaction events to PostHog. Session replay masks all text and inputs, blocks embedded frames and images, and disables console recording and network bodies/headers. Account, checklist, portal and workspace pages do not mount analytics; leaving the marketing layout stops replay and opts out of capture.

Project: Default project (711583), US cloud.

Set `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` and `NEXT_PUBLIC_POSTHOG_HOST` on the Railway **web** service before building. The Dockerfile exposes both as build arguments because Next.js compiles public variables into the browser bundle. Local development loads `apps/web/.env.local` (ignored by Git). Missing configuration leaves tracking disabled.

Use PostHog live events to verify `$pageview` events from `https://www.weatherlytc.com` after deployment. Visit multiple public pages and then `/login` to verify capture stops. This integration does not send authenticated identities or server-side business events.

Setup reference: https://posthog.com/docs/libraries/next-js
Privacy reference: https://posthog.com/docs/session-replay/privacy
