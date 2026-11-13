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


def sanitize_homework_html(raw_html: str, expected_fields=None):
    """
    Parses homework HTML, removes any client-side solutions or answers,
    extracts scoped CSS/JS, and verifies form controls.
    """
    soup = BeautifulSoup(raw_html, "lxml")

    # Remove any teacher notes or barem
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

    # Extract Scoped Scripts - STRIP client-side answer verification or auto-grading
    scripts = []
    for script_tag in soup.find_all("script"):
        src = script_tag.get("src")
        if src:
            script_tag.decompose()
            continue
        if script_tag.string:
            content = script_tag.string
            # Check if this script contains solution checking arrays or answers
            # Replace checkHomework / checkAnswers / autoGrade functions with client-side delegates
            if re.search(r'(barem|solution|correctAnswers|ansMap|answerKey|checkHomework)', content, re.IGNORECASE):
                # Filter out the grading arrays to avoid DevTools leaks
                sanitized_content = re.sub(
                    r'(const|var|let)\s+(correctAnswers|answers|barem|solutions|baremMap)\s*=[\s\S]*?;',
                    '/* Answer key stripped for server-side evaluation */',
                    content
                )
                scripts.append(sanitized_content.strip())
            else:
                scripts.append(content.strip())
        script_tag.decompose()
    scoped_js = "\n\n".join(scripts).strip()

    # Verify form inputs
    found_keys = set()
    for tag in soup.find_all(["input", "select", "textarea"]):
        key = tag.get("name") or tag.get("data-question-key") or tag.get("id")
        if key:
            found_keys.add(key)

    if expected_fields:
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

    # If homework.html exists but no exercises defined, provide a default definition
    if homework_html_file.exists() and not exercises_list:
        exercises_list.append({
            "slug": f"{lesson_slug}-tema",
            "title": f"Temă: {lesson_title}",
            "category": "homework",
            "source_file": "homework.html",
            "allow_retakes": False,
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

        expected_fields = list(ex.get("fields", {}).keys())
        prompt_html, ex_css, ex_js, _ = sanitize_homework_html(raw_ex_html, expected_fields)

        ex_slug = ex.get("slug", f"{lesson_slug}-{ex.get('category', 'homework')}")
        ex_title = ex.get("title", "Exercițiu")
        ex_category = ex.get("category", "homework")
        allow_retakes = ex.get("allow_retakes", False)
        max_attempts = ex.get("max_attempts", 1)
        max_score = ex.get("max_score", 100.0)
        ex_order = ex.get("order_index", 1)
        ex_published = ex.get("is_published", True)

        grading_rules = {
            "fields": ex.get("fields", {}),
            "solution_explanation_html": ex.get("solution_explanation_html", "")
        }

        print(f"    - Exercise: {ex_title} ({ex_slug}) [{ex_category}]")
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
