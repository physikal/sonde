@echo off
setlocal enabledelayedexpansion

set "ENV_FILE=%PROGRAMDATA%\Sonde\sonde-hub.env"
set "NODE_EXE=%PROGRAMFILES%\Sonde\node\node.exe"
set "HUB_ENTRY=%PROGRAMFILES%\Sonde\app\packages\hub\dist\index.js"

rem Load environment variables from env file
if exist "%ENV_FILE%" (
  for /f "usebackq tokens=1,* delims==" %%A in ("%ENV_FILE%") do (
    set "LINE=%%A"
    rem Skip comments and blank lines
    if not "!LINE:~0,1!"=="#" (
      if not "%%A"=="" (
        set "%%A=%%B"
      )
    )
  )
)

rem Set database path to ProgramData if not already set
if not defined SONDE_DB_PATH (
  set "SONDE_DB_PATH=%PROGRAMDATA%\Sonde\sonde.db"
)

"%NODE_EXE%" "%HUB_ENTRY%"
