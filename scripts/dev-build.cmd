@echo off
rem Configures and builds LeanSlides with the Visual Studio 2022 C++ tools.
rem Usage: scripts\dev-build.cmd [Release^|Debug] [extra cmake configure args]
setlocal
set CONFIG=%1
if "%CONFIG%"=="" set CONFIG=Release
for /f "usebackq delims=" %%i in (`"%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" -products * -latest -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set VSROOT=%%i
if "%VSROOT%"=="" (
  echo Visual Studio C++ tools not found.
  exit /b 1
)
call "%VSROOT%\VC\Auxiliary\Build\vcvars64.bat" >nul || exit /b 1
set BUILD=%~dp0..\build\%CONFIG%
rem Everything after the configuration goes to cmake as typed. %%2 would split
rem -DNAME=VALUE at the equals sign.
set EXTRA=
for /f "tokens=1,*" %%a in ("%*") do set EXTRA=%%b
cmake -S "%~dp0.." -B "%BUILD%" -G Ninja -DCMAKE_BUILD_TYPE=%CONFIG% -DBUILD_TESTING=ON %EXTRA% || exit /b 1
cmake --build "%BUILD%" || exit /b 1
