USE course_recommendation_system;

-- 1. Execute the full course allocation cycle
CALL run_full_allocation_cycle();

-- 2. Allocation result join query ordered by course_code and status
SELECT 
    c.course_code,
    c.course_name,
    s.student_id,
    s.name AS student_name,
    s.cgpa,
    a.status,
    a.allocated_at
FROM allocations a
JOIN courses c ON a.course_id = c.course_id
JOIN students s ON a.student_id = s.student_id
ORDER BY c.course_code ASC, a.status ASC, s.cgpa DESC;

-- 3. Course seat usage query
SELECT 
    course_id,
    course_code,
    course_name,
    current_allocations,
    max_allocations,
    (max_allocations - current_allocations) AS seats_remaining
FROM courses
ORDER BY course_id ASC;

-- 4. View shortlisted courses for student 1 (Aarav Shah)
SELECT 
    student_id,
    student_name,
    course_id,
    course_code,
    course_name,
    tag_preference_rank
FROM v_student_shortlist
WHERE student_id = 1
ORDER BY tag_preference_rank ASC;
