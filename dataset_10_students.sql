USE course_recommendation_system;

SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE allocations;
TRUNCATE TABLE student_course_preferences;
TRUNCATE TABLE student_tag_preferences;
TRUNCATE TABLE course_tag_map;
TRUNCATE TABLE course_tags;
TRUNCATE TABLE courses;
TRUNCATE TABLE students;
SET FOREIGN_KEY_CHECKS = 1;

-- Tags
INSERT INTO course_tags (tag_id, tag_name) VALUES
(1, 'Programming'),
(2, 'Scoring'),
(3, 'Project-Based'),
(4, 'Theory-Heavy'),
(5, 'AI-ML'),
(6, 'Systems'),
(7, 'Cybersecurity'),
(8, 'Data-Science'),
(9, 'Web-Dev'),
(10, 'Research-Oriented');

-- Courses
INSERT INTO courses (course_id, course_code, course_name, credits, min_cgpa_required, max_allocations, current_allocations, department) VALUES
(1, '24CS540', 'Artificial Intelligence', 4, 7.00, 3, 0, 'CSE'),
(2, '24CS551', 'Image Processing', 3, 6.50, 4, 0, 'CSE'),
(3, '24CS560', 'Cloud Computing', 3, 7.50, 2, 0, 'CSE'),
(4, '24CS570', 'Competitive Programming', 2, 8.00, 3, 0, 'CSE'),
(5, '24CS581', 'Deep Learning & Neural Networks', 4, 7.80, 3, 0, 'CSE'),
(6, '24CS582', 'Cyber Security & Ethical Hacking', 3, 6.80, 4, 0, 'CSE'),
(7, '24CS583', 'Full-Stack Web Development', 3, 6.00, 5, 0, 'CSE');

-- Course Tag Map
INSERT INTO course_tag_map (course_id, tag_id) VALUES
(1, 3),
(1, 4),
(1, 5),
(2, 3),
(2, 2),
(2, 5),
(3, 1),
(3, 3),
(3, 6),
(4, 1),
(4, 2),
(5, 1),
(5, 5),
(5, 10),
(6, 6),
(6, 7),
(6, 3),
(7, 1),
(7, 9),
(7, 3);

-- Students (10 Demo Students)
INSERT INTO students (student_id, name, email, semester, department, cgpa) VALUES
(1, 'Aarav Shah', 'aarav@sjce.edu', 'V', 'CSE', 8.70),
(2, 'Diya Reddy', 'diya@sjce.edu', 'V', 'CSE', 9.10),
(3, 'Kabir Rao', 'kabir@sjce.edu', 'V', 'CSE', 6.80),
(4, 'Meera Nair', 'meera@sjce.edu', 'V', 'CSE', 7.95),
(5, 'Rohan Iyer', 'rohan@sjce.edu', 'V', 'CSE', 8.40),
(6, 'Sana Khan', 'sana@sjce.edu', 'V', 'CSE', 7.10),
(7, 'Vihaan Pillai', 'vihaan@sjce.edu', 'V', 'CSE', 9.40),
(8, 'Anika Joshi', 'anika@sjce.edu', 'V', 'CSE', 6.50),
(9, 'Aditya Sharma', 'aditya@sjce.edu', 'V', 'CSE', 8.60),
(10, 'Sneha Gowda', 'sneha@sjce.edu', 'V', 'ISE', 7.40);

-- Student Tag Preferences
INSERT INTO student_tag_preferences (student_id, tag_id, preference_rank) VALUES
(1, 1, 1),
(1, 3, 2),
(2, 3, 1),
(2, 4, 2),
(3, 2, 1),
(3, 1, 2),
(4, 3, 1),
(4, 2, 2),
(5, 1, 1),
(5, 2, 2),
(6, 4, 1),
(6, 3, 2),
(7, 1, 1),
(7, 3, 2),
(8, 2, 1),
(8, 3, 2),
(9, 5, 1),
(9, 6, 2),
(10, 1, 1),
(10, 2, 2);

-- Student Course Preferences
INSERT INTO student_course_preferences (student_id, course_id, preference_rank, submitted_at) VALUES
(1, 3, 1, '2026-09-01 09:05:00'),
(1, 4, 2, '2026-09-01 09:10:00'),
(2, 1, 1, '2026-09-01 09:02:00'),
(2, 2, 2, '2026-09-01 09:08:00'),
(3, 4, 1, '2026-09-01 09:12:00'),
(4, 2, 1, '2026-09-01 09:15:00'),
(4, 1, 2, '2026-09-01 09:18:00'),
(5, 3, 1, '2026-09-01 09:04:00'),
(5, 4, 2, '2026-09-01 09:11:00'),
(6, 1, 1, '2026-09-01 09:07:00'),
(7, 3, 1, '2026-09-01 09:01:00'),
(7, 4, 2, '2026-09-01 09:06:00'),
(8, 2, 1, '2026-09-01 09:14:00'),
(9, 1, 1, '2026-09-01 09:03:00'),
(9, 3, 2, '2026-09-01 09:09:00'),
(10, 3, 1, '2026-09-01 09:16:00'),
(10, 2, 2, '2026-09-01 09:20:00');

-- Run Allocation
CALL run_full_allocation_cycle();
