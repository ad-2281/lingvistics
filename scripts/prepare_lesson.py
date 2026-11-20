#!/usr/bin/env python3
"""
scripts/prepare_lesson.py

Lesson Content Preparation Script — OLR „Solomon Marcus" Course Platform.

Processes raw HTML lesson & homework files (by default from input_raw_lessons/)
and creates the full input_content/ folder structure required by scripts/ingest_content.py.

Auto-detects file roles:
  • A file containing ANY teacher-only selector (class/id/data-attr) is classified
    as the LESSON (class) file.
  • All other HTML files are classified as HOMEWORK exercise files.

Auto-detects grading mode:
  • If a homework HTML contains self-contained JS grading (homeworkKey, gradeHomework),
    it generates a minimal grading_rules.json with only policy flags (allow_retakes,
    reveal_on_exhausted). No teacher field configuration required!
  • Otherwise, it extracts form field IDs and creates a server-side grading skeleton.

Usage examples
--------------
# Default: automatically processes files from input_raw_lessons/
  python scripts/prepare_lesson.py

# Specify module index (e.g. Module 1, Lesson 2):
  python scripts/prepare_lesson.py --module-index 1 --lesson-index 2

# Process specific files from input_raw_lessons or custom paths:
  python scripts/prepare_lesson.py --files "Lecția 2.html" "Lecția 2 - temă.html"

# Policy flags for self-contained homework:
  python scripts/prepare_lesson.py --allow-retakes --no-reveal-on-exhausted

Options
-------
--raw-dir       Directory containing raw lesson HTML files (default: <repo>/input_raw_lessons).
--files         One or more HTML source file paths. If omitted, takes files from --raw-dir.
--module-index  Integer order index of the module (default: 1 or auto-detected).
--lesson-index  Integer order index of the lesson (default: 1 or auto-detected from filename).
--module-slug   URL-friendly slug for the module (inherited from existing meta or auto-generated).
--module-title  Human-readable module title (inherited from existing meta or auto-generated).
--lesson-slug   URL-friendly slug for the lesson (auto-generated if omitted).
--lesson-title  Human-readable lesson title (extracted from <title> or <h1> if omitted).
--content-dir   Path to input_content/ root (default: <repo>/input_content).
--overwrite     Overwrite existing HTML files and rules in destination folder.
--dry-run       Print what would be created without touching the filesystem.
--allow-retakes Allow the student to submit the homework more than once (default: False).
--no-reveal-on-exhausted  Hide solutions after all attempts are exhausted (default: False/reveal).
"""

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Selectors that mark an HTML file as a LESSON (teacher) file.
# Must stay in sync with ingest_content.py::TEACHER_SELECTORS.
# ---------------------------------------------------------------------------
TEACHER_CONTENT_MARKERS = [
    'data-role="teacher"',
    "data-role='teacher'",
    "data-teacher-only",
    'class="teacher-note"',
    'class="teacher-notes"',
    'class="nota-profesorului"',
    'class="ghid-profesor"',
    'class="teacher-only"',
    'class="barem-profesor"',
    'id="teacher-panel"',
    "data-teacher-panel",
    # Teacher UI buttons
    'data-action="toggle-teacher-mode"',
    'id="btn-teacher-mode"',
    'class="btn-teacher-mode"',
    "toggleTeacher",
    "teacherMode",
    # Also treat the view-switcher label used in the lesson file as a signal
    "Mod Profesor",
    "mode-toggle-btn",
]

# Markers that indicate a homework file contains self-contained JS grading.
# Must stay in sync with ingest_content.py::SELF_CONTAINED_GRADING_MARKERS.
SELF_CONTAINED_GRADING_MARKERS = [
    "homeworkKey",
    "gradeHomework",
    "checkHomework",
    "checkAnswers",
    "autoGrade",
]


def slugify(text: str) -> str:
    """Convert a human-readable string to a URL-friendly slug."""
    text = text.lower().strip()
    # Normalize Romanian diacritics
    for src, dst in [("ă", "a"), ("â", "a"), ("î", "i"), ("ș", "s"), ("ț", "t"),
                     ("Ă", "a"), ("Â", "a"), ("Î", "i"), ("Ș", "s"), ("Ț", "t")]:
        text = text.replace(src, dst)
    text = re.sub(r"[^a-z0-9\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    text = re.sub(r"-+", "-", text)
    return text.strip("-")


def detect_role(html_path: Path) -> str:
    """Return 'lesson' if any teacher marker is found, else 'homework'."""
    content = html_path.read_text(encoding="utf-8", errors="replace")
    for marker in TEACHER_CONTENT_MARKERS:
        if marker in content:
            return "lesson"
    return "homework"


def detect_self_contained_grading(html_path: Path) -> bool:
    """Return True if the HTML contains a self-contained JS grading system."""
    content = html_path.read_text(encoding="utf-8", errors="replace")
    for marker in SELF_CONTAINED_GRADING_MARKERS:
        if marker in content:
            return True
    return False


def extract_title(html_path: Path) -> str:
    """Extract the page title from <title> tag or first <h1>, fallback to filename stem."""
    content = html_path.read_text(encoding="utf-8", errors="replace")
    m = re.search(r"<title[^>]*>(.*?)</title>", content, re.IGNORECASE | re.DOTALL)
    if m:
        return re.sub(r"\s+", " ", m.group(1)).strip()
    m = re.search(r"<h1[^>]*>(.*?)</h1>", content, re.IGNORECASE | re.DOTALL)
    if m:
        return re.sub(r"<[^>]+>", "", m.group(1)).strip()
    return html_path.stem.replace("_", " ").replace("-", " ").title()


def extract_homework_fields(html_path: Path) -> dict:
    """
    Extract all input/select/textarea IDs/names from a homework HTML file and
    return a skeleton grading_rules fields dict.
    """
    content = html_path.read_text(encoding="utf-8", errors="replace")
    pattern = re.compile(
        r'<(?:input|select|textarea)[^>]+>',
        re.IGNORECASE | re.DOTALL,
    )
    key_pattern = re.compile(
        r'(?:id|name|data-question-key)=["\']([^"\']+)["\']',
        re.IGNORECASE,
    )
    fields = {}
    for tag_match in pattern.finditer(content):
        tag = tag_match.group(0)
        for key_match in key_pattern.finditer(tag):
            key = key_match.group(1)
            if key in ("", "submit", "reset"):
                continue
            if key not in fields:
                fields[key] = {
                    "type": "exact_normalized",
                    "accepted": [],
                    "points": 0,
                    "hint": "TODO: add accepted answers and points."
                }
    return fields


def build_grading_rules(
    lesson_slug: str,
    lesson_title: str,
    lesson_order: int,
    homework_files: list,  # [(filename, grading_mode, fields_dict_or_None), ...]
    allow_retakes: bool = False,
    reveal_on_exhausted: bool = True,
) -> dict:
    """Build a grading_rules.json structure for the lesson."""
    exercises = []
    for idx, (filename, grading_mode, fields) in enumerate(homework_files, start=1):
        stem = Path(filename).stem
        ex_slug = f"{lesson_slug}-{stem}" if stem != "homework" else f"{lesson_slug}-tema"

        ex: dict = {
            "slug": ex_slug,
            "title": f"Temă: {lesson_title}",
            "category": "homework",
            "source_file": filename,
            "grading_mode": grading_mode,
            "allow_retakes": allow_retakes,
            "max_attempts": 1,
            "order_index": idx,
            "is_published": True,
        }

        if grading_mode == "client_self_contained":
            ex["reveal_on_exhausted"] = reveal_on_exhausted
            ex["max_score"] = 100
        else:
            ex["max_score"] = 100
            ex["fields"] = fields or {}

        exercises.append(ex)

    return {
        "lesson_slug": lesson_slug,
        "lesson_title": lesson_title,
        "order_index": lesson_order,
        "is_published": True,
        "exercises": exercises,
    }


def zero_pad(n: int) -> str:
    return str(n).zfill(2)


def prepare_lesson(args) -> None:
    # ------------------------------------------------------------------
    # Resolve directories
    # ------------------------------------------------------------------
    repo_root = Path(__file__).resolve().parent.parent

    if args.raw_dir:
        raw_dir = Path(args.raw_dir)
        if not raw_dir.is_absolute():
            raw_dir = Path.cwd() / raw_dir
    else:
        raw_dir = repo_root / "input_raw_lessons"

    if args.content_dir:
        content_dir = Path(args.content_dir)
        if not content_dir.is_absolute():
            content_dir = Path.cwd() / content_dir
    else:
        content_dir = repo_root / "input_content"

    # ------------------------------------------------------------------
    # Resolve source HTML files (from --files or input_raw_lessons)
    # ------------------------------------------------------------------
    if args.files:
        source_files = []
        for f_str in args.files:
            p = Path(f_str)
            if p.exists():
                source_files.append(p)
            elif (raw_dir / f_str).exists():
                source_files.append(raw_dir / f_str)
            else:
                print(f"[ERROR] File not found: {f_str} (checked current dir and {raw_dir})")
                sys.exit(1)
    else:
        # Default: discover files from raw_dir
        if not raw_dir.exists():
            print(f"[ERROR] Raw lessons directory does not exist: {raw_dir}")
            sys.exit(1)

        all_raw_html = sorted(list(raw_dir.glob("*.html")) + list(raw_dir.glob("*.htm")))
        if not all_raw_html:
            # Check immediate subdirectories
            all_raw_html = sorted(list(raw_dir.glob("*/*.html")) + list(raw_dir.glob("*/*.htm")))

        if not all_raw_html:
            print(f"[ERROR] No HTML files found in raw directory: {raw_dir}")
            sys.exit(1)

        # If user explicitly passed --lesson-index, filter for that lesson if multiple files exist
        if args.lesson_index is not None:
            les_str = str(args.lesson_index)
            filtered = [
                f for f in all_raw_html
                if re.search(r'(?:lec[tț]ia|lesson|l)[_\s-]*0*' + les_str + r'(?:[^\d]|$)', f.name, re.IGNORECASE)
                or re.search(r'(?:^|[_\s-])0*' + les_str + r'(?:[_\s-]|$)', f.stem)
            ]
            source_files = filtered if filtered else all_raw_html
        else:
            source_files = all_raw_html

    print(f"[INFO] Using {len(source_files)} source file(s) from: {raw_dir if not args.files else 'command line / raw_dir'}")

    lesson_file: Path | None = None
    homework_files: list[Path] = []

    for f in source_files:
        role = detect_role(f)
        print(f"[DETECT] '{f.name}' → {role.upper()}")
        if role == "lesson":
            if lesson_file is not None:
                print(f"[WARN] Multiple lesson files detected; using first: '{lesson_file.name}'")
                homework_files.append(f)
            else:
                lesson_file = f
        else:
            homework_files.append(f)

    if lesson_file is None:
        print("[WARN] No lesson file detected (no teacher markers found). "
              "First file will be treated as the lesson.")
        lesson_file = source_files[0]
        homework_files = source_files[1:]

    # ------------------------------------------------------------------
    # Derive indices, slugs, titles, and directories
    # ------------------------------------------------------------------
    # Lesson index: CLI arg -> auto-detect from filename -> default 1
    if args.lesson_index is not None:
        les_idx = args.lesson_index
    else:
        detected_les = None
        for f in source_files:
            m = re.search(r'(?:lec[tț]ia|lesson)[_\s-]*0*(\d+)', f.name, re.IGNORECASE)
            if m:
                detected_les = int(m.group(1))
                break
        if detected_les is None:
            for f in source_files:
                m = re.search(r'(\d+)', f.stem)
                if m:
                    detected_les = int(m.group(1))
                    break
        les_idx = detected_les if detected_les is not None else 1

    # Module index: CLI arg -> auto-detect from filename -> default 1
    if args.module_index is not None:
        mod_idx = args.module_index
    else:
        detected_mod = None
        for f in source_files:
            m = re.search(r'(?:modul(?:ul)?|module)[_\s-]*0*(\d+)', f.name, re.IGNORECASE)
            if m:
                detected_mod = int(m.group(1))
                break
        mod_idx = detected_mod if detected_mod is not None else 1

    # Module directory: prefer existing directory name (modulul_01 vs modulul_01_demo)
    if (content_dir / f"modulul_{zero_pad(mod_idx)}").exists():
        mod_dir_name = f"modulul_{zero_pad(mod_idx)}"
    elif (content_dir / f"modulul_{mod_idx}").exists():
        mod_dir_name = f"modulul_{mod_idx}"
    elif (content_dir / f"modulul_{zero_pad(mod_idx)}_demo").exists():
        mod_dir_name = f"modulul_{zero_pad(mod_idx)}_demo"
    else:
        mod_dir_name = f"modulul_{zero_pad(mod_idx)}"

    module_dir = content_dir / mod_dir_name
    meta_file = module_dir / "module_meta.json"

    # Default module slug and title
    module_slug = args.module_slug or f"modulul-{zero_pad(mod_idx)}"
    detected_lesson_title = extract_title(lesson_file)
    clean_title = re.sub(r"^Lecția\s+\d+\s*[:\-—]\s*", "", detected_lesson_title, flags=re.IGNORECASE)
    module_title = args.module_title or f"Modulul {mod_idx}: {clean_title}"

    # If module_meta.json exists, inherit its title and slug unless explicitly provided
    if meta_file.exists():
        try:
            with open(meta_file, "r", encoding="utf-8") as f:
                existing_meta = json.load(f)
            if not args.module_slug and existing_meta.get("slug"):
                module_slug = existing_meta["slug"]
            if not args.module_title and existing_meta.get("title"):
                module_title = existing_meta["title"]
        except Exception:
            pass

    lesson_dir_name = f"lectia_{zero_pad(les_idx)}"
    lesson_dir = module_dir / lesson_dir_name

    lesson_title = args.lesson_title or detected_lesson_title or f"Lecția {les_idx}"
    lesson_slug = args.lesson_slug or f"{module_slug}-lectia-{zero_pad(les_idx)}"

    # ------------------------------------------------------------------
    # Print plan
    # ------------------------------------------------------------------
    print()
    print("=" * 60)
    print("LESSON PREPARATION PLAN")
    print("=" * 60)
    print(f"  Raw files dir       : {raw_dir}")
    print(f"  Module dir          : {module_dir}")
    print(f"  Lesson dir          : {lesson_dir}")
    print(f"  Module index        : {mod_idx}")
    print(f"  Lesson index        : {les_idx}")
    print(f"  Module slug         : {module_slug}")
    print(f"  Module title        : {module_title}")
    print(f"  Lesson slug         : {lesson_slug}")
    print(f"  Lesson title        : {lesson_title}")
    print(f"  Lesson file         : {lesson_file.name} → lesson.html")
    for hw in homework_files:
        print(f"  Homework            : {hw.name} → homework.html" if len(homework_files) == 1
              else f"  Homework            : {hw.name} → {hw.name}")
    print(f"  Allow retakes       : {args.allow_retakes}")
    print(f"  Reveal on exhausted : {args.reveal_on_exhausted}")
    print()

    if args.dry_run:
        print("[DRY-RUN] No files will be written.")
        return

    # ------------------------------------------------------------------
    # Create directories
    # ------------------------------------------------------------------
    lesson_dir.mkdir(parents=True, exist_ok=True)
    print(f"[OK] Directories created: {lesson_dir}")

    # ------------------------------------------------------------------
    # Write / copy HTML files
    # ------------------------------------------------------------------
    dest_lesson = lesson_dir / "lesson.html"
    if dest_lesson.exists() and not args.overwrite:
        print(f"[SKIP] {dest_lesson} already exists (use --overwrite to replace).")
    else:
        shutil.copy2(lesson_file, dest_lesson)
        print(f"[COPY] {lesson_file.name} → {dest_lesson}")

    hw_dest_names: list[str] = []
    for hw_src in homework_files:
        dest_name = "homework.html" if len(homework_files) == 1 else hw_src.name
        dest_hw = lesson_dir / dest_name
        hw_dest_names.append(dest_name)
        if dest_hw.exists() and not args.overwrite:
            print(f"[SKIP] {dest_hw} already exists (use --overwrite to replace).")
        else:
            shutil.copy2(hw_src, dest_hw)
            print(f"[COPY] {hw_src.name} → {dest_hw}")

    # ------------------------------------------------------------------
    # Detect grading mode and build grading_rules.json
    # ------------------------------------------------------------------
    rules_file = lesson_dir / "grading_rules.json"
    if rules_file.exists() and not args.overwrite:
        print(f"[SKIP] {rules_file} already exists (use --overwrite to replace).")
    else:
        hw_triples = []
        for hw_src, dest_name in zip(homework_files, hw_dest_names):
            if detect_self_contained_grading(hw_src):
                grading_mode = "client_self_contained"
                print(f"[SCAN] '{hw_src.name}' → self-contained JS grading detected. No field config needed.")
                hw_triples.append((dest_name, grading_mode, None))
            else:
                grading_mode = "server_side"
                fields = extract_homework_fields(hw_src)
                print(f"[SCAN] '{hw_src.name}' → server-side grading. Extracted {len(fields)} form field(s).")
                hw_triples.append((dest_name, grading_mode, fields))

        if not hw_triples:
            hw_triples = [("homework.html", "server_side", {})]

        rules = build_grading_rules(
            lesson_slug, lesson_title, les_idx, hw_triples,
            allow_retakes=args.allow_retakes,
            reveal_on_exhausted=args.reveal_on_exhausted,
        )
        rules_file.write_text(json.dumps(rules, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[WRITE] {rules_file}")

    # ------------------------------------------------------------------
    # Write module_meta.json (only if not present or explicit override)
    # ------------------------------------------------------------------
    if meta_file.exists() and not (args.overwrite and (args.module_title or args.module_slug)):
        print(f"[SKIP] {meta_file} already exists.")
    else:
        meta = {
            "slug": module_slug,
            "title": module_title,
            "description": "",
            "order_index": mod_idx,
            "is_published": True,
            "is_restricted": False,
        }
        meta_file.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[WRITE] {meta_file}")

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------
    print()
    print("=" * 60)
    print("DONE. Folder structure created:")
    print(f"  {module_dir.relative_to(content_dir.parent)}/")
    print(f"  ├── module_meta.json")
    print(f"  └── {lesson_dir_name}/")
    print(f"      ├── lesson.html")
    for name in hw_dest_names:
        print(f"      ├── {name}")
    print(f"      └── grading_rules.json")
    print()
    print("Next step — validate with:")
    print("  python scripts/ingest_content.py --dry-run")


def main():
    parser = argparse.ArgumentParser(
        description="Prepare input_content/ folder structure for a new lesson.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--raw-dir", default=None, metavar="DIR",
        help="Path to raw lessons directory (default: <repo>/input_raw_lessons).",
    )
    parser.add_argument(
        "--files", nargs="*", default=None, metavar="FILE",
        help="One or more HTML source files (lesson and/or homework). If omitted, processes files from --raw-dir.",
    )
    parser.add_argument("--module-index", type=int, default=None, metavar="N",
                        help="Module order index (default: auto-detected or 1).")
    parser.add_argument("--lesson-index", type=int, default=None, metavar="N",
                        help="Lesson order index within the module (default: auto-detected from filename or 1).")
    parser.add_argument("--module-slug", default=None, metavar="SLUG",
                        help="URL-friendly module slug (inherited from existing meta or auto-generated).")
    parser.add_argument("--module-title", default=None, metavar="TITLE",
                        help="Human-readable module title (inherited from existing meta or auto-generated).")
    parser.add_argument("--lesson-slug", default=None, metavar="SLUG",
                        help="URL-friendly lesson slug (auto-generated if omitted).")
    parser.add_argument("--lesson-title", default=None, metavar="TITLE",
                        help="Human-readable lesson title (extracted from HTML if omitted).")
    parser.add_argument("--content-dir", default=None, metavar="DIR",
                        help="Path to input_content/ root (default: <repo>/input_content).")
    parser.add_argument("--overwrite", action="store_true",
                        help="Overwrite existing files in the destination lesson folder.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print the plan without writing any files.")
    # ── Grading policy flags (teacher-facing, only 2 required for self-contained exercises) ──
    parser.add_argument("--allow-retakes", action="store_true", default=False,
                        help="Allow the student to submit the homework more than once (default: False).")
    parser.add_argument("--reveal-on-exhausted", action="store_true", default=True,
                        help="Show solutions and explanations once all attempts are used (default: True).")
    parser.add_argument("--no-reveal-on-exhausted", dest="reveal_on_exhausted",
                        action="store_false",
                        help="Hide solutions even after all attempts are exhausted.")
    args = parser.parse_args()
    prepare_lesson(args)


if __name__ == "__main__":
    main()
