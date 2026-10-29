"""Editorial checks on content/ that the Astro schemas cannot express.

Errors (exit code 1):
- a reference (source, candidate, theme, institution) points to a missing entry;
- a judgement ("jugement") has no author;
- an excluded source domain is cited (elyseescope.com);
- a fictional "exemple-*" source or record is used by real content;
- a synthesis answers a question its theme does not declare;
- an `absences` entry of a candidate names an unknown theme or source, or contradicts an existing synthesis.

Warnings: unused sources, items backed only by aggregator sources.

Also prints a coverage matrix (candidate x theme) for complete, non-demo candidates.

Usage: uv run python checks/check_content.py [content_dir]
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path

import yaml

EXCLUDED_DOMAINS = ("elyseescope.com",)
DEMO_PREFIX = "exemple"
COLLECTIONS = (
    "sources",
    "candidats",
    "themes",
    "institutions",
    "entrees",
    "syntheses",
    "avis",
    "verifications",
    "justice",
)


@dataclass
class Report:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def error(self, where: str, msg: str) -> None:
        self.errors.append(f"{where}: {msg}")

    def warn(self, where: str, msg: str) -> None:
        self.warnings.append(f"{where}: {msg}")


def load(content_dir: Path) -> dict[str, dict[str, dict]]:
    """Load every YAML entry, keyed by collection then by id (path without extension, like Astro)."""
    data: dict[str, dict[str, dict]] = {}
    for name in COLLECTIONS:
        base = content_dir / name
        entries: dict[str, dict] = {}
        if base.is_dir():
            for path in sorted(base.rglob("*.yaml")):
                entry_id = path.relative_to(base).with_suffix("").as_posix().lower()
                entries[entry_id] = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        data[name] = entries
    return data


def is_demo_id(entry_id: str) -> bool:
    return entry_id.split("/")[-1].startswith(DEMO_PREFIX) or entry_id.startswith(f"{DEMO_PREFIX}/")


def demo_candidates(data: dict) -> set[str]:
    return {cid for cid, c in data["candidats"].items() if c.get("demo")}


def check_sourced(item: dict, where: str, data: dict, report: Report, used: set[str], demo: bool) -> None:
    """Check one block that carries `sources` (and maybe `nature` / `auteur`)."""
    if item.get("nature") == "jugement" and not item.get("auteur"):
        report.error(where, "jugement sans auteur")
    sources = item.get("sources") or []
    if not sources:
        report.error(where, "aucune source")
    for sid in sources:
        used.add(sid)
        src = data["sources"].get(sid)
        if src is None:
            report.error(where, f"source inexistante « {sid} »")
            continue
        if is_demo_id(sid) and not (demo or item.get("demo")):
            report.error(where, f"source fictive « {sid} » utilisée par du contenu réel")
    # Orders of magnitude carry their own sources (data used in the calculation).
    for i, repere in enumerate(item.get("reperes") or []):
        check_sourced(
            {"sources": repere.get("sources")},
            f"{where} (repère {i + 1})",
            data,
            report,
            used,
            demo or bool(item.get("demo")),
        )
    known = [data["sources"][s] for s in sources if s in data["sources"]]
    if known and all(s.get("type") == "agregateur" for s in known):
        report.warn(where, "uniquement des sources de type agrégateur (à confirmer)")


def check_ref(collection: str, ref: str | None, where: str, data: dict, report: Report) -> None:
    if ref is not None and ref not in data[collection]:
        report.error(where, f"{collection} inexistant « {ref} »")


def run_checks(data: dict) -> Report:
    report = Report()
    used: set[str] = set()
    demos = demo_candidates(data)

    for sid, src in data["sources"].items():
        url = str(src.get("url", ""))
        if any(d in url for d in EXCLUDED_DOMAINS):
            report.error(f"sources/{sid}", f"domaine exclu ({url})")

    for cid, c in data["candidats"].items():
        where, demo = f"candidats/{cid}", cid in demos
        check_sourced(c.get("candidature", {}), f"{where} (candidature)", data, report, used, demo)
        if c.get("en_30_secondes"):
            check_sourced(c["en_30_secondes"], f"{where} (en_30_secondes)", data, report, used, demo)
        for i, item in enumerate(c.get("vision") or []):
            check_sourced(item, f"{where} (vision[{i}])", data, report, used, demo)

    for cid, c in data["candidats"].items():
        for tid, absence in (c.get("absences") or {}).items():
            where = f"candidats/{cid} (absences.{tid})"
            if tid not in data["themes"]:
                report.error(where, f"thème inexistant « {tid} »")
            elif any(s.get("candidat") == cid and s.get("theme") == tid for s in data["syntheses"].values()):
                report.error(where, "case déclarée vide alors qu'une synthèse existe")
            for sid in absence.get("sources") or []:
                used.add(sid)
                if sid not in data["sources"]:
                    report.error(where, f"source inexistante « {sid} »")

    for tid, t in data["themes"].items():
        for i, item in enumerate(t.get("etat_des_lieux") or []):
            check_sourced(item, f"themes/{tid} (etat_des_lieux[{i}])", data, report, used, False)

    for name in ("entrees", "syntheses", "verifications", "justice"):
        for eid, e in data[name].items():
            where = f"{name}/{eid}"
            check_ref("candidats", e.get("candidat"), where, data, report)
            check_ref("themes", e.get("theme"), where, data, report)
            check_sourced(e, where, data, report, used, e.get("candidat") in demos)

    for eid, s in data["syntheses"].items():
        theme = data["themes"].get(s.get("theme"), {})
        questions = {q["id"] for q in theme.get("questions") or []}
        for q in s.get("reponses") or {}:
            if q not in questions:
                report.error(f"syntheses/{eid}", f"question « {q} » absente du thème")

    for aid, a in data["avis"].items():
        where = f"avis/{aid}"
        check_ref("institutions", a.get("institution"), where, data, report)
        check_ref("themes", a.get("theme"), where, data, report)
        for cid in a.get("candidats") or []:
            check_ref("candidats", cid, where, data, report)
        all_demo = all(cid in demos for cid in a.get("candidats") or [])
        if is_demo_id(str(a.get("institution", ""))) and not all_demo:
            report.error(where, "institution fictive citée pour un candidat réel")
        check_sourced(a, where, data, report, used, all_demo)

    for sid in sorted(set(data["sources"]) - used):
        report.warn(f"sources/{sid}", "source jamais citée")

    return report


def coverage(data: dict) -> list[str]:
    """Markdown table: for each real complete candidate x theme, synthesis (S) and number of measures."""
    candidats = sorted(
        (cid for cid, c in data["candidats"].items() if c.get("fiche") == "complete" and not c.get("demo")),
        key=lambda cid: data["candidats"][cid].get("nom", cid),
    )
    themes = sorted(data["themes"], key=lambda tid: data["themes"][tid].get("ordre", 0))
    lines = ["| Thème | " + " | ".join(data["candidats"][c]["nom"] for c in candidats) + " |"]
    lines.append("|---" * (len(candidats) + 1) + "|")
    for tid in themes:
        cells = []
        for cid in candidats:
            has_synth = any(s.get("candidat") == cid and s.get("theme") == tid for s in data["syntheses"].values())
            n = sum(
                1
                for e in data["entrees"].values()
                if e.get("candidat") == cid
                and e.get("theme") == tid
                and e.get("rubrique") in ("mesure", "participation")
            )
            # ø = empty cell with a recorded reason (searched, programme awaited), · = nothing recorded.
            absent = tid in (data["candidats"][cid].get("absences") or {})
            cells.append(
                ("S " if has_synth else "") + (str(n) if n else ("" if has_synth else ("ø" if absent else "·")))
            )
        lines.append(f"| {data['themes'][tid].get('titre', tid)} | " + " | ".join(cells) + " |")
    return lines


def main(argv: list[str]) -> int:
    # Windows consoles default to a legacy code page; force UTF-8 for accents.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    content_dir = Path(argv[1]) if len(argv) > 1 else Path(__file__).resolve().parent.parent / "content"
    data = load(content_dir)
    report = run_checks(data)

    print("Couverture (S = synthèse, nombre = mesures, ø = vide avec raison notée, · = rien) :\n")
    print("\n".join(coverage(data)))
    print()
    for w in report.warnings:
        print(f"AVERTISSEMENT  {w}")
    for e in report.errors:
        print(f"ERREUR         {e}")
    print(f"\n{len(report.errors)} erreur(s), {len(report.warnings)} avertissement(s).")
    return 1 if report.errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
