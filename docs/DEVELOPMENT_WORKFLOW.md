# Development Workflow

This repository uses a protected release workflow to keep the working application stable while new capabilities are built.

## Branch roles

- `main`: stable, tested and release-ready code only.
- `develop`: integration branch for completed feature work awaiting release validation.
- `feature/<name>`: isolated development branch for one scoped change.
- `fix/<name>`: isolated branch for a defect or regression.

## Required flow

1. Create a feature or fix branch from `develop`.
2. Build and test the change on that branch.
3. Open a pull request into `develop`.
4. All Continuous Integration jobs must pass:
   - Backend Ruff and Pytest
   - Frontend lint and production build
   - Full application smoke test
5. Test the hosted preview or staging environment.
6. Merge into `develop` only after validation.
7. Open a release pull request from `develop` into `main`.
8. Merge to `main` only after all checks and release validation pass.

## Rules

- Do not develop directly on `main`.
- Do not upload full-match production data to Codespaces.
- Do not merge with failing or skipped required checks.
- Keep infrastructure changes separate from analysis-feature changes where practical.
- Every release must preserve the health endpoint, system diagnostics and smoke-test workflow.

## Local development

Codespaces remains the coding and debugging environment. Start the complete local stack with:

```bash
cd /workspaces/Rugby-Video-Analysis
bash scripts/dev.sh
```

Use the permanent hosted staging environment for full-match upload and long-running processing once the hosted foundation is deployed.
