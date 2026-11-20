@echo off
rem Double-click this file after changing anything in the images\ folder.
rem It rewrites js\image_manifest.js (the list of image files per condition).
rem Needs Node.js (https://nodejs.org).
node "%~dp0build_image_manifest.js"
echo.
pause
