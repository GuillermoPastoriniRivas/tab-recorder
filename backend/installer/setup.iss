; Inno Setup — instalador de WhisperMeet (backend headless + tray)
; Compilar con: ISCC.exe installer\setup.iss
; Requiere haber generado antes el build con PyInstaller (ver build.ps1),
; que deja la app en dist\WhisperMeet\.

#define AppName "WhisperMeet"
#define AppVersion "0.1.0"
#define AppPublisher "WhisperMeet"
#define AppExeName "WhisperMeet.exe"

[Setup]
AppId={{B6F4B2B1-7C3E-4F2A-9D1E-WHISPERMEET01}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
OutputDir=Output
; Nombre FIJO (sin versión) para que la URL .../releases/latest/download/
; WhisperMeet-Setup.exe siempre apunte al último instalador. La versión queda
; en los metadatos del instalador (AppVersion).
OutputBaseFilename={#AppName}-Setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "startup"; Description: "Arrancar {#AppName} con Windows"; GroupDescription: "Inicio:"

[Files]
; Salida onedir de PyInstaller (carpeta completa con .exe + DLLs).
Source: "..\dist\{#AppName}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{group}\Desinstalar {#AppName}"; Filename: "{uninstallexe}"

[Registry]
; Autostart opcional (la tarea "startup"). El tray también lo gestiona luego.
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; \
    ValueType: string; ValueName: "{#AppName}"; ValueData: """{app}\{#AppExeName}"""; \
    Tasks: startup; Flags: uninsdeletevalue

[Run]
Filename: "{app}\{#AppExeName}"; Description: "Iniciar {#AppName} ahora"; \
    Flags: nowait postinstall skipifsilent
