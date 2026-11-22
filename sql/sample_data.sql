USE course_recommendation_system;

-- Students
INSERT INTO students (student_id, name, email, semester, department, cgpa) VALUES
(1, 'Aarav Shah', 'aarav@sjce.edu', 'V', 'CSE', 8.70),
(2, 'Diya Reddy', 'diya@sjce.edu', 'V', 'CSE', 9.10),
(3, 'Kabir Rao', 'kabir@sjce.edu', 'V', 'CSE', 6.80),
(4, 'Meera Nair', 'meera@sjce.edu', 'V', 'CSE', 7.95),
(5, 'Rohan Iyer', 'rohan@sjce.edu', 'V', 'CSE', 8.40),
(6, 'Sana Khan', 'sana@sjce.edu', 'V', 'CSE', 7.10),
(7, 'Vihaan Pillai', 'vihaan@sjce.edu', 'V', 'CSE', 9.40),
(8, 'Anika Joshi', 'anika@sjce.edu', 'V', 'CSE', 6.50);

-- Courses
INSERT INTO courses (course_id, course_code, course_name, credits, min_cgpa_required, max_allocations, current_allocations, department) VALUES
(1, '24CS540', 'Artificial Intelligence', 4, 7.00, 3, 0, 'CSE'),
(2, '24CS551', 'Image Processing', 3, 6.50, 4, 0, 'CSE'),
(3, '24CS560', 'Cloud Computing', 3, 7.50, 2, 0, 'CSE'),
(4, '24CS570', 'Competitive Programming', 2, 8.00, 3, 0, 'CSE');

-- Course Tags
INSERT INTO course_tags (tag_id, tag_name) VALUES
(1, 'Programming'),
(2, 'Scoring'),
(3, 'Project-Based'),
(4, 'Theory-Heavy');

-- Course Tag Map
INSERT INTO course_tag_map (course_id, tag_id) VALUES
(1, 3),
(1, 4),
(2, 3),
(2, 2),
(3, 1),
(3, 3),
(4, 1),
(4, 2);

-- Student Tag Preferences (student_id, tag_id, preference_rank)
INSERT INTO student_tag_preferences (student_id, tag_id, preference_rank) VALUES
(1, 1, 1), (1, 3, 2),
(2, 3, 1), (2, 4, 2),
(3, 2, 1), (3, 1, 2),
(4, 3, 1), (4, 2, 2),
(5, 1, 1), (5, 2, 2),
(6, 4, 1), (6, 3, 2),
(7, 1, 1), (7, 3, 2),
(8, 2, 1), (8, 3, 2);

-- Student Course Preferences (student_id, course_id, preference_rank)
INSERT INTO student_course_preferences (student_id, course_id, preference_rank) VALUES
(1, 3, 1),
(1, 4, 2),
(2, 1, 1),
(2, 2, 2),
(3, 4, 1),
(4, 2, 1),
(4, 1, 2),
(5, 3, 1),
(5, 4, 2),
(6, 1, 1),
(7, 3, 1),
(7, 4, 2),
(8, 2, 1);
