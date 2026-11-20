-- ==============================================================================
-- 20261113000000_init.sql
-- Complete schema, triggers, RLS policies, and grading RPCs
-- ==============================================================================

-- 1. EXTENSIONS
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
EXCEPTION
  WHEN OTHERS THEN null;
END $$;

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
EXCEPTION
  WHEN OTHERS THEN null;
END $$;

-- Ensure extensions schema is in search_path if installed there by default
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
    BEGIN
      ALTER DATABASE postgres SET search_path TO public, extensions;
    EXCEPTION
      WHEN OTHERS THEN null;
    END;
  END IF;
END $$;

-- 2. CUSTOM ENUMS
DO $$ BEGIN
  CREATE TYPE public.user_role AS ENUM ('student', 'teacher', 'admin');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE public.account_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE public.exercise_category AS ENUM ('class_practice', 'homework');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 3. TABLES

-- 3.1 App Configuration (Singleton row)
CREATE TABLE IF NOT EXISTS public.app_config (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  require_admin_validation BOOLEAN NOT NULL DEFAULT true,
  bootstrap_admin_email TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.app_config (id, require_admin_validation, bootstrap_admin_email)
VALUES (1, true, 'admin@exemplu.ro')
ON CONFLICT (id) DO NOTHING;

-- 3.2 Profiles (Linked to auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  class_group TEXT,
  role public.user_role NOT NULL DEFAULT 'student',
  status public.account_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3.3 Modules
CREATE TABLE IF NOT EXISTS public.modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  order_index INT NOT NULL DEFAULT 1,
  is_published BOOLEAN NOT NULL DEFAULT false,
  is_restricted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3.4 Lessons
CREATE TABLE IF NOT EXISTS public.lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID NOT NULL REFERENCES public.modules(id) ON DELETE CASCADE,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  order_index INT NOT NULL DEFAULT 1,
  student_html TEXT NOT NULL,
  scoped_css TEXT DEFAULT '',
  scoped_js TEXT DEFAULT '',
  is_published BOOLEAN NOT NULL DEFAULT false,
  is_restricted BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3.5 Lesson Teacher Notes (Isolated table - zero student access)
CREATE TABLE IF NOT EXISTS public.lesson_teacher_notes (
  lesson_id UUID PRIMARY KEY REFERENCES public.lessons(id) ON DELETE CASCADE,
  teacher_notes_html TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3.6 Exercises
CREATE TABLE IF NOT EXISTS public.exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id UUID NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  order_index INT NOT NULL DEFAULT 1,
  category public.exercise_category NOT NULL DEFAULT 'homework',
  prompt_html TEXT NOT NULL,
  scoped_css TEXT DEFAULT '',
  scoped_js TEXT DEFAULT '',
  allow_retakes BOOLEAN NOT NULL DEFAULT false,
  max_attempts INT NOT NULL DEFAULT 1,
  max_score NUMERIC(6,2) NOT NULL DEFAULT 100.00,
  is_published BOOLEAN NOT NULL DEFAULT true
);

-- 3.7 Exercise Grading Rules (Isolated table - zero student access)
CREATE TABLE IF NOT EXISTS public.exercise_grading_rules (
  exercise_id UUID PRIMARY KEY REFERENCES public.exercises(id) ON DELETE CASCADE,
  rules_json JSONB NOT NULL,
  solution_explanation_html TEXT DEFAULT ''
);

-- 3.8 Submissions (Scores & evidence audit trail)
CREATE TABLE IF NOT EXISTS public.submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  exercise_id UUID NOT NULL REFERENCES public.exercises(id) ON DELETE CASCADE,
  attempt_number INT NOT NULL DEFAULT 1,
  answers_json JSONB NOT NULL,
  evidence_json JSONB NOT NULL,
  auto_score NUMERIC(6,2) NOT NULL DEFAULT 0,
  manual_override_score NUMERIC(6,2),
  final_score NUMERIC(6,2) GENERATED ALWAYS AS (COALESCE(manual_override_score, auto_score)) STORED,
  teacher_feedback TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. SECURITY HELPER FUNCTIONS

CREATE OR REPLACE FUNCTION public.is_approved_user()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND status = 'approved'
  );
$$;

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS public.user_role
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT role FROM public.profiles WHERE id = auth.uid()),
    'student'::public.user_role
  );
$$;

CREATE OR REPLACE FUNCTION public.is_teacher_or_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND status = 'approved' AND role IN ('teacher', 'admin')
  );
$$;

-- 5. TRIGGERS

-- 5.1 Self-Registration Trigger on auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_require_validation BOOLEAN := true;
  v_bootstrap_email TEXT := null;
  v_full_name TEXT;
  v_class_group TEXT;
  v_role public.user_role := 'student';
  v_status public.account_status := 'pending';
BEGIN
  -- Read app config
  SELECT require_admin_validation, bootstrap_admin_email
  INTO v_require_validation, v_bootstrap_email
  FROM public.app_config
  WHERE id = 1;

  -- Extract user metadata
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1));
  v_class_group := NEW.raw_user_meta_data->>'class_group';

  -- Check bootstrap admin email
  IF v_bootstrap_email IS NOT NULL AND LOWER(NEW.email) = LOWER(v_bootstrap_email) THEN
    v_role := 'admin';
    v_status := 'approved';
  ELSIF v_require_validation = false THEN
    v_role := 'student';
    v_status := 'approved';
  ELSE
    v_role := 'student';
    v_status := 'pending';
  END IF;

  INSERT INTO public.profiles (id, email, full_name, class_group, role, status)
  VALUES (NEW.id, NEW.email, v_full_name, v_class_group, v_role, v_status)
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      full_name = EXCLUDED.full_name,
      class_group = COALESCE(EXCLUDED.class_group, public.profiles.class_group);

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
  CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Trigger on auth.users could not be updated: %', SQLERRM;
END $$;

-- 5.2 Protect Profile Columns Trigger on public.profiles
CREATE OR REPLACE FUNCTION public.check_profile_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_caller_role public.user_role;
  v_caller_status public.account_status;
BEGIN
  -- If invoked without auth context (e.g. database migrations or service role), allow
  IF v_caller_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT role, status INTO v_caller_role, v_caller_status
  FROM public.profiles
  WHERE id = v_caller_id;

  -- Non-approved users cannot modify profiles
  IF v_caller_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'Access denied: account not approved.';
  END IF;

  -- 1. Role Change Protection:
  IF OLD.role IS DISTINCT FROM NEW.role THEN
    IF v_caller_role != 'admin' THEN
      RAISE EXCEPTION 'Security restriction: Only administrators can modify user roles.';
    END IF;
  END IF;

  -- 2. Status Change Protection:
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF v_caller_role NOT IN ('teacher', 'admin') THEN
      RAISE EXCEPTION 'Security restriction: Only teachers or administrators can approve or reject accounts.';
    END IF;

    -- Teachers can only update students, never teachers or admins
    IF v_caller_role = 'teacher' AND OLD.role != 'student' THEN
      RAISE EXCEPTION 'Teachers can only manage student account statuses.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_profile_columns ON public.profiles;
CREATE TRIGGER protect_profile_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.check_profile_update();

-- 6. ROW-LEVEL SECURITY POLICIES

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_teacher_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercise_grading_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;

-- 6.1 app_config
DROP POLICY IF EXISTS "app_config_read" ON public.app_config;
CREATE POLICY "app_config_read" ON public.app_config
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "app_config_update" ON public.app_config;
CREATE POLICY "app_config_update" ON public.app_config
  FOR UPDATE TO authenticated
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- 6.2 profiles
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_teacher_or_admin());

DROP POLICY IF EXISTS "profiles_update" ON public.profiles;
CREATE POLICY "profiles_update" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.is_teacher_or_admin())
  WITH CHECK (id = auth.uid() OR public.is_teacher_or_admin());

-- 6.3 modules
DROP POLICY IF EXISTS "modules_select" ON public.modules;
CREATE POLICY "modules_select" ON public.modules
  FOR SELECT TO authenticated
  USING (
    public.is_teacher_or_admin()
    OR (
      public.is_approved_user()
      AND is_published = true
      AND is_restricted = false
    )
  );

DROP POLICY IF EXISTS "modules_teacher_admin_all" ON public.modules;
CREATE POLICY "modules_teacher_admin_all" ON public.modules
  FOR ALL TO authenticated
  USING (public.is_teacher_or_admin())
  WITH CHECK (public.is_teacher_or_admin());

-- 6.4 lessons
DROP POLICY IF EXISTS "lessons_select" ON public.lessons;
CREATE POLICY "lessons_select" ON public.lessons
  FOR SELECT TO authenticated
  USING (
    public.is_teacher_or_admin()
    OR (
      public.is_approved_user()
      AND is_published = true
      AND is_restricted = false
      AND EXISTS (
        SELECT 1 FROM public.modules m
        WHERE m.id = lessons.module_id
          AND m.is_published = true
          AND m.is_restricted = false
      )
    )
  );

DROP POLICY IF EXISTS "lessons_teacher_admin_all" ON public.lessons;
CREATE POLICY "lessons_teacher_admin_all" ON public.lessons
  FOR ALL TO authenticated
  USING (public.is_teacher_or_admin())
  WITH CHECK (public.is_teacher_or_admin());

-- 6.5 lesson_teacher_notes (Strict isolation: only teacher/admin)
DROP POLICY IF EXISTS "lesson_teacher_notes_all" ON public.lesson_teacher_notes;
CREATE POLICY "lesson_teacher_notes_all" ON public.lesson_teacher_notes
  FOR ALL TO authenticated
  USING (public.is_teacher_or_admin())
  WITH CHECK (public.is_teacher_or_admin());

-- 6.6 exercises
DROP POLICY IF EXISTS "exercises_select" ON public.exercises;
CREATE POLICY "exercises_select" ON public.exercises
  FOR SELECT TO authenticated
  USING (
    public.is_teacher_or_admin()
    OR (
      public.is_approved_user()
      AND is_published = true
      AND EXISTS (
        SELECT 1 FROM public.lessons l
        JOIN public.modules m ON m.id = l.module_id
        WHERE l.id = exercises.lesson_id
          AND l.is_published = true
          AND l.is_restricted = false
          AND m.is_published = true
          AND m.is_restricted = false
      )
    )
  );

DROP POLICY IF EXISTS "exercises_teacher_admin_all" ON public.exercises;
CREATE POLICY "exercises_teacher_admin_all" ON public.exercises
  FOR ALL TO authenticated
  USING (public.is_teacher_or_admin())
  WITH CHECK (public.is_teacher_or_admin());

-- 6.7 exercise_grading_rules (Strict isolation: only teacher/admin)
DROP POLICY IF EXISTS "exercise_grading_rules_all" ON public.exercise_grading_rules;
CREATE POLICY "exercise_grading_rules_all" ON public.exercise_grading_rules
  FOR ALL TO authenticated
  USING (public.is_teacher_or_admin())
  WITH CHECK (public.is_teacher_or_admin());

-- 6.8 submissions
DROP POLICY IF EXISTS "submissions_select" ON public.submissions;
CREATE POLICY "submissions_select" ON public.submissions
  FOR SELECT TO authenticated
  USING (
    public.is_teacher_or_admin()
    OR (user_id = auth.uid() AND public.is_approved_user())
  );

-- Direct client inserts are intentionally prevented; submissions are processed via RPC
DROP POLICY IF EXISTS "submissions_insert_blocked" ON public.submissions;
CREATE POLICY "submissions_insert_blocked" ON public.submissions
  FOR INSERT TO authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS "submissions_update_teacher" ON public.submissions;
CREATE POLICY "submissions_update_teacher" ON public.submissions
  FOR UPDATE TO authenticated
  USING (public.is_teacher_or_admin())
  WITH CHECK (public.is_teacher_or_admin());

DROP POLICY IF EXISTS "submissions_delete_teacher" ON public.submissions;
CREATE POLICY "submissions_delete_teacher" ON public.submissions
  FOR DELETE TO authenticated
  USING (public.is_teacher_or_admin());

-- 7. SERVER-SIDE GRADING & RETAKE ENFORCEMENT RPC

CREATE OR REPLACE FUNCTION public.submit_exercise_attempt(
  p_exercise_id UUID,
  p_answers JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_is_approved BOOLEAN;
  v_is_teacher_admin BOOLEAN;
  v_exercise RECORD;
  v_lesson RECORD;
  v_module RECORD;
  v_attempts INT := 0;
  v_rules_json JSONB;
  v_fields JSONB;
  v_field_key TEXT;
  v_field_rule JSONB;
  v_rule_type TEXT;
  v_student_val TEXT;
  v_norm_student TEXT;
  v_accepted_item JSONB;
  v_matched BOOLEAN;
  v_pattern TEXT;
  v_target TEXT;
  v_dist INT;
  v_kw_groups JSONB;
  v_kw_group JSONB;
  v_kw_item JSONB;
  v_kw_match BOOLEAN;
  v_kw_total_pts NUMERIC(6,2);
  v_points NUMERIC(6,2);
  v_max_field_points NUMERIC(6,2);
  v_field_correct BOOLEAN;
  v_requires_review BOOLEAN;
  v_hint TEXT;
  v_field_evidence JSONB;
  v_evidence_json JSONB := '{}'::JSONB;
  v_total_score NUMERIC(6,2) := 0.00;
  v_sub_id UUID;
  v_return_result JSONB;
BEGIN
  -- 1. Verify User Authentication & Status
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: User is not authenticated.';
  END IF;

  v_is_approved := public.is_approved_user();
  IF NOT v_is_approved THEN
    RAISE EXCEPTION 'Unauthorized: Account not approved.';
  END IF;

  v_is_teacher_admin := public.is_teacher_or_admin();

  -- 2. Fetch Exercise, Lesson, and Module
  SELECT * INTO v_exercise FROM public.exercises WHERE id = p_exercise_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exercise with ID % not found.', p_exercise_id;
  END IF;

  SELECT * INTO v_lesson FROM public.lessons WHERE id = v_exercise.lesson_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parent lesson not found.';
  END IF;

  SELECT * INTO v_module FROM public.modules WHERE id = v_lesson.module_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parent module not found.';
  END IF;

  -- Verify publication & restriction status for non-teachers
  IF NOT v_is_teacher_admin THEN
    IF NOT v_exercise.is_published THEN
      RAISE EXCEPTION 'This exercise is currently not published.';
    END IF;
    IF v_lesson.is_restricted OR NOT v_lesson.is_published THEN
      RAISE EXCEPTION 'This lesson is restricted or unpublished.';
    END IF;
    IF v_module.is_restricted OR NOT v_module.is_published THEN
      RAISE EXCEPTION 'This module is restricted or unpublished.';
    END IF;
  END IF;

  -- 3. Count existing attempts
  SELECT COUNT(*) INTO v_attempts
  FROM public.submissions
  WHERE user_id = v_user_id AND exercise_id = p_exercise_id;

  -- 4. Enforce Retake Policy
  IF v_attempts >= 1 AND NOT v_exercise.allow_retakes THEN
    RAISE EXCEPTION 'Retakes are disabled for this assignment.';
  END IF;

  IF v_attempts >= 1 AND v_exercise.allow_retakes AND v_exercise.max_attempts > 0 AND v_attempts >= v_exercise.max_attempts THEN
    RAISE EXCEPTION 'Maximum number of attempts (%) reached.', v_exercise.max_attempts;
  END IF;

  -- 5. Load grading rules
  SELECT rules_json INTO v_rules_json
  FROM public.exercise_grading_rules
  WHERE exercise_id = p_exercise_id;

  IF v_rules_json IS NULL OR NOT (v_rules_json ? 'fields') THEN
    RAISE EXCEPTION 'Grading rules not configured for exercise %.', p_exercise_id;
  END IF;

  v_fields := v_rules_json->'fields';

  -- 6. Evaluate each question field
  FOR v_field_key IN SELECT jsonb_object_keys(v_fields)
  LOOP
    v_field_rule := v_fields->v_field_key;
    v_rule_type := COALESCE(v_field_rule->>'type', 'exact_normalized');
    v_student_val := COALESCE(p_answers->>v_field_key, '');
    v_points := 0.00;
    v_field_correct := false;
    v_requires_review := false;
    v_hint := v_field_rule->>'hint';

    -- Max points for field
    v_max_field_points := COALESCE(
      (v_field_rule->>'points')::NUMERIC,
      (v_field_rule->>'full_points')::NUMERIC,
      0.00
    );

    -- Evaluation per rule type
    CASE v_rule_type
      -- EXACT NORMALIZED
      WHEN 'exact_normalized' THEN
        v_norm_student := regexp_replace(lower(trim(v_student_val)), '\s+', ' ', 'g');
        v_matched := false;

        IF v_field_rule ? 'accepted' THEN
          FOR v_accepted_item IN SELECT * FROM jsonb_array_elements_text(v_field_rule->'accepted')
          LOOP
            IF v_norm_student = regexp_replace(lower(trim(v_accepted_item#>>'{}')), '\s+', ' ', 'g') THEN
              v_matched := true;
              EXIT;
            END IF;
          END LOOP;
        END IF;

        IF v_matched THEN
          v_points := v_max_field_points;
          v_field_correct := true;
        ELSE
          v_points := 0.00;
          v_field_correct := false;
        END IF;

      -- REGEX
      WHEN 'regex' THEN
        v_pattern := COALESCE(v_field_rule->>'pattern', '');
        IF v_pattern <> '' AND trim(v_student_val) ~* v_pattern THEN
          v_points := v_max_field_points;
          v_field_correct := true;
        ELSE
          v_points := 0.00;
          v_field_correct := false;
        END IF;

      -- LEVENSHTEIN TOLERANCE
      WHEN 'levenshtein_tolerance' THEN
        v_target := COALESCE(v_field_rule->>'target', '');
        IF v_target <> '' THEN
          v_dist := levenshtein(lower(trim(v_student_val)), lower(trim(v_target)));
          IF v_dist = 0 THEN
            v_points := COALESCE((v_field_rule->>'full_points')::NUMERIC, v_max_field_points);
            v_field_correct := true;
          ELSIF v_dist = 1 THEN
            v_points := COALESCE((v_field_rule->>'one_error_points')::NUMERIC, (v_max_field_points * 0.5)::NUMERIC);
            v_field_correct := true;
          ELSE
            v_points := 0.00;
            v_field_correct := false;
          END IF;
        ELSE
          v_points := 0.00;
          v_field_correct := false;
        END IF;

      -- KEYWORD RUBRIC
      WHEN 'keyword_rubric' THEN
        v_kw_total_pts := 0.00;
        v_requires_review := true;
        v_kw_groups := v_field_rule->'keyword_groups';

        IF v_kw_groups IS NOT NULL AND jsonb_typeof(v_kw_groups) = 'array' THEN
          FOR v_kw_group IN SELECT * FROM jsonb_array_elements(v_kw_groups)
          LOOP
            v_kw_match := false;
            IF v_kw_group ? 'any_of' THEN
              FOR v_kw_item IN SELECT * FROM jsonb_array_elements_text(v_kw_group->'any_of')
              LOOP
                IF lower(v_student_val) LIKE '%' || lower(trim(v_kw_item#>>'{}')) || '%' THEN
                  v_kw_match := true;
                  EXIT;
                END IF;
              END LOOP;
            END IF;

            IF v_kw_match THEN
              v_kw_total_pts := v_kw_total_pts + COALESCE((v_kw_group->>'points')::NUMERIC, 0.00);
            END IF;
          END LOOP;
        END IF;

        v_points := v_kw_total_pts;
        v_field_correct := (v_points > 0);

      -- MANUAL ESSAY / OPEN-ENDED
      WHEN 'manual_essay' THEN
        v_points := 0.00;
        v_field_correct := false;
        v_requires_review := true;

      ELSE
        -- Fallback: exact string match
        IF lower(trim(v_student_val)) = lower(trim(COALESCE(v_field_rule->>'target', ''))) THEN
          v_points := v_max_field_points;
          v_field_correct := true;
        ELSE
          v_points := 0.00;
          v_field_correct := false;
        END IF;
    END CASE;

    v_total_score := v_total_score + v_points;

    -- Build field evidence object
    v_field_evidence := jsonb_build_object(
      'student_value', v_student_val,
      'awarded_points', v_points,
      'max_points', v_max_field_points,
      'is_correct', v_field_correct,
      'rule_type', v_rule_type,
      'requires_teacher_review', v_requires_review,
      'hint', CASE WHEN v_exercise.category = 'class_practice' THEN v_hint ELSE NULL END
    );

    v_evidence_json := jsonb_set(v_evidence_json, ARRAY[v_field_key], v_field_evidence, true);
  END LOOP;

  -- 7. Insert submission record into public.submissions
  INSERT INTO public.submissions (
    user_id,
    exercise_id,
    attempt_number,
    answers_json,
    evidence_json,
    auto_score
  ) VALUES (
    v_user_id,
    p_exercise_id,
    v_attempts + 1,
    p_answers,
    v_evidence_json,
    v_total_score
  ) RETURNING id INTO v_sub_id;

  -- 8. Return formatted payload to caller
  IF v_exercise.category = 'class_practice' THEN
    v_return_result := jsonb_build_object(
      'submission_id', v_sub_id,
      'category', 'class_practice',
      'score', v_total_score,
      'max_score', v_exercise.max_score,
      'attempt_number', v_attempts + 1,
      'evidence', v_evidence_json
    );
  ELSE
    -- Homework: Strict isolation - do NOT return answer keys, targets, or hints
    v_return_result := jsonb_build_object(
      'submission_id', v_sub_id,
      'category', 'homework',
      'score', v_total_score,
      'max_score', v_exercise.max_score,
      'attempt_number', v_attempts + 1,
      'allow_retakes', v_exercise.allow_retakes,
      'max_attempts', v_exercise.max_attempts
    );
  END IF;

  RETURN v_return_result;
END;
$$;

-- 8. TEACHER / ADMIN HELPER RPCs

-- Reset student attempts for an exercise (grant retake exception)
CREATE OR REPLACE FUNCTION public.reset_student_attempts(
  p_user_id UUID,
  p_exercise_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_teacher_or_admin() THEN
    RAISE EXCEPTION 'Access denied: Only teachers and administrators can reset attempts.';
  END IF;

  DELETE FROM public.submissions
  WHERE user_id = p_user_id AND exercise_id = p_exercise_id;

  RETURN true;
END;
$$;

-- Grade submission (Teacher manual override score & feedback)
CREATE OR REPLACE FUNCTION public.grade_submission(
  p_submission_id UUID,
  p_manual_override_score NUMERIC(6,2),
  p_teacher_feedback TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_teacher_or_admin() THEN
    RAISE EXCEPTION 'Access denied: Only teachers and administrators can grade submissions.';
  END IF;

  UPDATE public.submissions
  SET manual_override_score = p_manual_override_score,
      teacher_feedback = p_teacher_feedback
  WHERE id = p_submission_id;

  RETURN true;
END;
$$;
