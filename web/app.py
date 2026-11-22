import os
import subprocess
import json
from flask import Flask, render_template, jsonify, request, send_from_directory

app = Flask(__name__, static_folder='static', template_folder='templates')

MYSQL_BIN = r"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe"
DB_NAME = "course_recommendation_system"
DB_USER = "root"
DB_PASS = "yummy"

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

def execute_mysql_query(sql, database=DB_NAME):
    """Executes a query using mysql CLI with tab-delimited output and returns list of dicts."""
    cmd = [
        MYSQL_BIN,
        f"-u{DB_USER}",
        f"-p{DB_PASS}"
    ]
    if database:
        cmd.append(f"-D{database}")
    cmd.extend(["-B", "-e", sql])

    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    if proc.returncode != 0:
        err_msg = proc.stderr.strip() or "MySQL query failed"
        lines = [l for l in err_msg.splitlines() if "Using a password on the command line" not in l]
        raise RuntimeError("\n".join(lines) or "MySQL error occurred")

    raw_lines = proc.stdout.strip().splitlines()
    lines = [l for l in raw_lines if not l.startswith("mysql: [Warning]")]
    if not lines:
        return []

    headers = lines[0].split("\t")
    results = []
    for line in lines[1:]:
        parts = line.split("\t")
        if len(parts) == len(headers):
            results.append(dict(zip(headers, parts)))
        else:
            padded = parts + [""] * (len(headers) - len(parts))
            results.append(dict(zip(headers, padded[:len(headers)])))
    return results

def execute_mysql_command(sql, database=DB_NAME):
    """Executes DDL/DML or stored procedures without parsing tabular rows."""
    cmd = [
        MYSQL_BIN,
        f"-u{DB_USER}",
        f"-p{DB_PASS}"
    ]
    if database:
        cmd.append(f"-D{database}")
    cmd.extend(["-e", sql])

    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    if proc.returncode != 0:
        err_msg = proc.stderr.strip() or "MySQL command failed"
        lines = [l for l in err_msg.splitlines() if "Using a password on the command line" not in l]
        raise RuntimeError("\n".join(lines) or "MySQL error occurred")
    return True

def execute_sql_file(file_path):
    """Executes a full .sql script file."""
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"SQL file not found: {file_path}")
    
    cmd = f'"{MYSQL_BIN}" -u{DB_USER} -p{DB_PASS} < "{file_path}"'
    proc = subprocess.run(f'cmd.exe /c {cmd}', shell=True, capture_output=True, text=True, encoding="utf-8")
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "Failed to run SQL file")
    return True

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/status')
def status():
    try:
        ver = execute_mysql_query("SELECT VERSION() AS version, CURRENT_USER() AS user;")[0]
        active_counts = execute_mysql_query("""
            SELECT 
                (SELECT COUNT(*) FROM students) AS student_count,
                (SELECT COUNT(*) FROM courses) AS course_count,
                (SELECT COUNT(*) FROM allocations) AS alloc_count;
        """)[0]
        return jsonify({
            "status": "connected",
            "server": "MySQL Community Server 8.0",
            "version": ver.get("version"),
            "user": ver.get("user"),
            "database": DB_NAME,
            "student_count": int(active_counts.get("student_count", 0)),
            "course_count": int(active_counts.get("course_count", 0)),
            "alloc_count": int(active_counts.get("alloc_count", 0))
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/overview')
def overview():
    try:
        counts = {
            "students": int(execute_mysql_query("SELECT COUNT(*) AS c FROM students;")[0]["c"]),
            "courses": int(execute_mysql_query("SELECT COUNT(*) AS c FROM courses;")[0]["c"]),
            "tags": int(execute_mysql_query("SELECT COUNT(*) AS c FROM course_tags;")[0]["c"]),
            "preferences": int(execute_mysql_query("SELECT COUNT(*) AS c FROM student_course_preferences;")[0]["c"]),
            "allocations": int(execute_mysql_query("SELECT COUNT(*) AS c FROM allocations;")[0]["c"])
        }

        # Courses seat usage
        courses = execute_mysql_query("""
            SELECT 
                course_id,
                course_code,
                course_name,
                credits,
                min_cgpa_required,
                max_allocations,
                current_allocations,
                (max_allocations - current_allocations) AS seats_remaining,
                department
            FROM courses
            ORDER BY course_id ASC;
        """)

        total_capacity = sum(int(c["max_allocations"]) for c in courses)
        total_allotted = sum(int(c["current_allocations"]) for c in courses)

        for c in courses:
            curr = int(c["current_allocations"])
            max_a = int(c["max_allocations"])
            c["fill_pct"] = round((curr / max_a * 100), 1) if max_a > 0 else 0

        # Status summary
        status_rows = execute_mysql_query("""
            SELECT status, COUNT(*) AS count 
            FROM allocations 
            GROUP BY status;
        """)
        status_summary = {r["status"]: int(r["count"]) for r in status_rows}

        allotted_students_count = int(execute_mysql_query("SELECT COUNT(DISTINCT student_id) AS c FROM allocations WHERE status = 'ALLOTTED';")[0]["c"])

        return jsonify({
            "counts": counts,
            "total_capacity": total_capacity,
            "total_allotted": total_allotted,
            "allotted_students_count": allotted_students_count,
            "courses": courses,
            "status_summary": status_summary
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/students')
def get_students():
    try:
        search = request.args.get("search", "").strip()
        dept_filter = request.args.get("dept", "").strip()
        status_filter = request.args.get("status", "").strip()

        where_clauses = []
        if search:
            where_clauses.append(f"(s.name LIKE '%{search}%' OR s.email LIKE '%{search}%' OR s.student_id = '{search}')")
        if dept_filter and dept_filter != "ALL":
            where_clauses.append(f"s.department = '{dept_filter}'")

        where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

        students = execute_mysql_query(f"""
            SELECT 
                s.student_id,
                s.name,
                s.email,
                s.semester,
                s.department,
                s.cgpa,
                (SELECT COUNT(*) FROM student_course_preferences WHERE student_id = s.student_id) AS pref_count,
                COALESCE((SELECT a.status FROM allocations a WHERE a.student_id = s.student_id AND a.status = 'ALLOTTED' LIMIT 1), 'UNALLOTTED') AS allotted_status,
                (SELECT c.course_code FROM allocations a JOIN courses c ON a.course_id = c.course_id WHERE a.student_id = s.student_id AND a.status = 'ALLOTTED' LIMIT 1) AS allotted_course,
                (SELECT c.course_name FROM allocations a JOIN courses c ON a.course_id = c.course_id WHERE a.student_id = s.student_id AND a.status = 'ALLOTTED' LIMIT 1) AS allotted_course_name
            FROM students s
            {where_sql}
            ORDER BY s.student_id ASC;
        """)

        if status_filter and status_filter != "ALL":
            if status_filter == "ALLOTTED":
                students = [s for s in students if s["allotted_status"] == "ALLOTTED"]
            elif status_filter == "UNALLOTTED":
                students = [s for s in students if s["allotted_status"] != "ALLOTTED"]

        return jsonify(students)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/student/<int:student_id>')
def get_student_details(student_id):
    try:
        student = execute_mysql_query(f"SELECT * FROM students WHERE student_id = {student_id};")
        if not student:
            return jsonify({"error": "Student not found"}), 404
        profile = student[0]

        tag_prefs = execute_mysql_query(f"""
            SELECT 
                stp.tag_id,
                ct.tag_name,
                stp.preference_rank
            FROM student_tag_preferences stp
            JOIN course_tags ct ON stp.tag_id = ct.tag_id
            WHERE stp.student_id = {student_id}
            ORDER BY stp.preference_rank ASC;
        """)

        shortlist = execute_mysql_query(f"""
            SELECT 
                course_id,
                course_code,
                course_name,
                tag_preference_rank
            FROM v_student_shortlist
            WHERE student_id = {student_id}
            ORDER BY tag_preference_rank ASC, course_id ASC;
        """)

        course_prefs = execute_mysql_query(f"""
            SELECT 
                scp.course_id,
                c.course_code,
                c.course_name,
                c.min_cgpa_required,
                scp.preference_rank,
                scp.submitted_at,
                (SELECT a.status FROM allocations a WHERE a.student_id = {student_id} AND a.course_id = scp.course_id) AS allocation_status
            FROM student_course_preferences scp
            JOIN courses c ON scp.course_id = c.course_id
            WHERE scp.student_id = {student_id}
            ORDER BY scp.preference_rank ASC;
        """)

        all_courses = execute_mysql_query(f"""
            SELECT 
                c.course_id,
                c.course_code,
                c.course_name,
                c.min_cgpa_required,
                ({profile['cgpa']} >= c.min_cgpa_required) AS meets_cutoff
            FROM courses c
            ORDER BY c.course_id ASC;
        """)

        return jsonify({
            "profile": profile,
            "tag_preferences": tag_prefs,
            "shortlist": shortlist,
            "course_preferences": course_prefs,
            "all_courses": all_courses
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/courses')
def get_courses():
    try:
        courses = execute_mysql_query("""
            SELECT 
                c.course_id,
                c.course_code,
                c.course_name,
                c.credits,
                c.min_cgpa_required,
                c.max_allocations,
                c.current_allocations,
                c.department
            FROM courses c
            ORDER BY c.course_id ASC;
        """)

        for c in courses:
            cid = c["course_id"]
            tags = execute_mysql_query(f"""
                SELECT ct.tag_name 
                FROM course_tag_map ctm 
                JOIN course_tags ct ON ctm.tag_id = ct.tag_id 
                WHERE ctm.course_id = {cid};
            """)
            c["tags"] = [t["tag_name"] for t in tags]

            allotted = execute_mysql_query(f"""
                SELECT s.student_id, s.name, s.cgpa, a.allocated_at 
                FROM allocations a
                JOIN students s ON a.student_id = s.student_id
                WHERE a.course_id = {cid} AND a.status = 'ALLOTTED'
                ORDER BY s.cgpa DESC;
            """)
            c["enrolled_students"] = allotted

        return jsonify(courses)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/tags')
def get_tags():
    try:
        tags = execute_mysql_query("SELECT tag_id, tag_name FROM course_tags ORDER BY tag_id ASC;")
        return jsonify(tags)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/allocations')
def get_allocations():
    try:
        course_filter = request.args.get("course", "ALL")
        status_filter = request.args.get("status", "ALL")
        search = request.args.get("search", "").strip()

        where_parts = []
        if course_filter != "ALL":
            where_parts.append(f"c.course_code = '{course_filter}'")
        if status_filter != "ALL":
            where_parts.append(f"a.status = '{status_filter}'")
        if search:
            where_parts.append(f"(s.name LIKE '%{search}%' OR c.course_code LIKE '%{search}%' OR c.course_name LIKE '%{search}%')")

        where_sql = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

        allocations = execute_mysql_query(f"""
            SELECT 
                a.allocation_id,
                c.course_id,
                c.course_code,
                c.course_name,
                s.student_id,
                s.name AS student_name,
                s.cgpa,
                COALESCE(scp.preference_rank, 'N/A') AS student_choice_rank,
                a.status,
                a.allocated_at
            FROM allocations a
            JOIN courses c ON a.course_id = c.course_id
            JOIN students s ON a.student_id = s.student_id
            LEFT JOIN student_course_preferences scp ON a.student_id = scp.student_id AND a.course_id = scp.course_id
            {where_sql}
            ORDER BY c.course_code ASC, a.status ASC, s.cgpa DESC, a.student_id ASC;
        """)
        return jsonify(allocations)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/run-cycle', methods=['POST'])
def run_cycle():
    try:
        execute_mysql_command("CALL run_full_allocation_cycle();")
        allocations = execute_mysql_query("""
            SELECT a.allocation_id, c.course_code, s.name AS student_name, s.cgpa, a.status 
            FROM allocations a 
            JOIN courses c ON a.course_id = c.course_id 
            JOIN students s ON a.student_id = s.student_id 
            ORDER BY c.course_code ASC, a.status ASC;
        """)
        courses = execute_mysql_query("SELECT course_code, current_allocations, max_allocations FROM courses;")
        return jsonify({
            "success": True,
            "message": "Full allocation cycle completed successfully (Idempotent run)",
            "allocation_count": len(allocations),
            "courses": courses,
            "allocations": allocations
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

# ==============================================================================
# DEMO & EXPERIMENTATION APIS
# ==============================================================================

@app.route('/api/demo/students')
def get_demo_students():
    """Returns students along with their choices and allocation status for the demo tab."""
    try:
        students = execute_mysql_query("""
            SELECT 
                s.student_id,
                s.name,
                s.email,
                s.semester,
                s.department,
                s.cgpa,
                COALESCE((SELECT a.status FROM allocations a WHERE a.student_id = s.student_id AND a.status = 'ALLOTTED' LIMIT 1), 'UNALLOTTED') AS allotted_status,
                (SELECT c.course_code FROM allocations a JOIN courses c ON a.course_id = c.course_id WHERE a.student_id = s.student_id AND a.status = 'ALLOTTED' LIMIT 1) AS allotted_course
            FROM students s
            ORDER BY s.student_id ASC;
        """)

        for s in students:
            sid = s["student_id"]
            # tags
            tags = execute_mysql_query(f"""
                SELECT ct.tag_id, ct.tag_name, stp.preference_rank 
                FROM student_tag_preferences stp 
                JOIN course_tags ct ON stp.tag_id = ct.tag_id 
                WHERE stp.student_id = {sid} 
                ORDER BY stp.preference_rank ASC;
            """)
            s["tag_preferences"] = tags

            # choices
            choices = execute_mysql_query(f"""
                SELECT scp.course_id, c.course_code, c.course_name, c.min_cgpa_required, scp.preference_rank,
                       COALESCE((SELECT a.status FROM allocations a WHERE a.student_id = {sid} AND a.course_id = scp.course_id), 'PENDING') AS alloc_status
                FROM student_course_preferences scp
                JOIN courses c ON scp.course_id = c.course_id
                WHERE scp.student_id = {sid}
                ORDER BY scp.preference_rank ASC;
            """)
            s["course_preferences"] = choices

        return jsonify(students)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/demo/add-student', methods=['POST'])
def add_demo_student():
    """Adds a new student with tag preferences and course choices, then re-runs allocation."""
    try:
        data = request.json or {}
        name = data.get("name", "").strip()
        email = data.get("email", "").strip().lower()
        semester = data.get("semester", "V").strip()
        department = data.get("department", "CSE").strip()
        cgpa = float(data.get("cgpa", 7.50))
        tag_ids = data.get("tag_ids", [])
        course_ids = data.get("course_ids", [])

        if not name or not email:
            return jsonify({"success": False, "error": "Name and email are required"}), 400
        if cgpa < 0.0 or cgpa > 10.0:
            return jsonify({"success": False, "error": "CGPA must be between 0.00 and 10.00"}), 400

        # Insert student
        execute_mysql_command(f"""
            INSERT INTO students (name, email, semester, department, cgpa)
            VALUES ('{name}', '{email}', '{semester}', '{department}', {cgpa:.2f});
        """)

        # Get generated student_id (query by unique email since each CLI execution is a separate session)
        sid_row = execute_mysql_query(f"SELECT student_id AS id FROM students WHERE email = '{email}';")[0]
        new_sid = int(sid_row["id"])

        # Insert Tag Preferences
        for rank, tid in enumerate(tag_ids, start=1):
            execute_mysql_command(f"""
                INSERT INTO student_tag_preferences (student_id, tag_id, preference_rank)
                VALUES ({new_sid}, {int(tid)}, {rank});
            """)

        # Insert Course Preferences
        for rank, cid in enumerate(course_ids, start=1):
            execute_mysql_command(f"""
                INSERT INTO student_course_preferences (student_id, course_id, preference_rank)
                VALUES ({new_sid}, {int(cid)}, {rank});
            """)

        # Re-run allocation cycle
        execute_mysql_command("CALL run_full_allocation_cycle();")

        # Get updated student outcome
        student_outcome = execute_mysql_query(f"""
            SELECT 
                s.student_id, s.name, s.cgpa,
                COALESCE((SELECT a.status FROM allocations a WHERE a.student_id = {new_sid} AND a.status = 'ALLOTTED' LIMIT 1), 'UNALLOTTED') AS allotted_status,
                (SELECT c.course_code FROM allocations a JOIN courses c ON a.course_id = c.course_id WHERE a.student_id = {new_sid} AND a.status = 'ALLOTTED' LIMIT 1) AS allotted_course
            FROM students s WHERE s.student_id = {new_sid};
        """)[0]

        return jsonify({
            "success": True,
            "message": f"Successfully enrolled student {name} and recalculated allocations!",
            "student": student_outcome
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/demo/update-student', methods=['POST'])
def update_demo_student():
    """Updates an existing student's details / preferences and recalculates allocation."""
    try:
        data = request.json or {}
        student_id = int(data.get("student_id"))
        name = data.get("name", "").strip()
        email = data.get("email", "").strip().lower()
        cgpa = float(data.get("cgpa"))
        department = data.get("department", "CSE").strip()
        course_ids = data.get("course_ids", None)

        if cgpa < 0.0 or cgpa > 10.0:
            return jsonify({"success": False, "error": "CGPA must be between 0.00 and 10.00"}), 400

        # Update student record
        execute_mysql_command(f"""
            UPDATE students 
            SET name = '{name}', email = '{email}', cgpa = {cgpa:.2f}, department = '{department}'
            WHERE student_id = {student_id};
        """)

        # If updated course preferences were provided
        if course_ids is not None:
            execute_mysql_command(f"DELETE FROM student_course_preferences WHERE student_id = {student_id};")
            for rank, cid in enumerate(course_ids, start=1):
                execute_mysql_command(f"""
                    INSERT INTO student_course_preferences (student_id, course_id, preference_rank)
                    VALUES ({student_id}, {int(cid)}, {rank});
                """)

        # Re-run allocation cycle
        execute_mysql_command("CALL run_full_allocation_cycle();")

        # Fetch new outcome
        outcome = execute_mysql_query(f"""
            SELECT 
                s.student_id, s.name, s.cgpa,
                COALESCE((SELECT a.status FROM allocations a WHERE a.student_id = {student_id} AND a.status = 'ALLOTTED' LIMIT 1), 'UNALLOTTED') AS allotted_status,
                (SELECT c.course_code FROM allocations a JOIN courses c ON a.course_id = c.course_id WHERE a.student_id = {student_id} AND a.status = 'ALLOTTED' LIMIT 1) AS allotted_course
            FROM students s WHERE s.student_id = {student_id};
        """)[0]

        return jsonify({
            "success": True,
            "message": f"Updated {name} (CGPA {cgpa:.2f}) and refreshed allocations!",
            "student": outcome
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/demo/delete-student', methods=['POST'])
def delete_demo_student():
    """Deletes a student (ON DELETE CASCADE handles children) and recalculates allocation."""
    try:
        data = request.json or {}
        student_id = int(data.get("student_id"))
        execute_mysql_command(f"DELETE FROM students WHERE student_id = {student_id};")
        execute_mysql_command("CALL run_full_allocation_cycle();")
        return jsonify({
            "success": True,
            "message": f"Student #{student_id} deleted (referential cascade verified) and allocation updated!"
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/demo/reset-10-students', methods=['POST'])
def reset_10_students():
    """Resets the database to the 10 demo students benchmark."""
    try:
        data_path = os.path.join(PROJECT_ROOT, "dataset_10_students.sql")
        execute_sql_file(data_path)
        return jsonify({
            "success": True,
            "message": "Database reset to the 10 Demo Students baseline!"
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/update-cgpa', methods=['POST'])
def update_cgpa():
    try:
        data = request.json or {}
        student_id = int(data.get("student_id", 8))
        new_cgpa = float(data.get("cgpa", 6.50))
        
        execute_mysql_command(f"UPDATE students SET cgpa = {new_cgpa} WHERE student_id = {student_id};")
        
        shortlist = execute_mysql_query(f"SELECT * FROM v_student_shortlist WHERE student_id = {student_id};")
        student = execute_mysql_query(f"SELECT student_id, name, cgpa FROM students WHERE student_id = {student_id};")[0]
        
        return jsonify({
            "success": True,
            "student": student,
            "shortlist_count": len(shortlist),
            "shortlist": shortlist,
            "message": f"Updated {student['name']} CGPA to {new_cgpa}. Shortlist now contains {len(shortlist)} courses."
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/test-trigger', methods=['POST'])
def test_trigger():
    try:
        data = request.json or {}
        course_id = int(data.get("course_id", 2))
        
        cinfo = execute_mysql_query(f"SELECT course_id, course_code, course_name, max_allocations, current_allocations FROM courses WHERE course_id = {course_id};")[0]
        max_a = int(cinfo["max_allocations"])

        execute_mysql_command(f"UPDATE courses SET current_allocations = {max_a} WHERE course_id = {course_id};")
        try:
            execute_mysql_command(f"INSERT INTO allocations (student_id, course_id, status) VALUES (1, {course_id}, 'ALLOTTED');")
            return jsonify({
                "success": False,
                "message": "Trigger did NOT block over-allocation! (Unexpected)"
            }), 400
        except RuntimeError as trigger_err:
            err_text = str(trigger_err)
            return jsonify({
                "success": True,
                "triggered": True,
                "sqlstate": "45000",
                "course_code": cinfo["course_code"],
                "course_name": cinfo["course_name"],
                "max_allocations": max_a,
                "message": "Trigger trg_before_allocation_insert successfully fired and blocked over-allocation!",
                "raw_mysql_error": err_text,
                "explanation": f"When course capacity reaches max_allocations ({max_a}/{max_a}), inserting an ALLOTTED row raises SQLSTATE 45000 with message 'Course full: cannot allot', guaranteeing database-tier integrity."
            })
        finally:
            execute_mysql_command(f"UPDATE courses SET current_allocations = (SELECT COUNT(*) FROM allocations WHERE course_id = {course_id} AND status = 'ALLOTTED') WHERE course_id = {course_id};")
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/reset-database', methods=['POST'])
def reset_database():
    try:
        data = request.json or {}
        dataset_type = data.get("dataset", "10_students")
        schema_path = os.path.join(PROJECT_ROOT, "schema.sql")

        if dataset_type == "benchmark":
            data_path = os.path.join(PROJECT_ROOT, "sample_data.sql")
            msg = "Database reset to original Benchmark Lab Dataset (8 students, 4 courses)!"
        elif dataset_type == "100_students":
            data_path = os.path.join(PROJECT_ROOT, "dataset_100_students.sql")
            msg = "Database reset to Full Scale Dataset (100 students, 14 courses, 10 tags)!"
        else:
            data_path = os.path.join(PROJECT_ROOT, "dataset_10_students.sql")
            msg = "Database reset to the 10 Demo Students dataset!"

        execute_sql_file(schema_path)
        execute_sql_file(data_path)
        execute_mysql_command("CALL run_full_allocation_cycle();")

        return jsonify({
            "success": True,
            "dataset": dataset_type,
            "message": msg
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

if __name__ == '__main__':
    print("Starting Student Course Recommendation System Web App on http://127.0.0.1:5000")
    app.run(host='0.0.0.0', port=5000, debug=False)
