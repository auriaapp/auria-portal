@echo off
:: Deploy current state to a PREVIEW URL (safe, nao afeta producao)
:: Use this to test changes before going live

cd /d "%~dp0Auria BIM\viewer"

git status --short

echo.
echo Deploying to PREVIEW (not production)...
vercel deploy --yes

echo.
echo Done! Use the URL above to test on your phone.
echo When satisfied, run deploy-production.bat to go live.
pause
