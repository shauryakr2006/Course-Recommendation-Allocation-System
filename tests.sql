USE course_recommendation_system;

-- ============================================================================
-- TEST SUITE: Student Academic Performance & Course Recommendation System
-- Setup: Run schema.sql followed by sample_data.sql before running this file.
-- ============================================================================

-- Helper procedure to execute statements expecting a constraint/trigger error
DROP PROCEDURE IF EXISTS assert_sql_error;
DELIMITER //
CREATE PROCEDURE assert_sql_error(IN p_test_code VARCHAR(10), IN p_description VARCHAR(150), IN p_sql_statement VARCHAR(500))
BEGIN
    DECLARE v_error_caught INT DEFAULT 0;
    DECLARE CONTINUE HANDLER FOR SQLEXCEPTION, SQLWARNING SET v_error_caught = 1;
    
    SET @test_stmt = p_sql_statement;
    PREPARE stmt FROM @test_stmt;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
    
    IF v_error_caught = 1 THEN
        SELECT p_test_code AS test_id, p_description AS test_description, 'PASSED (Error raised as expected)' AS test_status;
    ELSE
        SELECT p_test_code AS test_id, p_description AS test_description, 'FAILED (Expected error was not raised)' AS test_status;
    END IF;
END //
DELIMITER ;

-- Ensure clean initial state (allocations cleared) as per setup prerequisite
DELETE FROM allocations;
UPDATE courses SET current_allocations = 0;


-- ============================================================================
-- TEST A: Entity Counts
-- Expected: students=8, courses=4, tags=4, preferences=13, allocations=0
-- ============================================================================
SELECT 'TEST A: Initial Table Row Counts' AS test_suite;
SELECT 
    (SELECT COUNT(*) FROM students) AS student_count,                       -- Expected: 8
    (SELECT COUNT(*) FROM courses) AS course_count,                         -- Expected: 4
    (SELECT COUNT(*) FROM course_tags) AS tag_count,                        -- Expected: 4
    (SELECT COUNT(*) FROM student_course_preferences) AS scp_count,         -- Expected: 13
    (SELECT COUNT(*) FROM allocations) AS allocation_count;                 -- Expected: 0


-- ============================================================================
-- TEST B: Constraints Verification (Each statement must raise an error)
-- ============================================================================
SELECT 'TEST B: Integrity & Domain Constraints' AS test_suite;

-- B1: CGPA > 10.00 check violation
-- Expected: CHECK constraint students_chk_1 failure (cgpa <= 10.00)
CALL assert_sql_error(
    'B.1', 
    'Reject CGPA > 10.00 (11.00)', 
    'INSERT INTO students (name, email, semester, department, cgpa) VALUES (''Invalid CGPA'', ''invalid_cgpa@sjce.edu'', ''V'', ''CSE'', 11.00)'
);

-- B2: Credits = 0 check violation
-- Expected: CHECK constraint courses_chk_1 failure (credits > 0)
CALL assert_sql_error(
    'B.2', 
    'Reject course credits = 0', 
    'INSERT INTO courses (course_code, course_name, credits, min_cgpa_required, max_allocations, department) VALUES (''24CS000'', ''Zero Credit Course'', 0, 7.00, 10, ''CSE'')'
);

-- B3: max_allocations = 0 check violation
-- Expected: CHECK constraint courses_chk_3 failure (max_allocations > 0)
CALL assert_sql_error(
    'B.3', 
    'Reject max_allocations = 0', 
    'INSERT INTO courses (course_code, course_name, credits, min_cgpa_required, max_allocations, department) VALUES (''24CS001'', ''Zero Capacity Course'', 3, 7.00, 0, ''CSE'')'
);

-- B4: preference_rank = 0 check violation
-- Expected: CHECK constraint student_course_preferences_chk_1 failure (preference_rank > 0)
CALL assert_sql_error(
    'B.4', 
    'Reject preference_rank = 0', 
    'INSERT INTO student_course_preferences (student_id, course_id, preference_rank) VALUES (1, 1, 0)'
);

-- B5: Duplicate email unique constraint violation
-- Expected: UNIQUE constraint violation on students.email
CALL assert_sql_error(
    'B.5', 
    'Reject duplicate student email', 
    'INSERT INTO students (name, email, semester, department, cgpa) VALUES (''Duplicate Aarav'', ''aarav@sjce.edu'', ''V'', ''CSE'', 8.50)'
);

-- B6: Duplicate composite primary key (student_id, course_id)
-- Expected: Duplicate entry violation on student_course_preferences.PRIMARY
CALL assert_sql_error(
    'B.6', 
    'Reject duplicate (student,course) preference pair', 
    'INSERT INTO student_course_preferences (student_id, course_id, preference_rank) VALUES (1, 3, 2)'
);

-- B7: Foreign key constraint violation (student_id 999 does not exist)
-- Expected: Foreign key constraint failure on student_course_preferences
CALL assert_sql_error(
    'B.7', 
    'Reject non-existent student_id (999)', 
    'INSERT INTO student_course_preferences (student_id, course_id, preference_rank) VALUES (999, 1, 1)'
);

-- B8: Invalid ENUM value for allocation status ('FOO')
-- Expected: ENUM truncation / invalid enum value rejection
CALL assert_sql_error(
    'B.8', 
    'Reject invalid status ENUM (FOO)', 
    'INSERT INTO allocations (student_id, course_id, status) VALUES (1, 1, ''FOO'')'
);


-- ============================================================================
-- TEST C: Boundary Values (Using Transaction & Rollback)
-- ============================================================================
SELECT 'TEST C: CGPA Boundary Validations' AS test_suite;

-- C1: Exact CGPA 10.00 must be accepted
-- Expected: Insert succeeds, record with cgpa = 10.00 found
START TRANSACTION;
INSERT INTO students (student_id, name, email, semester, department, cgpa) 
VALUES (100, 'Top Scorer', 'top@sjce.edu', 'V', 'CSE', 10.00);
SELECT student_id, name, cgpa, 'ACCEPTED' AS result 
FROM students 
WHERE student_id = 100;
ROLLBACK;

-- C2: Anika Joshi (id=8, CGPA=6.50) is in shortlist for Course 2 (min=6.50)
-- Expected: Exactly 1 row returned
SELECT student_id, student_name, course_id, course_code, tag_preference_rank, 'IN_SHORTLIST' AS expected_presence
FROM v_student_shortlist 
WHERE student_id = 8 AND course_id = 2;

-- C3: Lower Anika CGPA to 6.49; confirm Course 2 disappears from her shortlist
-- Expected: 0 rows returned
START TRANSACTION;
UPDATE students SET cgpa = 6.49 WHERE student_id = 8;
SELECT COUNT(*) AS anika_shortlist_count_at_6_49 -- Expected: 0
FROM v_student_shortlist 
WHERE student_id = 8 AND course_id = 2;
ROLLBACK;


-- ============================================================================
-- TEST D: View Shortlist Correctness & Distinctness
-- ============================================================================
SELECT 'TEST D: View Shortlist Filtering & Deduplication' AS test_suite;

-- D1: Kabir Rao (id=3, CGPA=6.80) should ONLY see course 2 (min 6.50)
-- Expected: Exactly 1 row (course_id = 2, 24CS551 Image Processing)
SELECT student_id, student_name, course_id, course_code, course_name, tag_preference_rank
FROM v_student_shortlist 
WHERE student_id = 3;

-- D2: Ensure no duplicate (student_id, course_id) rows exist across the entire view
-- Expected: Empty set (0 duplicates)
SELECT student_id, course_id, COUNT(*) AS duplicate_count
FROM v_student_shortlist
GROUP BY student_id, course_id
HAVING duplicate_count > 1;


-- ============================================================================
-- TEST E: Triggers Validation (Using Transaction & Rollback)
-- ============================================================================
SELECT 'TEST E: Trigger Invariants' AS test_suite;

-- E1: When current_allocations reaches max_allocations, BEFORE INSERT trigger blocks ALLOTTED
-- Expected: Signal 45000 'Course full: cannot allot'
START TRANSACTION;
UPDATE courses SET current_allocations = 4 WHERE course_id = 2;
CALL assert_sql_error(
    'E.1',
    'Trigger blocks ALLOTTED when course capacity is full',
    'INSERT INTO allocations (student_id, course_id, status) VALUES (1, 2, ''ALLOTTED'')'
);
ROLLBACK;

-- E2: Inserting ALLOTTED increments current_allocations by 1
-- Expected: Counter increments from 0 to 1
START TRANSACTION;
SELECT current_allocations AS c2_before_allot FROM courses WHERE course_id = 2;    -- Expected: 0
INSERT INTO allocations (student_id, course_id, status) VALUES (1, 2, 'ALLOTTED');
SELECT current_allocations AS c2_after_allot FROM courses WHERE course_id = 2;     -- Expected: 1
ROLLBACK;

-- E3: Inserting WAITLISTED leaves current_allocations unchanged
-- Expected: Counter remains at 0
START TRANSACTION;
SELECT current_allocations AS c2_before_waitlist FROM courses WHERE course_id = 2; -- Expected: 0
INSERT INTO allocations (student_id, course_id, status) VALUES (1, 2, 'WAITLISTED');
SELECT current_allocations AS c2_after_waitlist FROM courses WHERE course_id = 2;  -- Expected: 0
ROLLBACK;


-- ============================================================================
-- TEST F: Full Allocation Run
-- Expected allocations:
--   24CS540: Diya ALLOTTED, Meera ALLOTTED, Sana ALLOTTED
--   24CS551: Anika ALLOTTED
--   24CS560: Vihaan ALLOTTED, Aarav ALLOTTED, Rohan WAITLISTED
--   24CS570: Kabir REJECTED, Rohan ALLOTTED
-- Expected seat usage: 3, 1, 2, 1 for courses 1, 2, 3, 4
-- ============================================================================
SELECT 'TEST F: Execution of Full Allocation Cycle' AS test_suite;

CALL run_full_allocation_cycle();

-- Verify allocation rows ordered by course_code, status, and cgpa
SELECT 
    c.course_code,
    c.course_name,
    s.name AS student_name,
    s.cgpa,
    a.status
FROM allocations a
JOIN courses c ON a.course_id = c.course_id
JOIN students s ON a.student_id = s.student_id
ORDER BY c.course_code ASC, a.status ASC, s.cgpa DESC;

-- Verify seat usage matches 3, 1, 2, 1
SELECT 
    course_id,
    course_code,
    current_allocations,
    max_allocations
FROM courses
ORDER BY course_id ASC;


-- ============================================================================
-- TEST G: Idempotency Verification
-- Calling run_full_allocation_cycle() twice must produce identical state
-- ============================================================================
SELECT 'TEST G: Allocation Cycle Idempotency' AS test_suite;

-- First run already completed in TEST F. Trigger second run:
CALL run_full_allocation_cycle();

-- Verify counts and status match exactly
SELECT 
    status,
    COUNT(*) AS allocation_status_count
FROM allocations
GROUP BY status
ORDER BY status ASC;
-- Expected: ALLOTTED=7, REJECTED=1, WAITLISTED=1 (Total 9)

SELECT 
    course_id,
    course_code,
    current_allocations
FROM courses
ORDER BY course_id ASC;
-- Expected: 3, 1, 2, 1


-- ============================================================================
-- TEST H: Deterministic Tie Breaking
-- Two students with identical CGPA and timestamp competing for 1 seat.
-- Expected: student_id tie-breaker decides; 1 ALLOTTED, 1 WAITLISTED.
-- ============================================================================
SELECT 'TEST H: Deterministic Tie Break Resolution' AS test_suite;

START TRANSACTION;
-- Insert a dedicated test course with 1 seat
INSERT INTO courses (course_id, course_code, course_name, credits, min_cgpa_required, max_allocations, current_allocations, department)
VALUES (99, '24CSTIE', 'Tie Break Course', 3, 7.00, 1, 0, 'CSE');

-- Insert two students with exact same CGPA (8.50)
INSERT INTO students (student_id, name, email, semester, department, cgpa)
VALUES (901, 'Tie Student A', 'tie_a@sjce.edu', 'V', 'CSE', 8.50),
       (902, 'Tie Student B', 'tie_b@sjce.edu', 'V', 'CSE', 8.50);

-- Insert preferences with exact same rank and identical timestamp
INSERT INTO student_course_preferences (student_id, course_id, preference_rank, submitted_at)
VALUES (901, 99, 1, '2026-09-01 10:00:00'),
       (902, 99, 1, '2026-09-01 10:00:00');

-- Allocate single seat for course 99
CALL allocate_courses(99);

-- Verify: Student 901 (lower student_id) is ALLOTTED, Student 902 is WAITLISTED
SELECT 
    a.student_id, 
    s.name, 
    s.cgpa, 
    scp.submitted_at, 
    a.status
FROM allocations a 
JOIN students s ON a.student_id = s.student_id 
JOIN student_course_preferences scp ON a.student_id = scp.student_id AND a.course_id = scp.course_id
WHERE a.course_id = 99
ORDER BY a.status ASC;

ROLLBACK;


-- ============================================================================
-- TEST I: ON DELETE CASCADE Verification
-- Delete student 3 -> preferences and allocations disappear.
-- Delete course 4 -> preferences, allocations, and tag links disappear.
-- ============================================================================
SELECT 'TEST I: Referential Integrity ON DELETE CASCADE' AS test_suite;

START TRANSACTION;
-- Ensure allocation data is active
CALL run_full_allocation_cycle();

-- Verify presence before delete
SELECT 
    (SELECT COUNT(*) FROM student_tag_preferences WHERE student_id = 3) AS stp_before_del3,
    (SELECT COUNT(*) FROM student_course_preferences WHERE student_id = 3) AS scp_before_del3,
    (SELECT COUNT(*) FROM allocations WHERE student_id = 3) AS alloc_before_del3;

-- Delete student 3
DELETE FROM students WHERE student_id = 3;

-- Verify cascade cleanup for student 3 (Expected: 0, 0, 0)
SELECT 
    (SELECT COUNT(*) FROM student_tag_preferences WHERE student_id = 3) AS stp_after_del3,
    (SELECT COUNT(*) FROM student_course_preferences WHERE student_id = 3) AS scp_after_del3,
    (SELECT COUNT(*) FROM allocations WHERE student_id = 3) AS alloc_after_del3;

-- Verify presence before course 4 delete
SELECT 
    (SELECT COUNT(*) FROM course_tag_map WHERE course_id = 4) AS ctm_before_del4,
    (SELECT COUNT(*) FROM student_course_preferences WHERE course_id = 4) AS scp_before_del4,
    (SELECT COUNT(*) FROM allocations WHERE course_id = 4) AS alloc_before_del4;

-- Delete course 4
DELETE FROM courses WHERE course_id = 4;

-- Verify cascade cleanup for course 4 (Expected: 0, 0, 0)
SELECT 
    (SELECT COUNT(*) FROM course_tag_map WHERE course_id = 4) AS ctm_after_del4,
    (SELECT COUNT(*) FROM student_course_preferences WHERE course_id = 4) AS scp_after_del4,
    (SELECT COUNT(*) FROM allocations WHERE course_id = 4) AS alloc_after_del4;

ROLLBACK;

-- Clean up helper procedure
DROP PROCEDURE IF EXISTS assert_sql_error;

-- Re-run allocation cycle to restore clean state
CALL run_full_allocation_cycle();
