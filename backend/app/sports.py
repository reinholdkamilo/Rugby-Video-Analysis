from dataclasses import dataclass

from app.models import SportType


@dataclass(frozen=True)
class SportRulePack:
    sport_type: SportType
    display_name: str
    taxonomy_id: str
    inference_rule_set_id: str
    report_template_id: str
    auto_analysis_context: str


SPORT_RULE_PACKS: dict[SportType, SportRulePack] = {
    SportType.rugby_union: SportRulePack(
        sport_type=SportType.rugby_union,
        display_name="Rugby Union",
        taxonomy_id="rugby_union_taxonomy_v1",
        inference_rule_set_id="rugby_union_inference_v1",
        report_template_id="rugby_union_report_v1",
        auto_analysis_context="Use Rugby Union terminology: rucks, lineouts, scrums, mauls, restarts, phases, exits and union scoring.",
    ),
    SportType.rugby_league: SportRulePack(
        sport_type=SportType.rugby_league,
        display_name="Rugby League",
        taxonomy_id="rugby_league_taxonomy_v1",
        inference_rule_set_id="rugby_league_inference_stub_v1",
        report_template_id="rugby_league_report_v1",
        auto_analysis_context="Use Rugby League terminology: tackle count, hit-ups, play-the-ball, six-again, set completion, last tackle kicks and league scoring.",
    ),
    SportType.afl: SportRulePack(
        sport_type=SportType.afl,
        display_name="AFL",
        taxonomy_id="afl_taxonomy_v1",
        inference_rule_set_id="afl_inference_stub_v1",
        report_template_id="afl_report_v1",
        auto_analysis_context="Use AFL terminology: disposals, kicks, handballs, marks, contests, inside 50s, stoppages, goals and behinds.",
    ),
}


def normalise_sport_type(value: SportType | str | None) -> SportType:
    if isinstance(value, SportType):
        return value
    try:
        return SportType(value or SportType.rugby_union.value)
    except ValueError:
        return SportType.rugby_union


def sport_rule_pack(value: SportType | str | None) -> SportRulePack:
    return SPORT_RULE_PACKS[normalise_sport_type(value)]
