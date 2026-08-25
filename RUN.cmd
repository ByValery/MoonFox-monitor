@echo off
setlocal
cd /d "%~dp0"

set "PYTHON_EXE=%~dp0runtime\python\python.exe"
set "SERVER_FILE=%~dp0moonfox_server.py"

if exist "%PYTHON_EXE%" (
  "%PYTHON_EXE%" "%SERVER_FILE%"
  goto done
)

where py >nul 2>nul
if not errorlevel 1 (
  py -3 "%SERVER_FILE%"
  goto done
)

where python >nul 2>nul
if not errorlevel 1 (
  python "%SERVER_FILE%"
  goto done
)

echo.
echo MoonFox monitor cannot find Python.
echo Expected local runtime: runtime\python\python.exe
echo Put portable Python into runtime\python or install Python 3.11+.

:done
pause
