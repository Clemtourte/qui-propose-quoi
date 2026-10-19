from pathlib import Path

import yaml
from check_content import coverage, load, main, run_checks

REPO_CONTENT = Path(__file__).resolve().parent.parent / "content"


def write(base: Path, rel: str, data: dict) -> None:
    path = base / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")


def minimal_content(base: Path) -> Path:
    write(base, "sources/presse-1.yaml", {"url": "https://example.com/a", "type": "presse"})
    write(base, "sources/exemple-fictive.yaml", {"url": "https://example.org/b", "type": "presse"})
    write(base, "themes/retraites.yaml", {"titre": "Retraites", "ordre": 1, "questions": [{"id": "age"}]})
    write(
        base,
        "candidats/dupont.yaml",
        {"nom": "Dupont", "fiche": "complete", "candidature": {"sources": ["presse-1"]}},
    )
    write(
        base,
        "candidats/exemple.yaml",
        {"nom": "Exemple", "fiche": "complete", "demo": True, "candidature": {"sources": ["exemple-fictive"]}},
    )
    return base


def errors_for(base: Path) -> list[str]:
    return run_checks(load(base)).errors


def test_minimal_content_is_valid(tmp_path):
    assert errors_for(minimal_content(tmp_path)) == []


def test_missing_source_is_an_error(tmp_path):
    base = minimal_content(tmp_path)
    write(
        base,
        "entrees/dupont/m1.yaml",
        {
            "candidat": "dupont",
            "theme": "retraites",
            "rubrique": "mesure",
            "nature": "position",
            "sources": ["absente"],
        },
    )
    assert any("source inexistante « absente »" in e for e in errors_for(base))


def test_judgement_without_author_is_an_error(tmp_path):
    base = minimal_content(tmp_path)
    write(
        base,
        "entrees/dupont/j1.yaml",
        {"candidat": "dupont", "rubrique": "soutien_adversaire", "nature": "jugement", "sources": ["presse-1"]},
    )
    assert any("jugement sans auteur" in e for e in errors_for(base))


def test_fictional_source_in_real_content_is_an_error(tmp_path):
    base = minimal_content(tmp_path)
    write(
        base,
        "entrees/dupont/m2.yaml",
        {"candidat": "dupont", "rubrique": "mesure", "nature": "fait", "sources": ["exemple-fictive"]},
    )
    assert any("source fictive" in e for e in errors_for(base))


def test_excluded_domain_is_an_error(tmp_path):
    base = minimal_content(tmp_path)
    write(base, "sources/mauvaise.yaml", {"url": "https://www.elyseescope.com/x", "type": "presse"})
    assert any("domaine exclu" in e for e in errors_for(base))


def test_unknown_question_in_synthesis_is_an_error(tmp_path):
    base = minimal_content(tmp_path)
    write(
        base,
        "syntheses/dupont/retraites.yaml",
        {"candidat": "dupont", "theme": "retraites", "reponses": {"inconnue": "x"}, "sources": ["presse-1"]},
    )
    assert any("question « inconnue »" in e for e in errors_for(base))


def test_coverage_excludes_demo_candidates(tmp_path):
    table = "\n".join(coverage(load(minimal_content(tmp_path))))
    assert "Dupont" in table
    assert "Exemple" not in table


def test_repository_content_passes():
    assert main(["check_content.py", str(REPO_CONTENT)]) == 0
