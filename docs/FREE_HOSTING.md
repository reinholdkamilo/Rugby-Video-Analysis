# Zero-Cost Hosting Profile

This profile is for development, demonstrations, and small-video testing without paid subscriptions.

## Services

- Backend: Render Free web service using `render.free.yaml`
- Database: Neon Free PostgreSQL
- Frontend: Vercel Hobby for personal, non-commercial testing only
- Video storage: temporary Render filesystem for clips up to 100 MB

## Important limits

The Render Free filesystem is ephemeral. Uploaded videos, thumbnails, generated clips, and incomplete upload sessions can disappear whenever the service sleeps, restarts, or redeploys.

The free backend sleeps after inactivity and can take around one minute to wake. It is therefore unsuitable for unattended full-match processing.

This profile deliberately limits uploads to 100 MB. It is designed to validate the interface, database, upload protocol, processing pipeline, and report workflow with short clips.

Do not use the free profile for irreplaceable footage or production users.

## Render setup

Create a Blueprint with:

- Branch: `main` after this profile is merged
- Blueprint path: `render.free.yaml`
- Region: Singapore
- Plan: Free

Set these prompted environment variables:

- `DATABASE_URL`: pooled Neon PostgreSQL connection string
- `FRONTEND_URL`: exact hosted frontend origin
- `ALLOWED_ORIGINS`: exact hosted frontend origin

Do not add a Render disk or Render PostgreSQL database.

## Neon setup

Create a Free Neon project and copy its pooled PostgreSQL connection string into Render as `DATABASE_URL`.

The application normalizes ordinary `postgres://` and `postgresql://` URLs for psycopg 3.

## Vercel setup

Import the repository with root directory `frontend` and set:

- `BACKEND_INTERNAL_URL`: Render backend origin

Vercel Hobby is limited to personal, non-commercial use. It is suitable for development and proof-of-concept testing, not a paid customer service.

## Safe test workflow

1. Create an organisation, teams, and a match.
2. Upload a 10–60 second MP4 under 100 MB.
3. Confirm processing reaches 100%.
4. Review the generated metadata, thumbnail, event suggestions, understanding report, and intelligence report.
5. Treat uploaded media as disposable.

## Path to persistent free-tier storage

Cloudflare R2 includes a monthly free allowance, but the application needs an object-storage adapter before full-match footage can be stored there safely. That adapter is the next infrastructure milestone.

Until R2 integration is complete, do not upload full matches to the free hosted environment.
