# Platformă Modulară de Cursuri Lingvistice (Zero-Cost Architecture)

Platformă educațională modernă, cu cost de operare $0/lună, găzduită pe **GitHub Pages**, conectată la **Supabase** (PostgreSQL, Auth, Row-Level Security, funcții RPC de notare server-side) și automatizată printr-un pipeline Python de ingestie a lecțiilor și temelor în format HTML.

---

## 🌟 Caracteristici Cheie

1. **Ingestie fără Conținut Sintetic:**
   - Nu generează conținut artificial; preia direct fișierele HTML din `input_content/` organizate pe module și lecții.
2. **Izolare Strictă a Notelor Profesorului:**
   - Notele de predare, baremele și sfaturile metodice sunt extrase automat din HTML în timpul ingestiei și salvate exclusiv în tabela securizată `lesson_teacher_notes`, protejată prin Row-Level Security (RLS). Elevii nu au acces nici măcar în codul sursă descărcat de browser.
3. **Păstrarea Interactivității pentru Elevi:**
   - Exemplele vizuale, widget-urile de compunere morfologică, tabelele și butoanele de dezvăluire pas-cu-pas a soluțiilor demonstrative din lecții (`data-action="toggle-solution"`) rămân 100% funcționale pentru elevi.
4. **Corectare Server-Side Fără Soluții Expuse:**
   - Pentru teme, cheile de răspuns și baremele nu sunt niciodată transmise browserului. Evaluarea se execută pe server prin procedura `public.submit_exercise_attempt`.
   - Suportă reguli de tip: `exact_normalized`, `regex`, `levenshtein_tolerance` (distanță Levenshtein pentru greșeli mărunte de scriere sau alfabet exotic), `keyword_rubric` și `manual_essay`.
5. **Politici Configurabile de Reîncercare:**
   - Profesorii pot activa/dezactiva reîncercările per exercițiu (`allow_retakes`) și stabili numărul maxim de încercări (`max_attempts`).
6. **Înregistrare cu Poartă de Validare:**
   - Elevii se pot înregistra direct. Un comutator global (`require_admin_validation`) dictează dacă noii utilizatori necesită aprobarea manuală a profesorului (`pending`) sau sunt aprobați automat.
7. **Inspector de Dovezi:**
   - Profesorii pot audita fiecare trimitere (`answers_json` și `evidence_json`), suprascrie manual nota (`manual_override_score`), oferi feedback și reseta încercările unui elev.
8. **Keepalive Automat:**
   - Workflow GitHub Actions la fiecare 5 zile ce interoghează baza de date Supabase gratuită pentru a preveni auto-suspendarea la 7 zile de inactivitate.

---

## 📁 Structura Proiectului

```text
.
├── .github/
│   └── workflows/
│       ├── deploy.yml                  # CI/CD: Migrări DB, Ingestie conținut, Deploy Pages
│       └── supabase-keepalive.yml      # Cron la 5 zile pentru menținerea activă a DB
├── input_content/                      # Folder pentru fișierele HTML de curs și teme
│   ├── README.md                       # Documentație detaliată a schemelor de conținut
│   └── modulul_01_demo/                # Fixtură de verificare
│       ├── module_meta.json
│       └── lectia_01/
│           ├── lesson.html
│           ├── homework.html
│           └── grading_rules.json
├── scripts/
│   ├── requirements.txt                # Dependențe Python (beautifulsoup4, supabase, etc.)
│   └── ingest_content.py               # Pipeline de parsare, sanitizare și sincronizare
├── supabase/
│   ├── config.toml                     # Configurare Supabase CLI
│   └── migrations/
│       └── 20261113000000_init.sql     # Schemă completă, triggere, politici RLS și RPC
├── public/                             # Interfață statică pentru GitHub Pages
│   ├── index.html                      # Shell SPA unificat (Auth, Elev, Profesor)
│   ├── css/
│   │   └── styles.css                  # Stiluri și reguli de izolare
│   └── js/
│       ├── config.js                   # Credențiale Supabase
│       ├── supabaseClient.js           # Client singleton Supabase
│       ├── auth.js                     # Autentificare, înregistrare, ecran de așteptare
│       ├── app.js                      # Router principal și navigator pe roluri
│       ├── lessonRunner.js             # Rulare lecții + drawer note profesor
│       ├── homeworkRunner.js           # Formulare de temă + apelare RPC notare
│       ├── teacherDashboard.js         # Panou profesor: publicare, dovezi, aprobări
│       └── adminConfig.js              # Setări globale admin și roluri
├── .env.example
├── package.json                        # Scripturi locale
└── README.md
```

---

## 🚀 Ghid de Configurare și Implementare

### Pasul 1: Crearea Proiectului Supabase (Gratuit)
1. Accesați [supabase.com](https://supabase.com) și creați un proiect nou gratuit.
2. În panoul Supabase, navigați la **Project Settings** -> **API**:
   - Copiați **Project URL** (`SUPABASE_URL`).
   - Copiați **Project API Key (anon/public)** (`SUPABASE_ANON_KEY`).
   - Copiați **Project API Key (service_role/secret)** (`SUPABASE_SERVICE_ROLE_KEY`).
3. Navigați la **Project Settings** -> **Database** -> secțiunea **Connection string**:
   - Copiați URI-ul de conectare directă PostgreSQL (`SUPABASE_DB_URL`), înlocuind parola stabilită la crearea bazei de date.

### Pasul 2: Aplicarea Migrărilor de Bază de Date
Puteți aplica schema prin una din următoarele metode:
- **Metoda A (Direct din panoul Supabase):**
  Deschideți **SQL Editor** în panoul Supabase, copiați tot conținutul din `supabase/migrations/20261113000000_init.sql` și apăsați **Run**.
- **Metoda B (Supabase CLI):**
  ```bash
  supabase db push --db-url "postgresql://postgres.[ID]:[PAROLA]@aws-0-[REGION].pooler.supabase.com:5432/postgres"
  ```

### Pasul 3: Rularea Ingestiei de Conținut Local
1. Instalați dependențele Python:
   ```bash
   pip install -r scripts/requirements.txt
   ```
2. Creați fișierul `.env` din modelul pus la dispoziție:
   ```bash
   cp .env.example .env
   ```
   Completați `SUPABASE_URL` și `SUPABASE_SERVICE_ROLE_KEY`.
3. Rulați pipeline-ul de ingestie:
   ```bash
   python scripts/ingest_content.py
   ```
   *(Puteți rula și cu flag-ul `--dry-run` pentru a valida structura fișierelor fără modificarea bazei de date).*

### Pasul 4: Pornirea Aplicației Frontend Local
Puteți folosi orice server static local:
```bash
npm install
npm run dev
```
Sau folosind direct modulul HTTP din Python:
```bash
python -m http.server 3000 --directory public
```
Deschideți `http://localhost:3000` în browser.

---

## 🔒 Secrete Necesare în GitHub Actions (CI/CD)

Pentru a activa desfășurarea automată a modificărilor și sincronizarea conținutului pe **GitHub Pages**, adăugați următoarele 4 secrete în depozitul GitHub (**Settings** -> **Secrets and variables** -> **Actions**):

| Nume Secret | Descriere | Unde se găsește în Supabase |
|---|---|---|
| `SUPABASE_URL` | URL-ul instanței Supabase (ex: `https://xyz.supabase.co`) | Settings -> API -> Project URL |
| `SUPABASE_ANON_KEY` | Cheia publică anonimă a clientului | Settings -> API -> `anon` `public` |
| `SUPABASE_SERVICE_ROLE_KEY` | Cheia secretă de administrare (folosită doar în pipeline-ul Python de ingestie) | Settings -> API -> `service_role` `secret` |
| `SUPABASE_DB_URL` | Șirul de conexiune PostgreSQL direct | Settings -> Database -> Connection URI |

De asemenea, asigurați-vă că activați GitHub Pages în **Settings** -> **Pages** -> **Build and deployment** -> selectați **GitHub Actions**.

---

## 👥 Roluri și Permisiuni

- **Elev (`student`):**
  - Acces la modulele și lecțiile publicate și nerestricționate.
  - Interacțiune completă cu exemplele vizuale și butoanele de dezvăluire pas cu pas din lecții.
  - Completarea temelor și trimiterea pentru notare automată server-side.
  - Vizualizarea istoricului încercărilor și a feedback-ului primit de la profesor.
  - **Zero acces** la notele profesorului sau baremele interne de corectare.
- **Cadru Didactic (`teacher`):**
  - Vizualizarea notelor pedagogice direct în lecție printr-un sertar dedicat.
  - Publicarea/restricționarea modulelor și lecțiilor.
  - Configurarea politicilor de reîncercare (`allow_retakes`, `max_attempts`).
  - Acces la Inspectorul de Dovezi (`answers_json` & `evidence_json`).
  - Suprascrierea manuală a notelor și acordarea de feedback.
  - Resetarea încercărilor pentru acordarea de excepții individuale de reîncercare.
  - Aprobarea/respingerea elevilor noi înregistrați.
- **Administrator (`admin`):**
  - Toate privilegiile de profesor.
  - Modificarea rolului oricărui utilizator (`student`, `teacher`, `admin`).
  - Comutarea validării manuale la nivel global (`require_admin_validation`).
  - Meniu special în antet: **„Mod Vizualizare”** (permite previzualizarea instantanee a platformei din perspectiva unui elev sau a unui profesor, fără a schimba rolul în baza de date).

---

## 🛠️ Adăugarea de Noi Lecții și Module

Pentru a adăuga un modul sau o lecție nouă, adăugați pur și simplu un folder în `input_content/`:
1. Creați `input_content/modulul_02/module_meta.json`.
2. Creați subfolderul `input_content/modulul_02/lectia_01/`.
3. Adăugați `lesson.html`, `homework.html` și `grading_rules.json`.
4. Rulați `python scripts/ingest_content.py` sau faceți `git push` către `main`.
Sistemul CI/CD va actualiza automat baza de date și va publica conținutul!
