# Phase 2 full-match upload

Full-match footage now uploads directly from the browser to Cloudflare R2 using S3-compatible multipart uploads. Vercel and Render only coordinate the upload; the video bytes no longer pass through Vercel functions or Render's temporary filesystem.

## Required Cloudflare R2 CORS policy

Apply this policy to the private R2 bucket:

```json
[
  {
    "AllowedOrigins": ["https://rugby-video-analysis.vercel.app"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

## Required Render environment variables

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`
- `R2_ENDPOINT_URL` (optional)

The hosted upload limit is 5 GB. The browser splits footage into 16 MB parts, uploads each part directly to R2, then asks the API to complete the multipart upload and queue analysis.

## Verification

1. Open `/system` and confirm object storage is enabled and healthy.
2. Create or select a match.
3. Upload a full-match MP4, MOV, AVI, MKV, or M4V file.
4. Confirm progress reaches 100% and an analysis job appears.
5. Confirm FFmpeg reads metadata and creates a thumbnail using a signed R2 URL.
6. Redeploy Render and confirm the original source video remains playable.
