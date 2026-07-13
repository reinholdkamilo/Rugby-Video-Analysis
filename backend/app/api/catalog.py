from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Competition, Match, MatchContext, Organisation, Player, Season, Team
from app.schemas import (
    CompetitionCreate,
    CompetitionRead,
    MatchContextRead,
    MatchContextUpsert,
    PlayerCreate,
    PlayerRead,
    SeasonCreate,
    SeasonRead,
)

router = APIRouter(prefix="/api/catalog", tags=["catalog"])


def _organisation_or_404(db: Session, organisation_id: int) -> Organisation:
    organisation = db.get(Organisation, organisation_id)
    if organisation is None:
        raise HTTPException(status_code=404, detail="Organisation not found.")
    return organisation


@router.get("/bootstrap")
def bootstrap_catalog(organisation_id: int, db: Session = Depends(get_db)) -> dict:
    _organisation_or_404(db, organisation_id)
    seasons = list(
        db.scalars(
            select(Season)
            .where(Season.organisation_id == organisation_id)
            .order_by(Season.is_active.desc(), Season.start_date.desc(), Season.name)
        )
    )
    competitions = list(
        db.scalars(
            select(Competition)
            .where(Competition.organisation_id == organisation_id)
            .order_by(Competition.name)
        )
    )
    players = list(
        db.scalars(
            select(Player)
            .where(Player.organisation_id == organisation_id)
            .order_by(Player.is_active.desc(), Player.last_name, Player.first_name)
        )
    )
    return {
        "seasons": [SeasonRead.model_validate(item).model_dump(mode="json") for item in seasons],
        "competitions": [CompetitionRead.model_validate(item).model_dump(mode="json") for item in competitions],
        "players": [PlayerRead.model_validate(item).model_dump(mode="json") for item in players],
    }


@router.post("/seasons", response_model=SeasonRead, status_code=status.HTTP_201_CREATED)
def create_season(payload: SeasonCreate, db: Session = Depends(get_db)) -> Season:
    _organisation_or_404(db, payload.organisation_id)
    season = Season(**payload.model_dump())
    db.add(season)
    db.commit()
    db.refresh(season)
    return season


@router.get("/seasons", response_model=list[SeasonRead])
def list_seasons(organisation_id: int, db: Session = Depends(get_db)) -> list[Season]:
    _organisation_or_404(db, organisation_id)
    return list(
        db.scalars(
            select(Season)
            .where(Season.organisation_id == organisation_id)
            .order_by(Season.is_active.desc(), Season.start_date.desc(), Season.name)
        )
    )


@router.post("/competitions", response_model=CompetitionRead, status_code=status.HTTP_201_CREATED)
def create_competition(payload: CompetitionCreate, db: Session = Depends(get_db)) -> Competition:
    _organisation_or_404(db, payload.organisation_id)
    if payload.season_id is not None:
        season = db.get(Season, payload.season_id)
        if season is None or season.organisation_id != payload.organisation_id:
            raise HTTPException(status_code=422, detail="Season does not belong to the selected organisation.")
    competition = Competition(**payload.model_dump())
    db.add(competition)
    db.commit()
    db.refresh(competition)
    return competition


@router.get("/competitions", response_model=list[CompetitionRead])
def list_competitions(organisation_id: int, db: Session = Depends(get_db)) -> list[Competition]:
    _organisation_or_404(db, organisation_id)
    return list(
        db.scalars(
            select(Competition)
            .where(Competition.organisation_id == organisation_id)
            .order_by(Competition.name)
        )
    )


@router.post("/players", response_model=PlayerRead, status_code=status.HTTP_201_CREATED)
def create_player(payload: PlayerCreate, db: Session = Depends(get_db)) -> Player:
    _organisation_or_404(db, payload.organisation_id)
    if payload.team_id is not None:
        team = db.get(Team, payload.team_id)
        if team is None or team.organisation_id != payload.organisation_id:
            raise HTTPException(status_code=422, detail="Team does not belong to the selected organisation.")
    player = Player(**payload.model_dump())
    db.add(player)
    db.commit()
    db.refresh(player)
    return player


@router.get("/players", response_model=list[PlayerRead])
def list_players(
    organisation_id: int,
    team_id: int | None = None,
    active_only: bool = True,
    db: Session = Depends(get_db),
) -> list[Player]:
    _organisation_or_404(db, organisation_id)
    statement = select(Player).where(Player.organisation_id == organisation_id)
    if team_id is not None:
        statement = statement.where(Player.team_id == team_id)
    if active_only:
        statement = statement.where(Player.is_active.is_(True))
    return list(db.scalars(statement.order_by(Player.last_name, Player.first_name)))


@router.put("/matches/{match_id}/context", response_model=MatchContextRead)
def upsert_match_context(
    match_id: int,
    payload: MatchContextUpsert,
    db: Session = Depends(get_db),
) -> MatchContext:
    match = db.get(Match, match_id)
    if match is None:
        raise HTTPException(status_code=404, detail="Match not found.")

    if payload.season_id is not None:
        season = db.get(Season, payload.season_id)
        if season is None or season.organisation_id != match.organisation_id:
            raise HTTPException(status_code=422, detail="Season does not belong to the match organisation.")

    if payload.competition_id is not None:
        competition = db.get(Competition, payload.competition_id)
        if competition is None or competition.organisation_id != match.organisation_id:
            raise HTTPException(status_code=422, detail="Competition does not belong to the match organisation.")
        if payload.season_id is not None and competition.season_id not in {None, payload.season_id}:
            raise HTTPException(status_code=422, detail="Competition belongs to a different season.")

    context = db.scalar(select(MatchContext).where(MatchContext.match_id == match_id))
    if context is None:
        context = MatchContext(match_id=match_id)
        db.add(context)

    for field, value in payload.model_dump().items():
        setattr(context, field, value)

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Match context could not be saved.") from exc
    db.refresh(context)
    return context


@router.get("/matches/{match_id}/context", response_model=MatchContextRead)
def get_match_context(match_id: int, db: Session = Depends(get_db)) -> MatchContext:
    if db.get(Match, match_id) is None:
        raise HTTPException(status_code=404, detail="Match not found.")
    context = db.scalar(select(MatchContext).where(MatchContext.match_id == match_id))
    if context is None:
        raise HTTPException(status_code=404, detail="Match context not found.")
    return context
