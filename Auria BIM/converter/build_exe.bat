@echo off
:: Compila auria_uploader.py em .exe com PyInstaller
:: Execute este arquivo uma vez para gerar o .exe em dist\AuriaBIM_Uploader\

cd /d "%~dp0"

echo Instalando dependencias...
pip install customtkinter ifcopenshell boto3 supabase qrcode[pil] pillow python-dotenv pyinstaller --quiet

echo.
echo Compilando .exe...
pyinstaller ^
  --noconfirm ^
  --onedir ^
  --windowed ^
  --name "AuriaBIM_Uploader" ^
  --icon "..\viewer\public\logo_symbol.png" ^
  --add-data ".env;." ^
  --add-data "node_modules;node_modules" ^
  --hidden-import "customtkinter" ^
  --hidden-import "ifcopenshell" ^
  --hidden-import "boto3" ^
  --hidden-import "supabase" ^
  --hidden-import "qrcode" ^
  --hidden-import "PIL" ^
  --hidden-import "dotenv" ^
  --collect-all "customtkinter" ^
  --collect-all "ifcopenshell" ^
  auria_uploader.py

echo.
echo ============================================================
echo  .exe gerado em: dist\AuriaBIM_Uploader\AuriaBIM_Uploader.exe
echo  Copie a pasta dist\AuriaBIM_Uploader\ para onde quiser usar.
echo  O arquivo .env ja esta incluido com as credenciais.
echo ============================================================
pause
