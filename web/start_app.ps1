Write-Host "==============================================================================" -ForegroundColor Cyan
Write-Host "Student Academic Performance & Course Recommendation System - Web App" -ForegroundColor Yellow
Write-Host "MySQL DBMS Mini-Project (24CS520 / 24CS58L) - SJCE Mysuru" -ForegroundColor Cyan
Write-Host "==============================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Starting Flask web presentation server on http://localhost:5000 ..." -ForegroundColor Green
Write-Host "Press Ctrl+C to terminate the server anytime." -ForegroundColor Gray
Write-Host ""

Start-Process "http://localhost:5000"
python "$PSScriptRoot\app.py"
