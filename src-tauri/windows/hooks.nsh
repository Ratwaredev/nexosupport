!macro NSIS_HOOK_POSTINSTALL
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
