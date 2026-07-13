# Hosted Account Setup

This checklist covers the one-time account-side setup for the Rugby Video Analysis staging environment.

## Render

1. Sign in to Render and select **New > Blueprint**.
2. Connect the private repository `reinholdkamilo/Rugby-Video-Analysis`.
3. Use branch `main` and Blueprint path `render.yaml`.
4. Name the Blueprint `rugby-video-analysis-staging`.
5. Review the resources before deployment:
   - `rugby-video-analysis-api`
   - `rugby-video-analysis-db`
   - a 20 GB persistent disk mounted at `/var/data`
6. When prompted for `FRONTEND_URL`, enter the expected Vercel production URL. If the URL is not known yet, use `https://rugby-video-analysis.vercel.app` and update it after the Vercel deployment.
7. Deploy the Blueprint.
8. Record the Render API URL and verify `/health` returns a healthy response.

## Vercel

1. Sign in to Vercel and select **Add New > Project**.
2. Import `reinholdkamilo/Rugby-Video-Analysis`.
3. Set the Root Directory to `frontend`.
4. Keep the detected Next.js framework and default build settings.
5. Add `BACKEND_INTERNAL_URL` for Production, Preview, and Development, using the Render API origin without a trailing slash.
6. Deploy the project.
7. Record the Vercel production URL.

## Final connection

1. In Render, update `FRONTEND_URL` to the exact Vercel production origin without a trailing slash.
2. Redeploy the Render API if Render does not automatically redeploy after the environment variable change.
3. In Vercel, redeploy after any environment variable change.

## Verification

Verify all of the following:

- Render `/health` returns HTTP 200.
- Vercel `/backend/health` returns HTTP 200.
- The dashboard loads organisations, teams, matches, and analysis jobs.
- A small test video can be uploaded and processed.
- The generated thumbnail is available after processing.

Do not upload a full match until the small-file verification succeeds.
