; Extra steps for the Windows installer and uninstaller (Tauri NSIS hooks).
; The app can keep running in the tray, so it is closed (with its helper processes)
; before files are replaced or removed.

!macro NSIS_HOOK_PREINSTALL
  nsExec::Exec 'taskkill /F /T /IM "${MAINBINARYNAME}.exe"'
  Pop $0
  Sleep 800
!macroend

!macro NSIS_HOOK_POSTINSTALL
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec 'taskkill /F /T /IM "${MAINBINARYNAME}.exe"'
  Pop $0
  Sleep 800
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Leave no empty program folder behind.
  RMDir "$LOCALAPPDATA\${BUNDLEID}"
!macroend
