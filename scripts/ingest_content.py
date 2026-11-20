#!/usr/bin/env python3
"""
scripts/ingest_content.py

Modular Course Platform - Content Ingestion Pipeline.
Parses lesson and homework HTML files from input_content/, strips teacher notes,
extracts scoped CSS and JS, validates question form keys against grading rules,
and synchronizes modules, lessons, teacher notes, exercises, and grading rules
to Supabase with strict content isolation.
"""

import os
import sys
import json
import re
import argparse
from pathlib import Path
from bs4 import BeautifulSoup
from dotenv import load_dotenv

# Try importing supabase-py
try:
    from supabase import create_client, Client
except ImportError:
    Client = None

# Teacher Note selectors to extract and strip
TEACHER_SELECTORS = [
    '[data-role="teacher"]',
    '[data-teacher-only]',
    '.teacher-note',
    '.teacher-notes',
    '.nota-profesorului',
    '.ghid-profesor',
    '.teacher-only',
    '#teacher-panel',
    '.barem-profesor',
    '[data-teacher-panel]'
]

# Mode-switching buttons or toolbars that toggle teacher notes in raw HTML
TEACHER_UI_SELECTORS = [
    '[data-action="toggle-teacher-mode"]',
    '#btn-teacher-mode',
    '.btn-teacher-mode',
    'button[onclick*="toggleTeacher"]',
    'button[onclick*="teacherMode"]'
]


def sanitize_lesson_html(raw_html: str):
    """
    Parses lesson HTML, strips all teacher notes, extracts scoped CSS and JS,
    and returns (student_html, scoped_css, scoped_js, teacher_notes_html, title).
    """
    soup = BeautifulSoup(raw_html, "lxml")

    # 1. Extract Page Title
    title = ""
    if soup.title and soup.title.string:
        title = soup.title.string.strip()
    elif soup.find("h1"):
        title = soup.find("h1").get_text(strip=True)

    # 2. Extract and Strip Teacher Notes
    teacher_notes = []
    for selector in TEACHER_SELECTORS:
        for element in soup.select(selector):
            teacher_notes.append(str(element))
            element.decompose()

    # Remove teacher UI controls/buttons from student DOM
    for selector in TEACHER_UI_SELECTORS:
        for btn in soup.select(selector):
            btn.decompose()

    teacher_notes_html = "\n".join(teacher_notes).strip()

    # 3. Extract Scoped Styles
    styles = []
    for style_tag in soup.find_all("style"):
        if style_tag.string:
            styles.append(style_tag.string.strip())
        style_tag.decompose()
    scoped_css = "\n\n".join(styles).strip()

    # 4. Extract Scoped Scripts
    # Keep inline scripts (which power show/hide solutions, animations, morphemes)
    # Exclude external scripts (with src)
    scripts = []
    for script_tag in soup.find_all("script"):
        src = script_tag.get("src")
        if src:
            # Leave external scripts or ignore if CDN
            script_tag.decompose()
            continue
        if script_tag.string:
            # Exclude teacher-mode logic from script
            script_content = script_tag.string
            # Filter out functions that manipulate teacher elements
            cleaned_script = re.sub(
                r'function\s+toggleTeacher[^{]*\{[\s\S]*?\}',
                '/* teacher mode removed */',
                script_content
            )
            scripts.append(cleaned_script.strip())
        script_tag.decompose()
    scoped_js = "\n\n".join(scripts).strip()

    # 5. Extract Student HTML
    # Prefer <main> or element with id="lesson-root", fallback to <body> inner contents
    target_container = soup.find(id="lesson-root") or soup.find("main") or soup.body
    if target_container:
        student_html = "".join(str(c) for c in target_container.contents).strip()
    else:
        student_html = str(soup).strip()

    return student_html, scoped_css, scoped_js, teacher_notes_html, title


SELF_CONTAINED_GRADING_MARKERS = [
    "homeworkKey",
    "gradeHomework",
    "checkHomework",
    "checkAnswers",
    "autoGrade",
]

# Platform shim injected into self-contained exercises.
# It wraps gradeHomework() with server-side attempt-limit enforcement.
# The platform runtime replaces the placeholders before serving the page:
#   {{ALLOW_RETAKES}}       → "true" or "false"
#   {{REVEAL_ON_EXHAUSTED}} → "true" or "false"
#   {{ATTEMPTS_USED}}       → integer (current attempt count for this student)
#   {{MAX_ATTEMPTS}}        → integer
PLATFORM_SHIM_JS = """
/* ── Platform Attempt-Control Shim ─────────────────────────────────────
   Injected by ingest_content.py. Do NOT edit manually.
   Runtime values are substituted by the backend before page delivery.
   ──────────────────────────────────────────────────────────────────── */
(function () {
  var _allowRetakes      = {{ALLOW_RETAKES}};
  var _revealOnExhausted = {{REVEAL_ON_EXHAUSTED}};
  var _attemptsUsed      = {{ATTEMPTS_USED}};
  var _maxAttempts       = {{MAX_ATTEMPTS}};

  /* Freeze the original author-supplied grading function. */
  var _originalGrade = window.gradeHomework;

  window.gradeHomework = function () {
    if (_attemptsUsed >= _maxAttempts) {
      /* No more attempts allowed. */
      if (_revealOnExhausted) {
        /* Call the original so solutions are shown, then lock inputs. */
        if (_originalGrade) _originalGrade();
      }
      _lockInputs();
      _hideSubmitButton();
      _showAttemptExhaustedBanner(_revealOnExhausted);
      return;
    }

    /* Attempt is valid — run original grading, then register with server. */
    if (_originalGrade) _originalGrade();
    _attemptsUsed += 1;

    /* Persist attempt to platform (non-blocking). */
    if (window.__platformRecordAttempt) {
      window.__platformRecordAttempt(_attemptsUsed);
    }

    if (!_allowRetakes || _attemptsUsed >= _maxAttempts) {
      _lockInputs();
      _hideSubmitButton();
      if (_attemptsUsed >= _maxAttempts && !_revealOnExhausted) {
        _hideRubric();
      }
    }
  };

  function _lockInputs() {
    document.querySelectorAll('input.hw-input, select, textarea').forEach(function (el) {
      el.disabled = true;
    });
  }

  function _hideSubmitButton() {
    /* Hide any button that calls gradeHomework. */
    document.querySelectorAll('button[onclick*="gradeHomework"], button[onclick*="checkHomework"]')
      .forEach(function (btn) { btn.style.display = 'none'; });
  }

  function _hideRubric() {
    var box = document.getElementById('official-rubric-box');
    if (box) box.classList.add('hidden');
  }

  function _showAttemptExhaustedBanner(solutionsShown) {
    var msg = solutionsShown
      ? '⛔ Ai epuizat toate încercările. Soluțiile sunt afișate mai jos.'
      : '⛔ Ai epuizat toate încercările. Soluțiile nu sunt disponibile pentru această temă.';
    var banner = document.createElement('div');
    banner.style.cssText = 'background:#FEF2F2;border-left:5px solid #DC2626;color:#991B1B;'
      + 'padding:14px 18px;border-radius:8px;margin:16px 0;font-weight:700;font-size:0.95rem;';
    banner.textContent = msg;
    var main = document.querySelector('main') || document.body;
    main.prepend(banner);
  }
})();
/* ── End Platform Shim ───────────────────────────────────────────────── */
"""


def detect_self_contained_grading(raw_html: str) -> bool:
    """Return True if the HTML contains a self-contained JS grading system."""
    for marker in SELF_CONTAINED_GRADING_MARKERS:
        if marker in raw_html:
            return True
    return False


def sanitize_homework_html(raw_html: str, expected_fields=None, grading_mode: str = "server_side"):
    """
    Parses homework HTML, extracts scoped CSS/JS, and verifies form controls.

    grading_mode:
      "server_side"          — strips client-side answer keys; server evaluates fields.
      "client_self_contained"— preserves the full JS grading logic intact and injects
                               the platform attempt-control shim around gradeHomework().
    """
    soup = BeautifulSoup(raw_html, "lxml")

    # Remove any teacher notes / UI controls (applies to all modes)
    for selector in TEACHER_SELECTORS + TEACHER_UI_SELECTORS:
        for elem in soup.select(selector):
            elem.decompose()

    # Extract Scoped Styles
    styles = []
    for style_tag in soup.find_all("style"):
        if style_tag.string:
            styles.append(style_tag.string.strip())
        style_tag.decompose()
    scoped_css = "\n\n".join(styles).strip()

    # Extract Scoped Scripts
    scripts = []
    for script_tag in soup.find_all("script"):
        src = script_tag.get("src")
        if src:
            script_tag.decompose()
            continue
        if script_tag.string:
            content = script_tag.string

            if grading_mode == "client_self_contained":
                # Preserve the full JS grading logic unchanged.
                scripts.append(content.strip())
            else:
                # server_side: strip answer keys to prevent DevTools leaks.
                if re.search(r'(barem|solution|correctAnswers|ansMap|answerKey|checkHomework|homeworkKey)', content, re.IGNORECASE):
                    sanitized_content = re.sub(
                        r'(const|var|let)\s+(correctAnswers|answers|barem|solutions|baremMap|homeworkKey)\s*=[\s\S]*?;',
                        '/* Answer key stripped for server-side evaluation */',
                        content
                    )
                    scripts.append(sanitized_content.strip())
                else:
                    scripts.append(content.strip())
        script_tag.decompose()

    if grading_mode == "client_self_contained":
        # Append the platform attempt-control shim AFTER the author's script.
        scripts.append(PLATFORM_SHIM_JS.strip())

    scoped_js = "\n\n".join(scripts).strip()

    # Verify form inputs (informational in self-contained mode)
    found_keys = set()
    for tag in soup.find_all(["input", "select", "textarea"]):
        key = tag.get("name") or tag.get("data-question-key") or tag.get("id")
        if key:
            found_keys.add(key)

    if grading_mode == "client_self_contained":
        print(f"  [INFO] Self-contained grading mode: {len(found_keys)} form field(s) detected (no server fields config required).")
    elif expected_fields:
        missing = set(expected_fields) - found_keys
        if missing:
            print(f"  [WARN] Form controls missing for expected grading fields: {list(missing)}")
        else:
            print(f"  [OK] All {len(expected_fields)} expected grading field controls matched.")

    # Extract Prompt HTML
    container = soup.find(id="homework-root") or soup.find("main") or soup.body
    if container:
        prompt_html = "".join(str(c) for c in container.contents).strip()
    else:
        prompt_html = str(soup).strip()

    return prompt_html, scoped_css, scoped_js, list(found_keys)


def process_module(module_dir: Path, supabase_client, dry_run=False):
    """
    Processes one module directory containing module_meta.json and lesson subdirectories.
    """
    meta_file = module_dir / "module_meta.json"
    if not meta_file.exists():
        print(f"Skipping {module_dir}: module_meta.json not found.")
        return

    with open(meta_file, "r", encoding="utf-8") as f:
        module_meta = json.load(f)

    module_slug = module_meta.get("slug", module_dir.name)
    module_title = module_meta.get("title", module_dir.name.replace("_", " ").title())
    module_desc = module_meta.get("description", "")
    module_order = module_meta.get("order_index", 1)
    module_pub = module_meta.get("is_published", True)
    module_restr = module_meta.get("is_restricted", False)

    print(f"\n=======================================================")
    print(f"Processing Module: {module_title} ({module_slug})")
    print(f"=======================================================")

    module_id = None
    if not dry_run and supabase_client:
        mod_res = supabase_client.table("modules").upsert({
            "slug": module_slug,
            "title": module_title,
            "description": module_desc,
            "order_index": module_order,
            "is_published": module_pub,
            "is_restricted": module_restr
        }, on_conflict="slug").execute()

        if mod_res.data:
            module_id = mod_res.data[0]["id"]
            print(f"[Supabase] Module synced: {module_id}")
    else:
        print(f"[Dry-Run] Would upsert module: {module_slug}")

    # Process lesson subdirectories
    lesson_dirs = [d for d in module_dir.iterdir() if d.is_dir()]
    lesson_dirs.sort(key=lambda d: d.name)

    for ldir in lesson_dirs:
        process_lesson(ldir, module_id, module_slug, supabase_client, dry_run=dry_run)


def process_lesson(lesson_dir: Path, module_id: str, module_slug: str, supabase_client, dry_run=False):
    """
    Processes a lesson folder: lesson.html, homework.html, grading_rules.json.
    """
    lesson_html_file = lesson_dir / "lesson.html"
    homework_html_file = lesson_dir / "homework.html"
    rules_file = lesson_dir / "grading_rules.json"

    if not lesson_html_file.exists():
        print(f"  [SKIP] {lesson_dir.name}: lesson.html not found.")
        return

    print(f"\n  --- Lesson: {lesson_dir.name} ---")

    # Load grading_rules if present
    rules_data = {}
    if rules_file.exists():
        with open(rules_file, "r", encoding="utf-8") as f:
            rules_data = json.load(f)

    # Sanitize Lesson HTML
    with open(lesson_html_file, "r", encoding="utf-8") as f:
        raw_lesson_html = f.read()

    student_html, scoped_css, scoped_js, teacher_notes_html, detected_title = sanitize_lesson_html(raw_lesson_html)

    lesson_slug = rules_data.get("lesson_slug", f"{module_slug}-{lesson_dir.name}")
    lesson_title = rules_data.get("lesson_title") or detected_title or lesson_dir.name.replace("_", " ").title()
    order_index = rules_data.get("order_index", 1)
    is_published = rules_data.get("is_published", True)
    is_restricted = rules_data.get("is_restricted", False)

    print(f"  Title: {lesson_title} (slug: {lesson_slug})")
    print(f"  Sanitized Student HTML length: {len(student_html)} chars")
    print(f"  Extracted Scoped CSS length: {len(scoped_css)} chars")
    print(f"  Extracted Scoped JS length: {len(scoped_js)} chars")
    print(f"  Extracted Teacher Notes length: {len(teacher_notes_html)} chars")

    lesson_id = None
    if not dry_run and supabase_client:
        les_res = supabase_client.table("lessons").upsert({
            "module_id": module_id,
            "slug": lesson_slug,
            "title": lesson_title,
            "order_index": order_index,
            "student_html": student_html,
            "scoped_css": scoped_css,
            "scoped_js": scoped_js,
            "is_published": is_published,
            "is_restricted": is_restricted
        }, on_conflict="slug").execute()

        if les_res.data:
            lesson_id = les_res.data[0]["id"]
            print(f"  [Supabase] Lesson synced: {lesson_id}")

            # Upsert Teacher Notes in isolated table
            if teacher_notes_html:
                supabase_client.table("lesson_teacher_notes").upsert({
                    "lesson_id": lesson_id,
                    "teacher_notes_html": teacher_notes_html
                }, on_conflict="lesson_id").execute()
                print(f"  [Supabase] Teacher notes saved to isolated table.")
    else:
        print(f"  [Dry-Run] Would upsert lesson: {lesson_slug} (Title: {lesson_title})")

    # Process Exercises
    exercises_list = rules_data.get("exercises", [])

    # If homework.html exists but no exercises defined, auto-detect grading mode
    if homework_html_file.exists() and not exercises_list:
        with open(homework_html_file, "r", encoding="utf-8") as _f:
            _hw_content = _f.read()
        _auto_mode = "client_self_contained" if detect_self_contained_grading(_hw_content) else "server_side"
        exercises_list.append({
            "slug": f"{lesson_slug}-tema",
            "title": f"Temă: {lesson_title}",
            "category": "homework",
            "source_file": "homework.html",
            "grading_mode": _auto_mode,
            "allow_retakes": False,
            "reveal_on_exhausted": True,
            "max_attempts": 1,
            "max_score": 100.0,
            "fields": {}
        })

    for ex in exercises_list:
        source_filename = ex.get("source_file", "homework.html")
        source_path = lesson_dir / source_filename
        if not source_path.exists():
            print(f"  [WARN] Exercise source file {source_filename} not found.")
            continue

        with open(source_path, "r", encoding="utf-8") as f:
            raw_ex_html = f.read()

        # Resolve grading mode: explicit config wins; fall back to auto-detection
        grading_mode = ex.get("grading_mode")
        if not grading_mode:
            grading_mode = "client_self_contained" if detect_self_contained_grading(raw_ex_html) else "server_side"

        expected_fields = list(ex.get("fields", {}).keys()) if grading_mode == "server_side" else None
        prompt_html, ex_css, ex_js, found_keys = sanitize_homework_html(
            raw_ex_html, expected_fields, grading_mode=grading_mode
        )

        ex_slug = ex.get("slug", f"{lesson_slug}-{ex.get('category', 'homework')}")
        ex_title = ex.get("title", "Exercițiu")
        ex_category = ex.get("category", "homework")
        allow_retakes = ex.get("allow_retakes", False)
        reveal_on_exhausted = ex.get("reveal_on_exhausted", True)
        max_attempts = ex.get("max_attempts", 1)
        max_score = ex.get("max_score", 100.0)
        ex_order = ex.get("order_index", 1)
        ex_published = ex.get("is_published", True)

        if grading_mode == "client_self_contained":
            grading_rules = {
                "grading_mode": "client_self_contained",
                "allow_retakes": allow_retakes,
                "reveal_on_exhausted": reveal_on_exhausted,
                "max_attempts": max_attempts,
                "field_count": len(found_keys),
            }
            print(f"    - Exercise: {ex_title} ({ex_slug}) [{ex_category}] [client_self_contained]")
            print(f"      Form fields detected: {len(found_keys)}, Retakes: {allow_retakes} (max {max_attempts}), Reveal on exhausted: {reveal_on_exhausted}")
        else:
            grading_rules = {
                "grading_mode": "server_side",
                "fields": ex.get("fields", {}),
                "solution_explanation_html": ex.get("solution_explanation_html", "")
            }
            print(f"    - Exercise: {ex_title} ({ex_slug}) [{ex_category}] [server_side]")
            print(f"      Fields configured: {len(grading_rules['fields'])}, Retakes: {allow_retakes} (max {max_attempts})")

        if not dry_run and supabase_client and lesson_id:
            ex_res = supabase_client.table("exercises").upsert({
                "lesson_id": lesson_id,
                "slug": ex_slug,
                "title": ex_title,
                "order_index": ex_order,
                "category": ex_category,
                "prompt_html": prompt_html,
                "scoped_css": ex_css,
                "scoped_js": ex_js,
                "allow_retakes": allow_retakes,
                "max_attempts": max_attempts,
                "max_score": max_score,
                "is_published": ex_published
            }, on_conflict="slug").execute()

            if ex_res.data:
                exercise_id = ex_res.data[0]["id"]
                print(f"      [Supabase] Exercise synced: {exercise_id}")

                # Sync grading rules to isolated table
                supabase_client.table("exercise_grading_rules").upsert({
                    "exercise_id": exercise_id,
                    "rules_json": grading_rules,
                    "solution_explanation_html": ex.get("solution_explanation_html", "")
                }, on_conflict="exercise_id").execute()
                print(f"      [Supabase] Grading rules synced securely.")
        else:
            print(f"      [Dry-Run] Would upsert exercise: {ex_slug}")


def main():
    parser = argparse.ArgumentParser(description="Ingest modular course HTML content to Supabase.")
    parser.add_argument("--content-dir", default=None, help="Path to input_content directory")
    parser.add_argument("--dry-run", action="store_true", help="Parse and validate without updating Supabase")
    parser.add_argument("--allow-missing", action="store_true", help="Exit 0 instead of failing if content-dir does not exist")
    args = parser.parse_args()

    # Load environment variables
    load_dotenv()

    # Determine paths
    repo_root = Path(__file__).resolve().parent.parent
    if args.content_dir:
        content_dir = Path(args.content_dir)
    else:
        content_dir = repo_root / "input_content"

    if not content_dir.exists():
        if args.allow_missing:
            print(f"Notice: Content directory not present ({content_dir}); skipping ingestion.")
            sys.exit(0)
        print(f"Error: Content directory does not exist: {content_dir}")
        sys.exit(1)

    print(f"Content Ingestion Pipeline")
    print(f"Root: {repo_root}")
    print(f"Input Directory: {content_dir}")
    print(f"Dry Run Mode: {args.dry_run}")

    supabase_client = None
    if not args.dry_run:
        supabase_url = os.getenv("SUPABASE_URL")
        supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

        if not supabase_url or not supabase_key:
            print("\n[WARNING] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set.")
            print("Running in dry-run mode to validate HTML and rules syntax.")
            args.dry_run = True
        else:
            if Client is None:
                print("Error: supabase-py package not installed. Run: pip install -r scripts/requirements.txt")
                sys.exit(1)
            supabase_client = create_client(supabase_url, supabase_key)
            print("Connected to Supabase successfully.")

    # Find all module directories
    module_dirs = [d for d in content_dir.iterdir() if d.is_dir()]
    module_dirs.sort(key=lambda d: d.name)

    if not module_dirs:
        print(f"No module directories found in {content_dir}.")
        return

    for m_dir in module_dirs:
        # Check if directory contains module_meta.json
        if (m_dir / "module_meta.json").exists():
            process_module(m_dir, supabase_client, dry_run=args.dry_run)
        else:
            print(f"Notice: {m_dir.name} has no module_meta.json, checking subdirectories...")

    print("\nIngestion pipeline complete.")


if __name__ == "__main__":
    main()
