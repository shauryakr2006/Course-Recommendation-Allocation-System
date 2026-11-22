# Course Recommendation System — Codebase Reference

> Pure MySQL Relational DBMS · Flask Backend · Vanilla JS Frontend  
> No CDN dependencies. No ORM. Everything runs through the MySQL CLI binary.

---

## 1. Project File Tree

```
course_recommendation_system/
│
├── CODEBASE.md                   ← This file
├── README.md                     ← Quick-start / run instructions
├── README_DOCS.md                ← Extended documentation
├── start_web_app.bat             ← One-click launcher (root-level alias)
├── er_diagram.png                ← ER diagram image
├── er_diagram.svg                ← ER diagram vector
├── DBMS_Project_Report.docx      ← Project report
│
├── sql/                          ← All SQL files live here
│   ├── schema.sql                ← DROP + CREATE tables, views, triggers, procedures
│   ├── dataset_10_students.sql   ← Demo cohort (10 students, used in Demo Sandbox tab)
│   ├── dataset_100_students.sql  ← Full-scale dataset (100 students, 14 courses)
│   ├── tests.sql                 ← Verification queries for manual inspection
│   ├── demo_queries.sql          ← Useful ad-hoc queries for demonstration
│   └── sample_data.sql           ← Legacy benchmark data (archived, not used in UI)
│
└── web/                          ← Flask web application
    ├── app.py                    ← All backend routes + DB helpers
    ├── start_app.bat             ← Windows batch launcher
    ├── start_app.ps1             ← PowerShell launcher
    ├── templates/
    │   └── index.html            ← Single-page HTML shell (tab structure, modals)
    └── static/
        ├── css/
        │   └── main.css          ← All styling (no Tailwind, no external CSS)
        └── js/
            ├── app.js            ← All frontend logic (~975 lines)
            └── icons.js          ← Inline SVG icon helper (no icon CDN)
```

---

## 2. Technology Stack

```
┌─────────────────────────────────────────────────────────────┐
│  FRONTEND                                                   │
│  HTML5 · Vanilla JS (ES2020) · Custom CSS                   │
│  No frameworks. No CDNs. No build step needed.              │
├─────────────────────────────────────────────────────────────┤
│  BACKEND                                                    │
│  Python 3 + Flask                                           │
│  Talks to MySQL via subprocess → mysql CLI binary           │
│  No SQLAlchemy. No mysql-connector-python. Pure CLI calls.  │
├─────────────────────────────────────────────────────────────┤
│  DATABASE                                                   │
│  MySQL 8.0                                                  │
│  Stored Procedures · Triggers · Views · Constraints         │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Full HTTP Request Lifecycle

```
Browser                   Flask (app.py)              MySQL CLI (subprocess)
  │                           │                              │
  │  fetch('/api/overview')   │                              │
  │──────────────────────────▶│                              │
  │                           │  execute_mysql_query(sql)    │
  │                           │─────────────────────────────▶│
  │                           │   mysql -u root -pXXX        │
  │                           │   --batch --silent           │
  │                           │   -e "SELECT ..."            │
  │                           │◀─────────────────────────────│
  │                           │  parse tab-delimited output  │
  │                           │  → list of dicts             │
  │  JSON response            │                              │
  │◀──────────────────────────│                              │
  │                           │                              │
  │  JS updates DOM           │                              │
  │  (no page reload)         │                              │
```

**Two DB helper functions in `app.py`:**

| Function | Input | Output | Used for |
|---|---|---|---|
| `execute_mysql_query(sql)` | SQL string | `list[dict]` | SELECT queries |
| `execute_mysql_command(sql)` | SQL string | — (raises on error) | INSERT/UPDATE/DELETE/CALL |
| `execute_sql_file(path)` | File path | — | Load full `.sql` scripts (schema, datasets) |

---

## 4. Database Schema

### Tables

```
students
 ├── student_id    PK  AUTO_INCREMENT
 ├── name          VARCHAR(100)
 ├── roll_number   VARCHAR(20) UNIQUE
 ├── cgpa          DECIMAL(3,2)   CHECK (0.00–10.00)
 ├── email         VARCHAR(100) UNIQUE
 └── created_at    TIMESTAMP

courses
 ├── course_id         PK  AUTO_INCREMENT
 ├── course_code       VARCHAR(20) UNIQUE
 ├── course_name       VARCHAR(150)
 ├── course_type       ENUM('Core','Elective','Lab','Project')
 ├── credits           INT
 ├── max_allocations   INT
 ├── current_allocations  INT DEFAULT 0
 └── min_cgpa_required DECIMAL(3,2)

course_tags
 ├── tag_id    PK
 └── tag_name  VARCHAR(50) UNIQUE
                    Tags: Programming, Scoring, Project-Based,
                          Theory-Heavy, AI-ML, Web-Dev, Research-Oriented

course_tag_map
 ├── course_id   FK → courses
 └── tag_id      FK → course_tags
                    Maps courses to their informational tags
                    (not used in allocation logic)

student_tag_preferences
 ├── student_id  FK → students
 └── tag_id      FK → course_tags
                    Student's interest tags (informational only,
                    shown in Course Catalog for reference)

student_course_preferences
 ├── preference_id  PK
 ├── student_id     FK → students
 ├── course_id      FK → courses
 ├── preference_rank   INT (1 = top choice)
 └── submitted_at   TIMESTAMP
                    Min 2, Max 5 preferences per student.
                    This IS used in allocation logic.

allocations
 ├── allocation_id  PK
 ├── student_id     FK → students  UNIQUE (one course per student)
 ├── course_id      FK → courses
 ├── status         ENUM('ALLOTTED','WAITLISTED','NOT_ALLOTTED')
 ├── allocated_at   TIMESTAMP
 └── notes          TEXT
```

### Entity Relationships (ASCII)

```
students ──< student_course_preferences >── courses
   │                                           │
   └──< student_tag_preferences >──┐           │
                                   ▼           │
                              course_tags ─────┘
                                   │       course_tag_map
   students ──< allocations >── courses
```

### Views

```sql
v_student_shortlist
  -- Students eligible for each course (cgpa >= min_cgpa_required)
  -- Used as the input gate to the allocation engine
  SELECT student_id, course_id, preference_rank, submitted_at
  FROM   student_course_preferences scp
  JOIN   courses c ON scp.course_id = c.course_id
  JOIN   students s ON scp.student_id = s.student_id
  WHERE  s.cgpa >= c.min_cgpa_required
    AND  c.current_allocations < c.max_allocations
```

---

## 5. Stored Procedure Call Chain

```
run_full_allocation_cycle()          ← Entry point (called from /api/run-cycle)
 │
 ├─ TRUNCATE allocations             ← Fresh slate
 │
 ├─ LOOP over every course_id:
 │   └─ CALL allocate_courses(course_id)
 │        │
 │        └─ For each eligible student in shortlist (ranked, then merit order):
 │            ├─ Check: preference_rank ASC               (1st choice wins)
 │            ├─ Check: cgpa DESC                          (higher merit)
 │            ├─ Check: submitted_at ASC                   (earlier timestamp)
 │            └─ Check: student_id ASC                     (deterministic tiebreak)
 │            → INSERT INTO allocations (status='ALLOTTED')
 │
 └─ CALL allocate_unallotted_fallback()
      │
      └─ For each student NOT yet in allocations:
          └─ Find best available course (no preference needed):
              ├─ min_cgpa_required DESC  (most demanding they qualify for)
              ├─ credits DESC            (highest value)
              └─ course_id ASC           (deterministic)
              → INSERT INTO allocations (status='ALLOTTED', notes='Fallback')
```

### 4-Tier Tie-Breaking in `allocate_courses`

```
Tie-Break Tier   │  Column Used          │  Direction  │  Meaning
─────────────────┼───────────────────────┼─────────────┼─────────────────────────
1. Preference    │ preference_rank        │ ASC         │ Student's top choice wins
2. Academic Merit│ cgpa                   │ DESC        │ Higher GPA takes priority
3. Timestamp     │ submitted_at           │ ASC         │ Earlier submission wins
4. Deterministic │ student_id             │ ASC         │ Guarantees unique outcome
```

---

## 6. Triggers

### `trg_before_allocation_insert`
```
Fires: BEFORE INSERT on allocations (status = 'ALLOTTED')
Does:  Checks IF current_allocations >= max_allocations
       → SIGNAL SQLSTATE '45000' ("Course full: cannot allot")
Why:   Database-tier integrity. Even if app logic fails, DB enforces capacity.
```

### `trg_after_allocation_insert`
```
Fires: AFTER INSERT on allocations (status = 'ALLOTTED')
Does:  current_allocations = current_allocations + 1
Why:   Keeps the denormalized counter always in sync automatically.
```

---

## 7. Backend API Routes (`web/app.py`)

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| GET | `/` | `index()` | Serve the HTML shell |
| GET | `/api/status` | `api_status()` | DB connection health check |
| GET | `/api/overview` | `get_overview()` | Summary stats for metrics panel |
| GET | `/api/students` | `get_students()` | Full student roster |
| GET | `/api/student/<id>` | `get_student()` | Single student + allocation reason |
| GET | `/api/courses` | `get_courses()` | Course catalog with tag info |
| GET | `/api/tags` | `get_tags()` | All course tags |
| GET | `/api/allocations` | `get_allocations()` | All allocation records |
| POST | `/api/run-cycle` | `run_cycle()` | Trigger full allocation engine |
| GET | `/api/demo/students` | `get_demo_students()` | Demo sandbox student list |
| POST | `/api/demo/add-student` | `add_demo_student()` | Add a student (Demo tab) |
| POST | `/api/demo/update-student` | `update_demo_student()` | Edit a student (Demo tab) |
| POST | `/api/demo/delete-student` | `delete_demo_student()` | Remove a student (Demo tab) |
| POST | `/api/demo/reset-10-students` | `reset_10_students()` | Restore 10 demo students |
| POST | `/api/update-cgpa` | `update_cgpa()` | CGPA quick-update utility |
| POST | `/api/test-trigger` | `test_trigger()` | Demonstrate capacity trigger |
| POST | `/api/reset-database` | `reset_database()` | Full DB reset + load dataset |

---

## 8. Allocation Explanation Logic

After each cycle, every student gets a plain-English description of *why* they were placed:

```python
compute_allocation_explanation(student_id, allotted_course_code)
```

```
Was it their #1 course preference?
 └─ YES → "Preference Priority: Got their 1st-choice course [CODE]"

Was it their #2–#5 preference?
 └─ YES → "Preference Priority: Got their Nth-choice course [CODE]"

No preference match?
 └─ Is notes='Fallback'?
     ├─ YES → "Fallback Allocation: No preference matched; best available
     │          course by CGPA eligibility was assigned."
     └─ NO (tied in preference_rank by multiple students):
         ├─ Highest CGPA? → "Academic Merit: Outranked peers by CGPA (X.XX)"
         ├─ Earliest submit? → "Timestamp Audit: Earliest submission among tied students"
         └─ Lowest student_id? → "Deterministic Key: Final tiebreak by student record ID"
```

---

## 9. Frontend JavaScript (`web/static/js/app.js`)

### Module Map

```
app.js (~975 lines)
│
├── INIT & SHARED STATE
│   ├── allTags[]          ← loaded once from /api/tags
│   ├── allCourses[]        ← loaded once from /api/courses
│   ├── demoStudents[]      ← loaded from /api/demo/students
│   ├── allStudents[]       ← loaded from /api/students
│   ├── allAllocations[]    ← loaded from /api/allocations
│   └── currentDataset      ← '10_students' | '100_students'
│
├── DEMO SANDBOX TAB
│   ├── loadDemoStudents()          → fetch /api/demo/students
│   ├── renderDemoCohort()          → builds table rows with allotted badge + reason
│   ├── renderDemoCourseBars()      → fills seat-capacity progress bars
│   ├── openAddStudentModal()       → shows add-student form
│   ├── renderPreferenceRows()      → dynamic 2–5 preference dropdowns
│   ├── addPreferenceRow()          → adds a preference slot (max 5)
│   ├── removePreferenceRow()       → removes a preference slot (min 2)
│   ├── submitAddStudent()          → POST /api/demo/add-student
│   ├── openEditStudentModal()      → prefills edit form from demoStudents[]
│   ├── submitEditStudent()         → POST /api/demo/update-student
│   ├── deleteDemoStudent()         → POST /api/demo/delete-student
│   └── resetDemoTo10()             → POST /api/demo/reset-10-students
│
├── ALLOCATIONS & METRICS TAB
│   ├── loadOverview()              → fetch /api/overview → stat cards
│   ├── loadAllocations()           → fetch /api/allocations → paginated table
│   ├── onAllocSearchChange()       → filter allocations by name/course
│   ├── applyAllocFilters()         → filter by status dropdown
│   ├── renderAllocationsPage()     → renders current page of table
│   └── changeAllocPage()           → pagination controls
│
├── COURSE CATALOG TAB
│   ├── loadCoursesCatalog()        → fetch /api/courses → catalog cards
│   ├── filterCoursesByTag()        → tag-pill filter
│   └── renderCoursesCatalog()      → renders course cards with tag pills
│
├── STUDENT EXPLORER TAB
│   ├── loadStudentsList()          → fetch /api/students → roster list
│   ├── onStudentSearchChange()     → search filter
│   ├── renderStudentsRoster()      → list of student rows
│   └── selectStudent()             → fetch /api/student/<id> → profile panel
│
├── SYSTEM CONTROLS
│   ├── runAllocationCycle()        → POST /api/run-cycle
│   ├── switchDataset()             → POST /api/reset-database (with loading UI)
│   ├── refreshAllData()            → reloads all tabs
│   └── resetCurrentDatabase()      → re-runs reset for active dataset
│
└── UTILITIES
    ├── switchTab()                  → show/hide tab panels
    ├── showToast()                  → bottom-right notification
    ├── closeModal()                 → hides any open modal
    └── populateCourseDropdowns()    → fills preference <select> options
```

---

## 10. Frontend Tab → API Mapping

```
Tab Name                   │ JS Loader Function       │ API Endpoints Called
───────────────────────────┼──────────────────────────┼──────────────────────────────
Demo Sandbox               │ loadDemoStudents()        │ /api/demo/students
                           │                          │ /api/courses (for dropdowns)
Allocations & Metrics      │ loadOverview()           │ /api/overview
                           │ loadAllocations()        │ /api/allocations
Course Catalog             │ loadCoursesCatalog()     │ /api/courses
                           │                          │ /api/tags
Student Explorer           │ loadStudentsList()       │ /api/students
                           │ selectStudent()          │ /api/student/<id>
System Architecture        │ (static HTML content)    │ none
```

---

## 11. Key Configuration Variables

All in `web/app.py` lines 8–14:

```python
MYSQL_BIN  = r"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe"
DB_NAME    = "course_recommendation_system"
DB_USER    = "root"
DB_PASS    = "yummy"

PROJECT_ROOT = ...  # one level above web/app.py
SQL_DIR      = os.path.join(PROJECT_ROOT, "sql")  # all .sql files here
```

To change MySQL install location, password, or DB name → edit these 4 lines only.

---

## 12. Data Flow: "Run Allocation Cycle" Button

```
[User clicks Run Cycle]
       │
       ▼
runAllocationCycle()   (app.js)
       │
       ▼
POST /api/run-cycle    (app.py)
       │
       ▼
execute_mysql_command("CALL run_full_allocation_cycle();")
       │
       ▼  MySQL executes:
       ├─ TRUNCATE allocations
       ├─ LOOP: allocate_courses(course_id) × 14 courses
       │    └─ INSERT ALLOTTED rows via v_student_shortlist
       │       trg_before_allocation_insert fires: checks capacity
       │       trg_after_allocation_insert fires:  increments counter
       └─ allocate_unallotted_fallback()
            └─ INSERT ALLOTTED rows for unmatched students
       │
       ▼
Return JSON: { success, students_allocated, unallocated, courses_filled }
       │
       ▼
loadOverview() + loadAllocations() + loadDemoStudents()   (app.js)
       │
       ▼
UI re-renders with fresh allocation data
```

---

## 13. Dataset Switching Flow

```
[User selects "Full Scale (100 Students)"]
       │
       ▼
switchDataset('100_students')   (app.js)
       │
       ├─ Immediately clears tables → shows spinner + "Switching Dataset..."
       │
       ▼
POST /api/reset-database  { dataset: '100_students' }   (app.py)
       │
       ├─ execute_sql_file(sql/schema.sql)        ← DROP + recreate all tables
       ├─ execute_sql_file(sql/dataset_100_students.sql)  ← load 100 students
       └─ execute_mysql_command("CALL run_full_allocation_cycle();")
       │
       ▼
Return JSON: { success, students, allocated, ... }
       │
       ▼
refreshAllData()  → all 5 tabs re-fetch and re-render
```

---

## 14. Starter Ideas to Extend the Project

### Low Effort
| Feature | What to add |
|---|---|
| **Export allocations to CSV** | `/api/export-csv` route → returns `text/csv` response; JS triggers download |
| **Allocation run history** | New `allocation_runs` table: stores timestamp + stats per cycle |
| **Course capacity editor** | UI input to change `max_allocations` without touching the DB directly |
| **Student batch CSV import** | File upload → parse CSV → batch INSERT students |

### Medium Effort
| Feature | What to add |
|---|---|
| **Waitlist promotion** | `AFTER DELETE` trigger on allocations → promote top waitlisted student |
| **Admin login** | Flask `session`-based auth protecting all POST routes |
| **SVG bar charts** | Inline `<svg>` charts for CGPA distribution and fill rates (no Chart.js) |
| **Preference deadline** | `deadline` column on courses; view filters out expired preferences |

### Higher Complexity
| Feature | What to add |
|---|---|
| **Multi-semester support** | Add `semester_id` FK to allocations; run cycles per academic period |
| **Prerequisite chains** | `course_prerequisites(course_id, requires_course_id)` table; allocation checks completion |
| **Audit log table** | Log every INSERT/UPDATE/DELETE on students and allocations with `AFTER` triggers |
| **REST API versioning** | `/api/v1/` prefix + a `/api/docs` route returning Swagger-style JSON spec |

---

*Last updated: November 2026*
