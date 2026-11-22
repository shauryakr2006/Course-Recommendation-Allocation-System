@echo off
title Student Academic Performance & Course Recommendation System - Web App
echo ==============================================================================
echo Student Academic Performance & Course Recommendation System
echo MySQL DBMS Mini-Project (24CS520 / 24CS58L) - SJCE Mysuru
echo ==============================================================================
echo.
echo Starting Flask web presentation server on http://localhost:5000 ...
echo Press Ctrl+C in this terminal window to stop the server anytime.
echo.

start "" "http://localhost:5000"
python "%~dp0app.py"
pause
