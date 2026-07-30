!macro NSIS_HOOK_POSTINSTALL
  IfFileExists "$PROGRAMFILES64\RustDesk\rustdesk.exe" rustdesk_done
  IfFileExists "$PROGRAMFILES\RustDesk\rustdesk.exe" rustdesk_done
  IfFileExists "$LOCALAPPDATA\Programs\RustDesk\rustdesk.exe" rustdesk_done

  DetailPrint "Preparando soporte remoto..."
  IfFileExists "$INSTDIR\resources\rustdesk\rustdesk-installer.exe" 0 rustdesk_missing
  ExecWait '"$INSTDIR\resources\rustdesk\rustdesk-installer.exe" --silent-install' $0
  DetailPrint "RustDesk terminó con código $0"
  Goto rustdesk_done

rustdesk_missing:
  DetailPrint "El instalador de RustDesk no está dentro del paquete."

rustdesk_done:
!macroend
