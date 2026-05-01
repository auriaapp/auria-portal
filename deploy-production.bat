@echo off
:: Deploy to PRODUCTION (auria-bim.vercel.app)
:: Only run this after testing with deploy-preview.bat

cd /d "%~dp0"

echo Switching to main branch...
git checkout main

echo Merging dev into main...
git merge dev --no-edit

echo Pushing to GitHub...
git push origin main

echo.
echo Deploying to PRODUCTION...
cd "Auria BIM\viewer"
vercel deploy --prod --yes

echo.
echo Switching back to dev for next feature...
cd /d "%~dp0"
git checkout dev

echo.
echo Done! Production updated at https://auria-bim.vercel.app
pause
