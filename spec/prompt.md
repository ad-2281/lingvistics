# ANTIGRAVITY MASTER PROMPT: Modular Course Platform with HTML Lesson Ingestion, Role Sanitization, and Automated Grading

## 1. ROLE & OBJECTIVE
You are a Principal Full-Stack Architect and DevOps Engineer. Build a complete, production-ready, zero-cost ($0/month) web platform using **Vanilla HTML5, Tailwind CSS, and JavaScript (ES Modules)** hosted on **GitHub Pages**, backed by **Supabase (PostgreSQL, Auth, Row-Level Security, and PL/pgSQL RPC functions)** and a **Python HTML ingestion pipeline**.

### CRITICAL ARCHITECTURAL CONSTRAINTS
1. **Zero Synthetic Course Content:**
   - Do not generate placeholder or synthetic course lessons. The platform ingests pre-existing standalone HTML files representing **lessons** and **homework assignments** grouped into **modules** from a local `input_content/` directory.
2. **Strict Content Isolation (Teacher vs. Student):**
   - Each input lesson HTML file contains:
     a) **Teacher Notes** (pedagogical guidance, timing, facilitation tips, and grading commentary).
     b) **Visual Examples & Interactive Mechanisms** (diagrams, morpheme splitters, step-by-step animations, and interactive show/hide solution buttons).
   - **Students cannot see Teacher Notes.** Teacher notes must be stripped from the student HTML during ingestion and stored in a separate database table protected by Row-Level Security (RLS), never hidden merely with CSS.
   - **Students must be able to view and interact with** all visual examples, interactive discovery widgets, and show/hide solution buttons inside the lesson view.
3. **Separate Homework Section with Automated Server-Side Grading:**
   - Each lesson/module has a dedicated **Homework** section where hints and solution toggles are absent.
   - Grading executes 100% server-side via a PostgreSQL `SECURITY DEFINER` RPC function so answer keys are never exposed to the client browser.
   - **Configurable Retakes:** Teachers can configure per exercise whether students are allowed to retake the assignment (`allow_retakes: boolean` and `max_attempts: integer`).
   - **Scores & Evidence Storage:** Every submission stores the student's raw inputs (`answers_json`), per-question grading breakdown (`evidence_json`), automated score, manual override score, attempt number, and timestamp for teacher inspection.
4. **Self-Registration with Configurable Admin/Teacher Validation Gate:**
   - Students can self-register via email and password.
   - A global configuration flag (`require_admin_validation` in `public.app_config`) controls whether new registrations require manual validation by a Teacher/Admin (`status = 'pending'`) or are auto-approved (`status = 'approved'`).
   - Without validation (`status != 'approved'`), an unauthenticated or pending user cannot access or query any modules, lessons, or exercises on the website (except the login/registration screen and the "Pending Validation" screen).
5. **No Self-Role Switching:**
   - Users cannot switch their own role (`student`, `teacher`, `admin`). Only an `admin` can modify user roles in the database or use a client-side "Preview as Student/Teacher" UI mode.

---

## 2. TARGET REPOSITORY STRUCTURE
Scaffold the repository with the following exact directory structure:

~~~text
.
├── .github/
│   └── workflows/
│       ├── deploy.yml                  # CI/CD: DB migrations, HTML ingestion, GitHub Pages deploy
│       └── supabase-keepalive.yml      # Cron job every 5 days so free-tier DB never pauses
├── input_content/                      # Drop-in folder for existing HTML files grouped by module
│   ├── README.md                       # Instructions and manifest schema documentation
│   └── modulul_01_demo/                # Minimal schema verification fixture
│       ├── module_meta.json
│       └── lectia_01/
│           ├── lesson.html
│           ├── homework.html
│           └── grading_rules.json
├── scripts/
│   ├── requirements.txt                # beautifulsoup4, supabase, python-dotenv, lxml
│   └── ingest_content.py               # Parses lesson/homework HTML, strips teacher notes, syncs to Supabase
├── supabase/
│   ├── config.toml                     # Declarative Supabase CLI configuration
│   └── migrations/
│       └── 20261113000000_init.sql     # Complete schema, triggers, RLS policies, and grading RPCs
├── public/                             # Static frontend deployed to GitHub Pages
│   ├── index.html                      # Single-entry shell with Auth Gate, Student App, Teacher/Admin App
│   ├── css/
│   │   └── styles.css                  # Custom styles and isolated container rules for ingested HTML
│   └── js/
│       ├── config.js                   # Supabase URL & Anon Key loader
│       ├── supabaseClient.js           # Initialized Supabase client singleton
│       ├── auth.js                     # Login, Self-Registration, Pending Screen, Session Guard
│       ├── app.js                      # Main router & role-based view controller
│       ├── lessonRunner.js             # Hydrates ingested lesson HTML + interactive scripts safely
│       ├── homeworkRunner.js           # Renders homework forms, enforces retake limits, calls grading RPC
│       ├── teacherDashboard.js         # Module/Lesson publishing, retake toggles, Evidence Inspector, User Approval
│       └── adminConfig.js              # Global validation flag toggle & role management
├── .env.example
├── package.json                        # Local development scripts
└── README.md                           # End-to-end setup and deployment guide
~~~

---

## 3. DATABASE ARCHITECTURE & SQL MIGRATION (`supabase/migrations/20261113000000_init.sql`)

Write the complete, idempotent PostgreSQL migration implementing the following schema, functions, triggers, and RLS policies:

### 3.1 Extensions & Custom Enums
- Enable `pgcrypto` and `fuzzystrmatch` (used for Levenshtein distance partial-credit evaluation).
- Define enums:
  - `user_role AS ENUM ('student', 'teacher', 'admin')`
  - `account_status AS ENUM ('pending', 'approved', 'rejected')`
  - `exercise_category AS ENUM ('class_practice', 'homework')`

### 3.2 Tables
1. **`public.app_config`** (Single-row configuration table constrained by `id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1)`):
   - `require_admin_validation BOOLEAN NOT NULL DEFAULT true`
   - `bootstrap_admin_email TEXT`
   - `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`
   - Insert default row: `INSERT INTO public.app_config (id, require_admin_validation) VALUES (1, true) ON CONFLICT (id) DO NOTHING;`

2. **`public.profiles`**:
   - `id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE`
   - `email TEXT NOT NULL`
   - `full_name TEXT NOT NULL`
   - `class_group TEXT` (e.g., `'7A'`, `'8B'`)
   - `role user_role NOT NULL DEFAULT 'student'`
   - `status account_status NOT NULL DEFAULT 'pending'`
   - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`

3. **`public.modules`**:
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
   - `slug TEXT UNIQUE NOT NULL` (e.g., `'modulul-01'`)
   - `title TEXT NOT NULL`
   - `description TEXT`
   - `order_index INT NOT NULL DEFAULT 1`
   - `is_published BOOLEAN NOT NULL DEFAULT false`
   - `is_restricted BOOLEAN NOT NULL DEFAULT false`
   - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`

4. **`public.lessons`**:
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
   - `module_id UUID NOT NULL REFERENCES public.modules(id) ON DELETE CASCADE`
   - `slug TEXT UNIQUE NOT NULL` (e.g., `'modulul-01-lectia-01'`)
   - `title TEXT NOT NULL`
   - `order_index INT NOT NULL DEFAULT 1`
   - `student_html TEXT NOT NULL` (Sanitized lesson HTML containing theory, visual examples, interactive widgets, and show/hide solution buttons—with all teacher notes removed)
   - `scoped_css TEXT DEFAULT ''` (Extracted `<style>` blocks from the lesson HTML)
   - `scoped_js TEXT DEFAULT ''` (Extracted `<script>` blocks from the lesson HTML so interactive mechanisms and show/hide buttons execute natively)
   - `is_published BOOLEAN NOT NULL DEFAULT false`
   - `is_restricted BOOLEAN NOT NULL DEFAULT false`
   - `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`

5. **`public.lesson_teacher_notes`** (Strictly isolated table so students cannot query teacher notes):
   - `lesson_id UUID PRIMARY KEY REFERENCES public.lessons(id) ON DELETE CASCADE`
   - `teacher_notes_html TEXT NOT NULL` (Extracted teacher notes, facilitation tips, and barem commentary)
   - `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`

6. **`public.exercises`**:
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
   - `lesson_id UUID NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE`
   - `slug TEXT UNIQUE NOT NULL`
   - `title TEXT NOT NULL`
   - `order_index INT NOT NULL DEFAULT 1`
   - `category exercise_category NOT NULL DEFAULT 'homework'` (`'class_practice'` or `'homework'`)
   - `prompt_html TEXT NOT NULL` (Problem statements and form inputs with `name` or `data-question-key` attributes)
   - `scoped_css TEXT DEFAULT ''`
   - `scoped_js TEXT DEFAULT ''`
   - `allow_retakes BOOLEAN NOT NULL DEFAULT false` (Configurable by teacher)
   - `max_attempts INT NOT NULL DEFAULT 1` (Configurable by teacher; `0` means unlimited attempts when `allow_retakes = true`)
   - `max_score NUMERIC(6,2) NOT NULL DEFAULT 100.00`
   - `is_published BOOLEAN NOT NULL DEFAULT true`

7. **`public.exercise_grading_rules`** (Accessible only to `teacher`/`admin` and the server-side grading RPC):
   - `exercise_id UUID PRIMARY KEY REFERENCES public.exercises(id) ON DELETE CASCADE`
   - `rules_json JSONB NOT NULL` (Defines per-field evaluation rules, point weights, and class-practice hints)
   - `solution_explanation_html TEXT DEFAULT ''`

8. **`public.submissions`** (Stores student scores and complete evidence for teacher review):
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
   - `user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE`
   - `exercise_id UUID NOT NULL REFERENCES public.exercises(id) ON DELETE CASCADE`
   - `attempt_number INT NOT NULL DEFAULT 1`
   - `answers_json JSONB NOT NULL` (Raw key-value map of all inputs submitted by the student)
   - `evidence_json JSONB NOT NULL` (Per-field grading audit trail: student input, rule type applied, points awarded, max points, correctness flag, and review status)
   - `auto_score NUMERIC(6,2) NOT NULL DEFAULT 0`
   - `manual_override_score NUMERIC(6,2)` (Nullable; set by teacher when grading open-ended explanations)
   - `final_score NUMERIC(6,2) GENERATED ALWAYS AS (COALESCE(manual_override_score, auto_score)) STORED`
   - `teacher_feedback TEXT`
   - `submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()`

### 3.3 Security Helper Functions & Self-Registration Trigger
Implement `SECURITY DEFINER` functions with `SET search_path = public`:
- `public.is_approved_user() RETURNS BOOLEAN`: Returns `true` only if `auth.uid()` exists in `public.profiles` with `status = 'approved'`.
- `public.get_user_role() RETURNS user_role`: Returns the `role` of `auth.uid()`.
- `public.is_teacher_or_admin() RETURNS BOOLEAN`: Returns `true` if `status = 'approved'` AND `role IN ('teacher', 'admin')`.

**Trigger `on_auth_user_created` on `auth.users`:**
- Reads `require_admin_validation` and `bootstrap_admin_email` from `public.app_config WHERE id = 1`.
- Extracts `full_name` and `class_group` from `NEW.raw_user_meta_data`.
- If `NEW.email = bootstrap_admin_email`, inserts into `public.profiles` with `role = 'admin'` and `status = 'approved'`.
- Else if `require_admin_validation = false`, inserts with `role = 'student'` and `status = 'approved'`.
- Else (`require_admin_validation = true`), inserts with `role = 'student'` and `status = 'pending'`.

**Trigger `protect_profile_columns` on `public.profiles` (`BEFORE UPDATE`):**
- Prevents any non-admin/non-teacher from modifying `role` or `status`.
- Prevents a `teacher` from elevating anyone's `role` to `'admin'` or `'teacher'` (teachers can only update `status` to `'approved'` or `'rejected'` for students; only `'admin'` can change `role`).

### 3.4 Row-Level Security (RLS) Policies
Enable RLS on all 8 tables:
- **`app_config`**:
  - `SELECT`: Allowed for `anon` and `authenticated` so the registration screen knows whether `require_admin_validation` is active.
  - `UPDATE`: Allowed only when `public.get_user_role() = 'admin'`.
- **`profiles`**:
  - `SELECT`: Users can read their own row (`id = auth.uid()`); Teachers and Admins (`public.is_teacher_or_admin()`) can read all rows.
  - `UPDATE`: Users can update their own `full_name`/`class_group` (with `role` and `status` locked by trigger); Teachers/Admins can update student `status`; Admins can update any `role` or `status`.
- **`modules`, `lessons`, `exercises`**:
  - `SELECT` for Students: Allowed ONLY IF `public.is_approved_user() = true` AND `is_published = true` AND `is_restricted = false` (and parent module/lesson is published and not restricted). Unauthenticated or `pending` users receive 0 rows.
  - `ALL` for Teachers/Admins: Allowed when `public.is_teacher_or_admin() = true`.
- **`lesson_teacher_notes` & `exercise_grading_rules`**:
  - `ALL`: Allowed ONLY when `public.is_teacher_or_admin() = true`. Students have zero access.
- **`submissions`**:
  - `SELECT`: Approved students can read their own rows (`user_id = auth.uid() AND public.is_approved_user()`); Teachers/Admins can read all rows.
  - `INSERT`: Blocked for direct client PostgREST inserts; inserts occur exclusively through `public.submit_exercise_attempt`.
  - `UPDATE`: Allowed ONLY when `public.is_teacher_or_admin() = true` (for `manual_override_score` and `teacher_feedback`).

### 3.5 Server-Side Grading & Retake Enforcement RPC (`public.submit_exercise_attempt`)
Create a `SECURITY DEFINER` function `public.submit_exercise_attempt(p_exercise_id UUID, p_answers JSONB) RETURNS JSONB`:
1. Verify `public.is_approved_user() = true`. If not, `RAISE EXCEPTION 'Unauthorized: Account not approved.'`.
2. Fetch the exercise, parent lesson, and parent module. Verify they are published and not restricted (unless `public.is_teacher_or_admin()`).
3. Count existing attempts `v_attempts` in `public.submissions` for `(auth.uid(), p_exercise_id)`.
4. **Enforce Retake Policy:**
   - If `v_attempts >= 1` AND `v_exercise.allow_retakes = false`, `RAISE EXCEPTION 'Retakes are disabled for this assignment.'`.
   - If `v_attempts >= 1` AND `v_exercise.allow_retakes = true` AND `v_exercise.max_attempts > 0` AND `v_attempts >= v_exercise.max_attempts`, `RAISE EXCEPTION 'Maximum number of attempts (%) reached.', v_exercise.max_attempts`.
5. Load `rules_json` from `public.exercise_grading_rules WHERE exercise_id = p_exercise_id`.
   Iterate through each field key in `rules_json->'fields'` and evaluate `p_answers->>field_key`:
   - **`exact_normalized`**: Lowercases, trims whitespace, collapses multiple spaces, and checks if the student's answer matches any string in the `accepted` JSON array. Awards `points` if matched, `0` otherwise.
   - **`regex`**: Evaluates student input against `pattern` (case-insensitive POSIX regex `~*`). Awards `points` if matched, `0` otherwise.
   - **`levenshtein_tolerance`**: Computes `levenshtein(lower(trim(student_val)), lower(trim(target)))`. Awards `full_points` if distance is `0`, `one_error_points` if distance is `1`, and `0` if distance `> 1`.
   - **`keyword_rubric`**: Iterates over `keyword_groups` (each group has `any_of: [...]` and `points`). Awards group points for each group where at least one keyword/stem appears in the student's explanation, and marks `requires_teacher_review: true`.
   - **`manual_essay`**: Awards `0` provisional auto-points and sets `requires_teacher_review: true` so the teacher can grade the reasoning in the Evidence Inspector.
6. Build `v_evidence_json` containing for each field:
   `{ "student_value": ..., "awarded_points": ..., "max_points": ..., "is_correct": ..., "rule_type": ..., "requires_teacher_review": ..., "hint": ... }`.
   *(Note: Only include `"hint"` inside the returned payload if `v_exercise.category = 'class_practice'`; never return hints for `'homework'`.)*
7. Insert the record into `public.submissions` with `attempt_number = v_attempts + 1`, `answers_json = p_answers`, `evidence_json = v_evidence_json`, and `auto_score = v_total_score`.
8. Return JSON result to client:
   - For `'class_practice'`: Return score, max_score, attempt_number, and full per-field feedback with hints.
   - For `'homework'`: Return `{ "submission_id": v_sub_id, "score": v_total_score, "max_score": v_exercise.max_score, "attempt_number": v_attempts + 1, "allow_retakes": v_exercise.allow_retakes, "max_attempts": v_exercise.max_attempts }`.

---

## 4. PYTHON HTML INGESTION & SANITIZATION PIPELINE (`scripts/ingest_content.py`)

Build a standalone Python script using `beautifulsoup4`, `lxml`, `python-dotenv`, and `supabase` that parses existing HTML lesson and homework files from `input_content/` and syncs them to Supabase.

### 4.1 Input Folder Structure & Schema (`input_content/`)
~~~text
input_content/
  modulul_01_demo/
    module_meta.json                    # { "slug": "modulul-01", "title": "...", "description": "...", "order_index": 1, "is_published": true }
    lectia_01/
      lesson.html                       # Interactive lesson HTML with teacher notes, visual examples, and show/hide buttons
      homework.html                     # Standalone homework HTML with problem statements and solving inputs
      grading_rules.json                # Grading rules & retake settings for homework and class practice
~~~

### 4.2 `grading_rules.json` Format
~~~json
{
  "lesson_slug": "modulul-01-lectia-01",
  "lesson_title": "Lecția 1: Morfologie și Perechi Minimale",
  "order_index": 1,
  "is_published": true,
  "exercises": [
    {
      "slug": "modulul-01-lectia-01-tema",
      "title": "Temă: Analiza Morfologică",
      "category": "homework",
      "source_file": "homework.html",
      "allow_retakes": false,
      "max_attempts": 1,
      "max_score": 100,
      "fields": {
        "q1_traducere_1": {
          "type": "exact_normalized",
          "accepted": ["otuz ada"],
          "points": 20,
          "hint": "Substantivul după numeral rămâne la forma de singular."
        },
        "q1_transcriere_armeana": {
          "type": "levenshtein_tolerance",
          "target": "Ռալուկա",
          "full_points": 20,
          "one_error_points": 10,
          "hint": "Verifică segmentele din Roxana, Valentin și Veronica."
        },
        "q1_spectrograma": {
          "type": "regex",
          "pattern": "^a(ce|țe)$",
          "points": 20,
          "hint": "Caută o consoană africată între două vocale."
        },
        "q1_explicatie": {
          "type": "keyword_rubric",
          "points": 40,
          "keyword_groups": [
            { "any_of": ["-lar", "plural"], "points": 20 },
            { "any_of": ["singular", "numeral"], "points": 20 }
          ]
        }
      }
    }
  ]
}
~~~

### 4.3 HTML Sanitization & Extraction Logic in `scripts/ingest_content.py`
For every `lesson.html` discovered in `input_content/<module_dir>/<lesson_dir>/`:
1. Parse with `BeautifulSoup(raw_html, "lxml")`.
2. **Extract & Strip Teacher Notes:**
   - Query all elements matching any of these selectors:
     `[data-role="teacher"]`, `[data-teacher-only]`, `.teacher-note`, `.teacher-notes`, `.nota-profesorului`, `.ghid-profesor`, `.teacher-only`, `#teacher-panel`, `.barem-profesor`.
   - Concatenate their outer HTML into `teacher_notes_html`, and call `.decompose()` on each matched node so it is completely removed from the student DOM.
   - Remove any mode-switching toolbar buttons that toggle teacher notes (e.g., `[data-action="toggle-teacher-mode"]`, `#btn-teacher-mode`).
3. **Preserve Visual Examples & Solution Reveal Buttons:**
   - Leave all student-facing visual examples, tables, SVGs, step-by-step animations, and show/hide solution buttons (`[data-action="toggle-solution"]`, `.btn-reveal-solution`, `onclick` handlers) intact inside `student_html`.
4. **Extract Scoped Styles & Scripts:**
   - Extract all `<style>` tags from `<head>` and `<body>` into `scoped_css`.
   - Extract all inline `<script>` tags (excluding external CDN scripts like Tailwind which are already loaded by the shell) into `scoped_js`.
   - Extract the remaining inner HTML of `<body>` (or `#lesson-root` / `main`) as `student_html`.
5. **Process `homework.html`:**
   - Parse `homework.html`.
   - Strip any client-side auto-grading `<script>` blocks or hardcoded answer keys so solutions cannot be inspected in browser DevTools.
   - Verify that all form controls (`input`, `select`, `textarea`) carry a `name` or `data-question-key` attribute corresponding to keys in `grading_rules.json`.
6. **Upsert to Supabase:**
   - Connect using `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
   - Upsert row in `public.modules` (by `slug`).
   - Upsert row in `public.lessons` (by `slug`).
   - Upsert row in `public.lesson_teacher_notes` (by `lesson_id`).
   - Upsert row(s) in `public.exercises` (by `slug`) and `public.exercise_grading_rules` (by `exercise_id`).

---

## 5. FRONTEND APPLICATION SPECIFICATION (`public/`)

Build a clean, responsive Romanian-language interface using Tailwind CSS and native ES Modules.

### 5.1 Authentication & Registration Gate (`public/js/auth.js`)
- On boot, check `supabase.auth.getSession()` and query `public.app_config` for `require_admin_validation`.
- **Unauthenticated View:**
  - Displays ONLY the Login / Self-Registration screen. No modules or navigation items are rendered or fetched.
  - **Self-Registration Tab:** Collects `Nume și Prenume` (`full_name`), `Clasa` (`class_group`), `Email`, and `Parolă`.
  - Shows a clear banner indicating whether administrator approval is currently required (`require_admin_validation === true`).
- **Pending / Rejected View (`profile.status !== 'approved'`):**
  - If a logged-in user has `status === 'pending'`, render ONLY the Pending Validation screen:
    *"Contul tău a fost înregistrat și așteaptă validarea profesorului/administratorului. Pagina se va debloca automat după aprobare."*
  - Provide `"Verifică starea contului"` (re-fetches profile) and `"Deconectare"` buttons.
- **Approved View (`profile.status === 'approved'`):**
  - Mounts the main application shell based on `profile.role` (`student`, `teacher`, `admin`).
  - Users cannot switch roles. Only users with `profile.role === 'admin'` see a `"Mod Vizualizare: Admin / Profesor / Elev"` preview selector in the header.

### 5.2 Student Experience (`public/js/lessonRunner.js` & `public/js/homeworkRunner.js`)
- **Sidebar Navigation:**
  - Lists all published, non-restricted modules and their published, non-restricted lessons ordered by `order_index`.
- **View 1: Lecție & Exemple Interactive (`lessonRunner.js`):**
  - Injects `lesson.scoped_css` into a dedicated `<style id="lesson-scoped-css">` tag.
  - Injects `lesson.student_html` into `#lesson-content-mount`.
  - Re-hydrates and executes `lesson.scoped_js` by creating a fresh `<script>` element appended to the mount container so all interactive buttons (show/hide solutions, step-by-step animations, morpheme highlighters) work seamlessly.
  - If the lesson has any `class_practice` exercises, renders them at the bottom with real-time validation (`"Verifică în clasă"`), showing immediate scores and hints.
- **View 2: Temă pentru Acasă (`homeworkRunner.js`):**
  - Renders the lesson's `homework` exercises in a dedicated tab.
  - Fetches the student's past submissions (`public.submissions`) for each exercise.
  - Displays attempt metadata:
    - Latest/Final Score badge (`Punctaj: X / Y`).
    - Retake policy badge: `"O singură trimitere permisă"` (`allow_retakes = false`) or `"Reîncercări permise: Încercarea M din N"`.
    - Teacher feedback banner if `teacher_feedback` or `manual_override_score` is present.
  - **Submission Handling:**
    - When the student clicks `"Trimite Tema"`, serializes all `<input>`, `<select>`, and `<textarea>` values (keyed by `name` or `data-question-key`) into `p_answers`.
    - Calls `supabase.rpc('submit_exercise_attempt', { p_exercise_id, p_answers })`.
    - Displays the automated score immediately.
    - If retakes are disabled (`allow_retakes = false`) or the student has reached `max_attempts`, locks all inputs in read-only state populated with the student's submitted answers.
    - If retakes are enabled and attempts remain, displays a `"Reîncearcă Exercițiul"` button.

### 5.3 Teacher & Admin Dashboard (`public/js/teacherDashboard.js` & `public/js/adminConfig.js`)
Rendered only when `profile.role IN ('teacher', 'admin')`:
1. **In-Lesson Teacher Notes Drawer:**
   - When a teacher views any lesson, fetches `public.lesson_teacher_notes` for that `lesson_id` and displays a toggleable side/top drawer containing the extracted `teacher_notes_html`.
2. **Module, Lesson & Retake Management Tab:**
   - Lists all modules and lessons with instant toggle switches for `Publicat` (`is_published`) and `Restricționat` (`is_restricted`).
   - Lists all exercises under each lesson with controls to toggle `Permite Reîncercarea` (`allow_retakes`) and edit `Număr Maxim Încercări` (`max_attempts`), saving directly to `public.exercises`.
3. **Student Scores & Evidence Inspector Tab (`Rezultate & Dovezi Elevi`):**
   - Filterable table by Module, Lesson, Class Group, and Student Name.
   - Columns: Student Name, Class, Lesson/Exercise, Attempt #, Auto Score, Override Score, Final Score, Date/Time, and `"Vezi Dovada"` button.
   - **Evidence Modal (`Vezi Dovada`):**
     - Displays the complete `evidence_json` and `answers_json` side-by-side: every question key, the student's exact input, points automatically awarded vs. max points, and whether teacher review is flagged.
     - Provides inputs for the teacher to set `manual_override_score` and `teacher_feedback` and click `"Salvează Nota Finală"`.
     - Includes a `"Resetează Încercările Elevului"` button (deletes or archives a student's submissions for that exercise if the teacher wants to grant an individual retake exception).
4. **User Registration Approval & Global Settings Tab:**
   - Displays a table of users filtered by status (`În așteptare / Pending`, `Aprobați`, `Respinși`).
   - One-click `"Aprobă"` and `"Respinge"` buttons for pending student accounts.
   - **Global Validation Flag Switch:** Toggle switch for `"Necesită validarea unui administrator/profesor pentru conturile noi"` (`app_config.require_admin_validation`).
   - **Role Assignment (Admin only):** Dropdown to set a user's role to `student`, `teacher`, or `admin`.

---

## 6. CI/CD & AUTOMATION WORKFLOWS (`.github/workflows/`)

1. **`.github/workflows/deploy.yml`:**
   - Triggers on `push` to `main` and `workflow_dispatch`.
   - Job 1 (`backend_and_content_sync`):
     - Checks out repo.
     - Installs Supabase CLI and pushes migrations (`supabase db push --db-url "$SUPABASE_DB_URL"`).
     - Sets up Python 3.11, installs `scripts/requirements.txt`, and runs `python scripts/ingest_content.py` using `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
   - Job 2 (`deploy_frontend`):
     - Generates `public/js/config.js` from `SUPABASE_URL` and `SUPABASE_ANON_KEY` repository secrets.
     - Uploads and deploys `public/` to GitHub Pages using `actions/upload-pages-artifact@v3` and `actions/deploy-pages@v4`.
2. **`.github/workflows/supabase-keepalive.yml`:**
   - Runs on `schedule: - cron: '0 6 */5 * *'` and `workflow_dispatch`.
   - Sends an HTTP `GET` request to `${{ secrets.SUPABASE_URL }}/rest/v1/app_config?select=id` with the `apikey: ${{ secrets.SUPABASE_ANON_KEY }}` header so the free-tier Supabase PostgreSQL database never pauses due to 7-day inactivity.

---

## 7. STEP-BY-STEP EXECUTION INSTRUCTIONS FOR ANTIGRAVITY
Execute all steps below sequentially and generate every file in full (no placeholders or `// TODO` comments):
1. Create `.env.example`, `package.json`, and `supabase/config.toml`.
2. Create `supabase/migrations/20261113000000_init.sql` with all tables, enums, triggers, RLS policies, and the complete `public.submit_exercise_attempt` PL/pgSQL function.
3. Create `scripts/requirements.txt` and `scripts/ingest_content.py`, plus the working verification module in `input_content/modulul_01_demo/` (`module_meta.json`, `lectia_01/lesson.html` with teacher notes + visual examples + show/hide solution buttons, `lectia_01/homework.html`, and `lectia_01/grading_rules.json`) and `input_content/README.md`.
4. Create `public/index.html`, `public/css/styles.css`, and all 8 JavaScript ES modules in `public/js/` (`config.js`, `supabaseClient.js`, `auth.js`, `app.js`, `lessonRunner.js`, `homeworkRunner.js`, `teacherDashboard.js`, `adminConfig.js`).
5. Create `.github/workflows/deploy.yml` and `.github/workflows/supabase-keepalive.yml`.
6. Create the root `README.md` with clear instructions on configuring the 4 GitHub Secrets (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`), dropping existing lesson HTML files into `input_content/`, and running locally.