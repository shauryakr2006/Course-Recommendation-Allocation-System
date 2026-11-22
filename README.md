# Student Academic Performance & Course Recommendation System

**Course:** 24CS520 (Database Management Systems) / 24CS58L (DBMS Laboratory)  
**Institution:** Sri Jayachamarajendra College of Engineering (SJCE), JSS S&TU, Mysuru  
**Academic Semester:** V Semester B.E. (Computer Science & Engineering)  
**Scope:** Pure MySQL 8.0 relational database architecture, stored procedures, triggers, views, and integrity constraints.

---

## 1. Overview & Architecture

The **Student Academic Performance & Course Recommendation System** manages course recommendations and deterministic seat allocations for undergraduate elective courses. It decouples interest-based recommendation from seat allocation into two distinct phases:

1. **Phase 1: Tag-Based Shortlisting (Upstream View)**  
   Students express interest by ranking interest tags (*Programming*, *Scoring*, *Project-Based*, *Theory-Heavy*). The system intersects student tag preferences with course tag classifications and verifies that the student meets the minimum CGPA threshold (`cgpa >= min_cgpa_required`). The view `v_student_shortlist` presents each student with deduplicated, eligible courses ordered by their tag preference rank.

2. **Phase 2: Priority-Based Seat Allocation (Stored Procedures & Triggers)**  
   Students review their shortlist and submit ranked course choices (`student_course_preferences`). When demand exceeds course capacity (`max_allocations`), the database executes an automated allocation engine (`run_full_allocation_cycle()` and `allocate_courses()`) that prioritizes students based on academic merit, preference order, timestamp, and unique identifier.

---

## 2. Allocation Rules & Engine Logic (Plain English)

The seat allocation procedure follows strict, transparent, and deterministic rules:

### A. Cycle Idempotency
Whenever `CALL run_full_allocation_cycle();` is invoked:
- All previous records in `allocations` are deleted.
- All course `current_allocations` counters are reset to `0`.
- The procedure iterates sequentially through all courses in ascending order of `course_id`.

### B. Eligibility & Single Allotment Policy
- A student is eligible for seat allocation in a course only if:
  1. The student explicitly submitted a course preference for that course.
  2. The student's CGPA meets or exceeds the course's `min_cgpa_required`.
  3. The student does **not** already hold an `ALLOTTED` seat in any other course during the current allocation cycle.
- Students who submitted a preference for a course but fail the CGPA cutoff are immediately recorded with status **`REJECTED`**.

### C. Multi-Tier Ranking & Deterministic Tie-Breaking
When multiple eligible students compete for available seats in a course, they are ordered using `ROW_NUMBER()` according to four hierarchical criteria:
1. **Academic Merit (`cgpa DESC`):** Students with higher CGPA receive priority.
2. **Student Choice Priority (`preference_rank ASC`):** If CGPAs are tied, a student who selected the course as a higher choice (e.g., 1st choice vs. 2nd choice) wins the seat.
3. **Submission Timestamp (`submitted_at ASC`):** If CGPA and preference rank are tied, the earlier submission wins (first-come, first-served).
4. **Deterministic Tie-Breaker (`student_id ASC`):** If two submissions have identical CGPA, preference rank, and timestamp, the student with the lower `student_id` is allocated the seat. This guarantees that ties never share a rank and allocation outcomes are 100% reproducible.

### D. Seat Allocation & Waitlisting
- Available capacity is calculated as:  
  $$\text{available} = \text{max\_allocations} - \text{current\_allocations}$$
- Ranked candidates with $\text{rank} \le \text{available}$ receive the status **`ALLOTTED`**.
- Ranked candidates with $\text{rank} > \text{available}$ receive the status **`WAITLISTED`**.

### E. Known System Behavior (Dual Status)
A student can be `WAITLISTED` in an oversubscribed course of higher preference and subsequently become `ALLOTTED` in a lower preference course evaluated later in the cycle (for example, student Rohan Iyer is `WAITLISTED` in *24CS560 Cloud Computing* and `ALLOTTED` in *24CS570 Competitive Programming*). This is intentional by design to ensure students are not left without an elective seat when higher-preference courses are full.

### F. Trigger-Enforced Capacity Integrity
- **`trg_before_allocation_insert` (BEFORE INSERT on `allocations`):**  
  If an insert specifies `status = 'ALLOTTED'` and `current_allocations >= max_allocations`, the trigger raises an unhandled SQL exception (`SQLSTATE '45000'`) with the message `'Course full: cannot allot'`, preventing accidental over-allocation even from external direct inserts.
- **`trg_after_allocation_insert` (AFTER INSERT on `allocations`):**  
  When an `ALLOTTED` row is successfully inserted, the trigger automatically increments `courses.current_allocations` by 1.

---

## 3. How to Run the SQL Scripts

Execute the scripts in the following exact sequence using the MySQL Command-Line Client or MySQL Workbench:

### Prerequisites
- MySQL Server 8.0 or higher running on `localhost:3306`.
- A database user with `ALL PRIVILEGES` (e.g., `root`).

### Step 1: Initialize Database & Schema
Drops any existing database instance, creates the schema, tables, foreign keys, cascade rules, indexes, view, triggers, and stored procedures:
```bash
mysql -u root -p < schema.sql
```

### Step 2: Populate Sample Data
Loads the standardized test dataset (8 students, 4 courses, 4 tags, mappings, and initial student preferences):
```bash
mysql -u root -p < sample_data.sql
```

### Step 3: Run Allocation & Inspect Demo Queries
Executes `CALL run_full_allocation_cycle();`, queries course allocation results joined with student details, displays seat utilization, and shows the shortlist for Student 1:
```bash
mysql -u root -p < demo_queries.sql
```

### Step 4: Run the Complete Test Suite
Executes the comprehensive automated test suite (Tests A through I) validating table counts, CHECK constraints, foreign keys, boundary conditions, view correctness, trigger invariants, tie-breaking, and cascade deletes:
```bash
mysql -u root -p < tests.sql
```

---

## 4. Web Application & Interactive UI

An interactive web application is included in the `web/` folder. It connects directly to the live MySQL database:

- **Live Demo Sandbox (Tab 1 - 10 Students Cohort):** The primary interactive tab designed specifically for live viva presentations and laboratory examinations. Starts with a clean 10-student cohort by default:
  - **"+ Enter New Student" Modal:** Enroll a brand new student on the fly with custom CGPA, department, tag preferences, and course choices, automatically re-running the allocation procedures and displaying instant results.
  - **Inline CGPA Quick-Tuning (`+/- 0.1`):** Dynamically adjust any student's CGPA in single clicks to watch seat reallocations trigger in real-time.
  - **Edit & Cascade Delete:** Modify student choices or delete a student to prove database referential integrity (`ON DELETE CASCADE`).
  - **Pre-Configured Viva Scenarios:**
    - *Scenario 1 (Merit Elevation):* Boost Kabir Rao from 6.80 to 8.20 to qualify for Competitive Programming.
    - *Scenario 2 (Cutoff Boundary):* Drop Anika Joshi from 6.50 to 6.49 to trigger prerequisite cutoff rejection.
    - *Scenario 3 (Capacity Squeeze):* Enroll a high-merit student (Priya Sharma, CGPA 9.60) into Cloud Computing to demonstrate waitlisting existing applicants.
- **Interactive Dashboard:** Live seat capacity progress bars, KPI metric cards, and allocations table with real-time search, course filters, status filtering (`ALLOTTED`, `WAITLISTED`, `REJECTED`), and pagination.
- **Elective Course Catalog (14 Courses):** Comprehensive course directory covering AI/ML, Cloud & Distributed Systems, Cybersecurity, Web Engineering, Big Data, and Quantum Computing, with tag specialization filters and enrolled student rosters.
- **Student Directory & Shortlist Inspector (100 Students):** Searchable student roster with department and status filters. Select any student to inspect their declared tag interests, the dynamic output of `v_student_shortlist`, and their course choice rankings with allocation results.
- **Allocation Engine Walkthrough:** Clear visual explanation of the multi-tier ranking hierarchy (`cgpa DESC`, `preference_rank ASC`, `submitted_at ASC`, `student_id ASC`).
- **Live Trigger & Cutoff Playground:**
  - *Boundary Cutoff Test:* Toggle Anika Joshi's CGPA (6.50 vs. 6.49) to demonstrate reactive view filtering live.
  - *Trigger Capacity Guard:* One-click over-allocation attempt that triggers and displays the MySQL error (`45000: Course full: cannot allot`).
  - *Idempotent Run:* One-click execution of `CALL run_full_allocation_cycle()`.
- **Dataset Switcher:** Instant toggle between:
  - **10 Demo Students Dataset:** Focused 10-student experimentation sandbox for live demonstrations.
  - **100 Students Dataset:** 100 students, 14 specialized courses, 10 tags, 296 course preferences.
  - **Benchmark Lab Dataset:** 8 students, 4 courses, 4 tags for official 24CS520 / 24CS58L laboratory grading.
- **Schema & ER Diagram Viewer:** Embedded high-resolution ER diagram and table definitions.

### How to Launch the Web UI

Simply run one of the following:

- **Option A (Double-Click):** Double-click [start_web_app.bat](file:///d:/Progress%20Playground/Development/Full%20Stack/SQL/course_recommendation_system/start_web_app.bat) in the project root.
- **Option B (Command Line):**
  ```bash
  cd web
  python app.py
  ```
  Then open **http://localhost:5000** in your web browser.

---

## 5. Summary of Project Files

| File | Description |
| :--- | :--- |
| `schema.sql` | DDL script: Database creation, 7 normalized tables, 3 performance indexes, 1 shortlist view, 2 integrity triggers, and 2 stored procedures. |
| `dataset_10_students.sql` | Demo sandbox dataset: 10 students, 7 elective courses, 10 tags, and 17 course preferences tailored for live interactive viva experiments. |
| `dataset_100_students.sql` | Large-scale institutional dataset: 100 students, 14 diverse elective courses, 10 categories, 278 tag preferences, and 296 course applications. |
| `sample_data.sql` | Benchmark laboratory dataset: 8 students, 4 elective courses, 4 categorical tags, mappings, and preference rankings for strict test suite verification. |
| `demo_queries.sql` | Demonstration script: Executes the full allocation cycle and queries allocations, course capacities, and student shortlist. |
| `tests.sql` | Verification suite: Exhaustive tests A through I covering domain constraints, boundary values, trigger mechanics, idempotency, tie-breaking, and cascade operations. |
| `web/app.py` | Flask backend: REST APIs connecting directly to the live MySQL 8.0 server for real-time interactivity. |
| `web/templates/index.html` | Frontend UI: Modern Tailwind CSS application with course catalog, 100-student directory, search, pagination, and trigger playground. |
| `start_web_app.bat` | One-click launcher: Launches the web app and opens the browser to `http://localhost:5000`. |
| `er_diagram.svg` / `er_diagram.png` | Complete Entity-Relationship diagram illustrating entities, primary/foreign keys, attributes, and $1:N$ relationships. |
| `DBMS_Project_Report.docx` | Comprehensive formal laboratory mini-project report formatted for academic submission. |
