; Extra steps for the Windows installer and uninstaller (Tauri NSIS hooks).
; The app can keep running in the tray, so it is closed (with its helper processes)
; before files are replaced or removed.

!define VYRION_RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"

!macro NSIS_HOOK_PREINSTALL
  nsExec::Exec 'taskkill /F /T /IM "${MAINBINARYNAME}.exe"'
  Pop $0
  Sleep 800
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Optional: start with Windows (stays in the tray). Silent installs answer "no".
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Vuoi avviare Vyrion ERP automaticamente all'accesso a Windows?$\r$\n$\r$\nL'app resta nella barra delle applicazioni; potrai cambiare idea disinstallando e reinstallando." /SD IDNO IDNO vyrion_no_autostart
    WriteRegStr HKCU "${VYRION_RUN_KEY}" "${PRODUCTNAME}" '"$INSTDIR\${MAINBINARYNAME}.exe"'
  vyrion_no_autostart:
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec 'taskkill /F /T /IM "${MAINBINARYNAME}.exe"'
  Pop $0
  Sleep 800
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; The auto-start entry always goes away with the program.
  DeleteRegValue HKCU "${VYRION_RUN_KEY}" "${PRODUCTNAME}"
  ; When the person chose to delete the application data, the encryption key stored in
  ; Windows Credential Manager goes too (the data is unreadable without it anyway).
  ${If} $DeleteAppDataCheckboxState = 1
    nsExec::Exec 'cmdkey /delete:database-key.com.vyrncore.vyrion-erp'
    Pop $0
    RMDir /r "$LOCALAPPDATA\${BUNDLEID}"
  ${EndIf}
!macroend
