!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Cerrando instalaciones anteriores de NEXO..."
  nsExec::ExecToLog 'taskkill /F /IM "NEXO Support.exe"'
  Sleep 1200

  ; Eliminar la instalación histórica por usuario que Windows Search seguía abriendo.
  RMDir /r "$LOCALAPPDATA\Programs\NEXO Support"
  Delete "$LOCALAPPDATA\NEXO Support\NEXO Support.exe"
  Delete "$LOCALAPPDATA\NEXO Support\NEXO Support.obsolete.exe"
  Delete "$LOCALAPPDATA\NEXO Support\active-install.json"
  Delete "$LOCALAPPDATA\NEXO Support\canonical-install-v2.ok"
  Delete "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\NEXO Support.lnk"

  ; Borrar accesos viejos tanto del usuario como de todos los usuarios.
  SetShellVarContext current
  Delete "$DESKTOP\NEXO Support.lnk"
  Delete "$SMPROGRAMS\NEXO Support.lnk"
  RMDir /r "$SMPROGRAMS\NEXO Support"

  SetShellVarContext all
  Delete "$DESKTOP\NEXO Support.lnk"
  Delete "$SMPROGRAMS\NEXO Support.lnk"
  RMDir /r "$SMPROGRAMS\NEXO Support"

  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\NEXO Support.exe"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\NEXO Support.exe"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Registrar explícitamente el único ejecutable válido.
  SetShellVarContext all
  CreateDirectory "$SMPROGRAMS"
  CreateShortCut "$SMPROGRAMS\NEXO Support.lnk" "$INSTDIR\NEXO Support.exe" "" "$INSTDIR\NEXO Support.exe" 0
  CreateShortCut "$DESKTOP\NEXO Support.lnk" "$INSTDIR\NEXO Support.exe" "" "$INSTDIR\NEXO Support.exe" 0

  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\NEXO Support.exe" "" "$INSTDIR\NEXO Support.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\NEXO Support.exe" "Path" "$INSTDIR"

  IfFileExists "$PROGRAMFILES64\RustDesk\rustdesk.exe" rustdesk_done
  IfFileExists "$PROGRAMFILES\RustDesk\rustdesk.exe" rustdesk_done
  IfFileExists "$LOCALAPPDATA\Programs\RustDesk\rustdesk.exe" rustdesk_done

  DetailPrint "Preparando soporte remoto..."
  IfFileExists "$INSTDIR\resources\rustdesk\rustdesk-installer.exe" 0 rustdesk_missing
  ; RustDesk puede mantener su proceso vivo después de instalarse. No debemos
  ; bloquear el instalador de NEXO esperando a que cierre la interfaz remota.
  Exec '"$INSTDIR\resources\rustdesk\rustdesk-installer.exe" --silent-install'
  DetailPrint "RustDesk se está preparando en segundo plano."
  Goto rustdesk_done

rustdesk_missing:
  DetailPrint "El instalador de RustDesk no está dentro del paquete."

rustdesk_done:
!macroend
