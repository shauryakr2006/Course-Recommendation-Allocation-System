-- Database initialization
DROP DATABASE IF EXISTS course_recommendation_system;
CREATE DATABASE course_recommendation_system;
USE course_recommendation_system;

-- Students table
CREATE TABLE students (
    student_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    semester VARCHAR(10) NOT NULL,
    department VARCHAR(50) NOT NULL,
    cgpa DECIMAL(4,2) NOT NULL CHECK (cgpa >= 0.00 AND cgpa <= 10.00)
);

-- Courses table
CREATE TABLE courses (
    course_id INT AUTO_INCREMENT PRIMARY KEY,
    course_code VARCHAR(20) NOT NULL UNIQUE,
    course_name VARCHAR(100) NOT NULL,
    credits INT NOT NULL CHECK (credits > 0),
    min_cgpa_required DECIMAL(4,2) NOT NULL CHECK (min_cgpa_required >= 0.00 AND min_cgpa_required <= 10.00),
    max_allocations INT NOT NULL CHECK (max_allocations > 0),
    current_allocations INT NOT NULL DEFAULT 0 CHECK (current_allocations >= 0),
    department VARCHAR(50) NOT NULL
);

-- Course tags table
CREATE TABLE course_tags (
    tag_id INT AUTO_INCREMENT PRIMARY KEY,
    tag_name VARCHAR(50) NOT NULL UNIQUE
);

-- Course tag mapping table
CREATE TABLE course_tag_map (
    course_id INT NOT NULL,
    tag_id INT NOT NULL,
    PRIMARY KEY (course_id, tag_id),
    FOREIGN KEY (course_id) REFERENCES courses(course_id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES course_tags(tag_id) ON DELETE CASCADE
);

-- Student tag preferences table
CREATE TABLE student_tag_preferences (
    student_id INT NOT NULL,
    tag_id INT NOT NULL,
    preference_rank INT NOT NULL CHECK (preference_rank > 0),
    PRIMARY KEY (student_id, tag_id),
    FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES course_tags(tag_id) ON DELETE CASCADE
);

-- Student course preferences table
CREATE TABLE student_course_preferences (
    student_id INT NOT NULL,
    course_id INT NOT NULL,
    preference_rank INT NOT NULL CHECK (preference_rank > 0),
    submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (student_id, course_id),
    FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES courses(course_id) ON DELETE CASCADE
);

-- Course seat allocations table
CREATE TABLE allocations (
    allocation_id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL,
    course_id INT NOT NULL,
    status ENUM('ALLOTTED', 'WAITLISTED', 'REJECTED') NOT NULL,
    allocated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_student_course (student_id, course_id),
    FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES courses(course_id) ON DELETE CASCADE
);

-- Index on student course preferences course_id
CREATE INDEX idx_scp_course_id ON student_course_preferences(course_id);

-- Index on allocations student_id
CREATE INDEX idx_allocations_student_id ON allocations(student_id);

-- Index on allocations course_id
CREATE INDEX idx_allocations_course_id ON allocations(course_id);

-- View for student course shortlist based on tag preferences and CGPA cutoff
CREATE OR REPLACE VIEW v_student_shortlist AS
SELECT 
    s.student_id,
    s.name AS student_name,
    c.course_id,
    c.course_code,
    c.course_name,
    MIN(stp.preference_rank) AS tag_preference_rank
FROM students s
JOIN student_tag_preferences stp ON s.student_id = stp.student_id
JOIN course_tag_map ctm ON stp.tag_id = ctm.tag_id
JOIN courses c ON ctm.course_id = c.course_id
WHERE s.cgpa >= c.min_cgpa_required
GROUP BY s.student_id, s.name, c.course_id, c.course_code, c.course_name
ORDER BY s.student_id ASC, tag_preference_rank ASC;

-- Trigger to validate seat capacity before inserting an allotted allocation
DELIMITER //
CREATE TRIGGER trg_before_allocation_insert
BEFORE INSERT ON allocations
FOR EACH ROW
BEGIN
    DECLARE v_current INT;
    DECLARE v_max INT;

    IF NEW.status = 'ALLOTTED' THEN
        SELECT current_allocations, max_allocations
        INTO v_current, v_max
        FROM courses
        WHERE course_id = NEW.course_id;

        IF v_current >= v_max THEN
            SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Course full: cannot allot';
        END IF;
    END IF;
END //
DELIMITER ;

-- Trigger to increment current allocations after inserting an allotted allocation
DELIMITER //
CREATE TRIGGER trg_after_allocation_insert
AFTER INSERT ON allocations
FOR EACH ROW
BEGIN
    IF NEW.status = 'ALLOTTED' THEN
        UPDATE courses
        SET current_allocations = current_allocations + 1
        WHERE course_id = NEW.course_id;
    END IF;
END //
DELIMITER ;

-- Procedure to allocate seats for a single course
DELIMITER //
CREATE PROCEDURE allocate_courses(IN p_course_id INT)
BEGIN
    DECLARE v_max INT;
    DECLARE v_current INT;
    DECLARE v_available INT;
    DECLARE v_min_cgpa DECIMAL(4,2);

    SELECT max_allocations, current_allocations, min_cgpa_required
    INTO v_max, v_current, v_min_cgpa
    FROM courses
    WHERE course_id = p_course_id;

    SET v_available = v_max - v_current;

    INSERT INTO allocations (student_id, course_id, status)
    SELECT 
        ranked.student_id,
        p_course_id,
        CASE 
            WHEN ranked.rn <= v_available THEN 'ALLOTTED'
            ELSE 'WAITLISTED'
        END AS status
    FROM (
        SELECT 
            s.student_id,
            ROW_NUMBER() OVER (
                ORDER BY s.cgpa DESC, scp.preference_rank ASC, scp.submitted_at ASC, s.student_id ASC
            ) AS rn
        FROM student_course_preferences scp
        JOIN students s ON scp.student_id = s.student_id
        WHERE scp.course_id = p_course_id
          AND s.cgpa >= v_min_cgpa
          AND s.student_id NOT IN (
              SELECT a.student_id 
              FROM allocations a 
              WHERE a.status = 'ALLOTTED'
          )
    ) ranked
    ORDER BY ranked.rn ASC;

    INSERT INTO allocations (student_id, course_id, status)
    SELECT 
        s.student_id,
        p_course_id,
        'REJECTED'
    FROM student_course_preferences scp
    JOIN students s ON scp.student_id = s.student_id
    WHERE scp.course_id = p_course_id
      AND s.cgpa < v_min_cgpa
    ORDER BY s.student_id ASC;
END //
DELIMITER ;

-- Procedure to execute an idempotent full allocation cycle across all courses
DELIMITER //
CREATE PROCEDURE run_full_allocation_cycle()
BEGIN
    DECLARE done INT DEFAULT FALSE;
    DECLARE v_cid INT;
    DECLARE cur_courses CURSOR FOR 
        SELECT course_id FROM courses ORDER BY course_id ASC;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    DELETE FROM allocations;
    UPDATE courses SET current_allocations = 0;

    OPEN cur_courses;
    read_loop: LOOP
        FETCH cur_courses INTO v_cid;
        IF done THEN
            LEAVE read_loop;
        END IF;
        CALL allocate_courses(v_cid);
    END LOOP;
    CLOSE cur_courses;
END //
DELIMITER ;
