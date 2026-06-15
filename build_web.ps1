cd web
npm install
$env:NEXT_PUBLIC_APP_VERSION = Get-Content ../VERSION
npm run build
cd ..
if (Test-Path web_dist) { Remove-Item -Recurse -Force web_dist }
Move-Item web/out web_dist
