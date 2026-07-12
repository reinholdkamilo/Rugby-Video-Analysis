from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AnalysisJob, Match, Organisation, Team
from app.schemas import AnalysisJobRead, MatchRead, OrganisationRead, TeamRead

router = APIRouter(prefix="/api/workspace", tags=["workspace"])


def _load_section(db: Session, statement, schema) -> tuple[list[dict[str, Any]], str | None]:
    try:
        rows = list(db.scalars(statement))
        return [schema.model_validate(row).model_dump(mode="json") for row in rows], None
    except Exception as exc:  # Keep one damaged section from taking down the dashboard.
        db.rollback()
        return [], f"{type(exc).__name__}: {exc}"


@router.get("/bootstrap")
def workspace_bootstrap(db: Session = Depends(get_db)) -> dict[str, Any]:
    organisations, organisation_error = _load_section(
        db, select(Organisation).order_by(Organisation.name), OrganisationRead
    )
    teams, team_error = _load_section(db, select(Team).order_by(Team.name), TeamRead)
    matches, match_error = _load_section(
        db, select(Match).order_by(Match.match_date.desc(), Match.id.desc()), MatchRead
    )
    jobs, job_error = _load_section(
        db, select(AnalysisJob).order_by(AnalysisJob.created_at.desc()), AnalysisJobRead
    )

    errors = {
        key: value
        for key, value in {
            "organisations": organisation_error,
            "teams": team_error,
            "matches": match_error,
            "jobs": job_error,
        }.items()
        if value is not None
    }
    return {
        "organisations": organisations,
        "teams": teams,
        "matches": matches,
        "jobs": jobs,
        "errors": errors,
    }
