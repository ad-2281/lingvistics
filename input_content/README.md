# Ghid Structură Conținut Curs (`input_content/`)

Platforma ingerează fișiere HTML preexistente grupate pe **module** și **lecții**, fără generare de conținut sintetic. Fiecare lecție poate conține atât suportul de curs cu exemple vizuale și widget-uri interactive, cât și secțiunea de temă pentru acasă cu corectare automată server-side.

---

## 1. Structura Fișierelor

Fiecare modul este un director separat ce conține fișierul `module_meta.json` și unul sau mai multe subdirectoare de lecții:

```text
input_content/
├── README.md
├── modulul_01_demo/
│   ├── module_meta.json
│   └── lectia_01/
│       ├── lesson.html            # Suport de curs (cu note profesor & exemple interactive)
│       ├── homework.html          # Temă (formulare de rezolvare fără soluții expuse)
│       └── grading_rules.json     # Bareme de notare și politici de reîncercare
```

---

## 2. Schema `module_meta.json`

```json
{
  "slug": "modulul-01",
  "title": "Modulul 1: Fundamente de Lingvistică și Morfologie",
  "description": "Descrierea modulului pentru elevi și profesori.",
  "order_index": 1,
  "is_published": true,
  "is_restricted": false
}
```

- `slug`: Identificator unic URL-friendly.
- `order_index`: Ordinea de afișare în bara laterală a platformei.
- `is_published`: `true` dacă elevii aprobați au acces la modul.
- `is_restricted`: `true` pentru a bloca temporar accesul elevilor (doar profesorii îl pot vedea).

---

## 3. Formatul `lesson.html`

Lecțiile sunt fișiere HTML de sine stătătoare. În timpul ingestiei (`scripts/ingest_content.py`):
1. **Notele profesorului** sunt extrase automat și salvate exclusiv în tabela securizată `public.lesson_teacher_notes`, fiind șterse definitiv din DOM-ul transmis elevilor.
   Elementele recunoscute ca note ale profesorului:
   - `[data-role="teacher"]`, `[data-teacher-only]`
   - `.teacher-only`, `.teacher-note`, `.teacher-notes`
   - `.nota-profesorului`, `.ghid-profesor`, `.barem-profesor`, `#teacher-panel`
2. **Exemplele interactive și butoanele de dezvăluire a soluțiilor** (`[data-action="toggle-solution"]`, `.btn-reveal-solution`) sunt **păstrate intacte**, permițând elevilor să exploreze exercițiile demonstrative din clasă.
3. Blocurile `<style>` și `<script>` inline sunt extrase și stocate izolat, fiind re-hidratate în pagină la vizualizare.

---

## 4. Formatul `homework.html`

Temele conțin enunțurile problemelor și controalele de formular (`<input>`, `<select>`, `<textarea>`).
- Fiecare câmp trebuie să dețină atributul `name="KEY"`, `data-question-key="KEY"` sau `id="KEY"`.
- Nu introduceți chei de răspuns în codul JavaScript client; acestea sunt evaluate exclusiv pe server în PostgreSQL.

---

## 5. Schema `grading_rules.json`

```json
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
          "hint": "Verifică segmentele din alfabet."
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
        },
        "q2_eseu": {
          "type": "manual_essay",
          "points": 20,
          "hint": "Va fi evaluat manual de către profesor."
        }
      }
    }
  ]
}
```

### Tipuri de reguli de notare server-side:
1. `exact_normalized`: Normalizează majusculele/diacriticele și spațiile albe, verificând egalitatea cu lista `accepted`.
2. `regex`: Validează intrarea printr-o expresie regulată POSIX case-insensitive (`~*`).
3. `levenshtein_tolerance`: Calculează distanța Levenshtein. Acordă `full_points` pentru distanță 0, `one_error_points` pentru distanță 1 (o literă diferită/lipsă), `0` altfel.
4. `keyword_rubric`: Acordă punctaje parțiale pe grupuri de cuvinte-cheie / rădăcini regăsite în textul argumentării. Marchează trimiterea cu `requires_teacher_review: true`.
5. `manual_essay`: 0 puncte inițiale, marcată automat pentru evaluare manuală de către profesor în Inspectorul de Dovezi.
