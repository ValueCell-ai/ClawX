; ClawX Custom NSIS Installer/Uninstaller Script
;
; Install: enables long paths, adds resources\cli to user PATH for openclaw CLI.
; Uninstall: removes the PATH entry and optionally deletes user data.

!ifndef nsProcess::FindProcess
  !include "nsProcess.nsh"
!endif

!macro customHeader
  ; Show install details by default so users can see what stage is running.
  ShowInstDetails show
  ShowUninstDetails show
!macroend

!macro customCheckAppRunning
  ; Make stage logs visible on assisted installers (defaults to hidden).
  SetDetailsPrint both
  DetailPrint "Preparing installation..."
  DetailPrint "Extracting ClawX runtime files. This can take a few minutes on slower disks or while antivirus scanning is active."

  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0

  ${if} $R0 == 0
    ${if} ${isUpdated}
      # Auto-update: the app is already shutting down (quitAndInstall was called).
      # The before-quit handler needs up to 8s to gracefully stop the Gateway
      # process tree (5s timeout + force-terminate + re-quit).  Wait for the
      # app to exit on its own before resorting to force-kill.
      DetailPrint `Waiting for "${PRODUCT_NAME}" to finish shutting down...`
      Sleep 8000
      ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
      ${if} $R0 != 0
        Goto done_killing
      ${endIf}
      # App didn't exit in time; fall through to force-kill
    ${endIf}
    ${if} ${isUpdated} ; skip the dialog for auto-updates
    ${else}
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK doStopProcess
      Quit
    ${endIf}

    doStopProcess:
    DetailPrint `Closing running "${PRODUCT_NAME}"...`

    # Kill the entire process tree.  Electron runs multiple ClawX.exe processes
    # (main, renderer, GPU, UtilityProcess/Gateway) and the Gateway may spawn
    # Python child processes.  taskkill /F /T /IM kills ALL matching processes
    # and their descendants atomically.
    nsExec::ExecToStack 'taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"'
    Pop $0
    Pop $1

    # Also kill related child processes that may have detached from the
    # Electron process tree: Gateway, Python (skills), and uv (package mgr).
    # These won't match APP_EXECUTABLE_FILENAME but hold file locks in $INSTDIR.
    nsExec::ExecToStack 'taskkill /F /IM openclaw-gateway.exe'
    Pop $0
    Pop $1
    nsExec::ExecToStack 'taskkill /F /IM uv.exe'
    Pop $0
    Pop $1

    # Wait for file handles to be released across the full process tree
    Sleep 3000
    DetailPrint "Processes terminated. Continuing installation..."

    done_killing:
      ${nsProcess::Unload}
  ${endIf}

  ; Pre-emptively remove the old uninstall registry entry so that
  ; electron-builder's uninstallOldVersion skips the old uninstaller entirely.
  ;
  ; Why: uninstallOldVersion has a hardcoded 5-retry loop that runs the old
  ; uninstaller repeatedly.  The old uninstaller's atomicRMDir fails on locked
  ; files (antivirus, indexing) causing a blocking "ClawX 无法关闭" dialog.
  ; Deleting UninstallString makes uninstallOldVersion return immediately.
  ; The new installer will overwrite / extract all files on top of the old dir.
  ; registryAddInstallInfo will write the correct new entries afterwards.
  ; Clean both SHELL_CONTEXT and HKCU to cover cross-hive upgrades
  ; (e.g. old install was per-user, new install is per-machine or vice versa).
  DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString
  DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString
  DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY}" UninstallString
  DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString
  !ifdef UNINSTALL_REGISTRY_KEY_2
    DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
    DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" QuietUninstallString
    DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
    DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY_2}" QuietUninstallString
  !endif
!macroend

; Override electron-builder's handleUninstallResult to prevent the
; "ClawX 无法关闭" retry dialog when the old uninstaller fails.
;
; During upgrades, electron-builder copies the old uninstaller to a temp dir
; and runs it silently.  The old uninstaller uses atomicRMDir to rename every
; file out of $INSTDIR.  If ANY file is still locked (antivirus scanner,
; Windows Search indexer, delayed kernel handle release after taskkill), it
; aborts with a non-zero exit code.  The default handler retries 5× then shows
; a blocking MessageBox.
;
; This macro clears the error and lets the new installer proceed — it will
; simply overwrite / extract new files on top of the (partially cleaned) old
; installation directory.  This is safe because:
;   1. Processes have already been force-killed in customCheckAppRunning.
;   2. The new installer extracts a complete, self-contained file tree.
;   3. Any leftover old files that weren't removed are harmless.
!macro customUnInstallCheck
  ${if} $R0 != 0
    DetailPrint "Old uninstaller exited with code $R0. Continuing with overwrite install..."
  ${endIf}
  ClearErrors
!macroend

; Same safety net for the HKEY_CURRENT_USER uninstall path.
; Without this, handleUninstallResult would show a fatal error and Quit.
!macro customUnInstallCheckCurrentUser
  ${if} $R0 != 0
    DetailPrint "Old uninstaller (current user) exited with code $R0. Continuing..."
  ${endIf}
  ClearErrors
!macroend

!macro customInstall
  DetailPrint "Core files extracted. Finalizing system integration..."

  ; Enable Windows long path support (Windows 10 1607+ / Windows 11).
  ; pnpm virtual store paths can exceed the default MAX_PATH limit of 260 chars.
  ; Writing to HKLM requires admin privileges; on per-user installs without
  ; elevation this call silently fails — no crash, just no key written.
  DetailPrint "Enabling long-path support (if permissions allow)..."
  WriteRegDWORD HKLM "SYSTEM\CurrentControlSet\Control\FileSystem" "LongPathsEnabled" 1

  ; Use PowerShell to update the current user's PATH.
  ; This avoids NSIS string-buffer limits and preserves long PATH values.
  DetailPrint "Updating user PATH for the OpenClaw CLI..."
  InitPluginsDir
  ClearErrors
  File "/oname=$PLUGINSDIR\update-user-path.ps1" "${PROJECT_DIR}\resources\cli\win32\update-user-path.ps1"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\update-user-path.ps1" -Action add -CliDir "$INSTDIR\resources\cli"'
  Pop $0
  Pop $1
  StrCmp $0 "error" 0 +2
    DetailPrint "Warning: Failed to launch PowerShell while updating PATH."
  StrCmp $0 "timeout" 0 +2
    DetailPrint "Warning: PowerShell PATH update timed out."
  StrCmp $0 "0" 0 +2
    Goto _ci_done
  DetailPrint "Warning: PowerShell PATH update exited with code $0."

  _ci_done:
  DetailPrint "Installation steps complete."
!macroend

!macro customUnInstall
  ; Remove resources\cli from user PATH via PowerShell so long PATH values are handled safely
  InitPluginsDir
  ClearErrors
  File "/oname=$PLUGINSDIR\update-user-path.ps1" "${PROJECT_DIR}\resources\cli\win32\update-user-path.ps1"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\update-user-path.ps1" -Action remove -CliDir "$INSTDIR\resources\cli"'
  Pop $0
  Pop $1
  StrCmp $0 "error" 0 +2
    DetailPrint "Warning: Failed to launch PowerShell while removing PATH entry."
  StrCmp $0 "timeout" 0 +2
    DetailPrint "Warning: PowerShell PATH removal timed out."
  StrCmp $0 "0" 0 +2
    Goto _cu_pathDone
  DetailPrint "Warning: PowerShell PATH removal exited with code $0."

  _cu_pathDone:

  ; Ask user if they want to completely remove all user data
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Do you want to completely remove all ClawX user data?$\r$\n$\r$\nThis will delete:$\r$\n  • .openclaw folder (configuration & skills)$\r$\n  • AppData\Local\clawx (local app data)$\r$\n  • AppData\Roaming\clawx (roaming app data)$\r$\n$\r$\nSelect 'No' to keep your data for future reinstallation." \
    /SD IDNO IDYES _cu_removeData IDNO _cu_skipRemove

  _cu_removeData:
    ; Kill any lingering ClawX processes (and their child process trees) to
    ; release file locks on electron-store JSON files, Gateway sockets, etc.
    ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    ${if} $R0 == 0
      nsExec::ExecToStack 'taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"'
      Pop $0
      Pop $1
    ${endIf}
    ${nsProcess::Unload}

    ; Wait for processes to fully exit and release file handles
    Sleep 2000

    ; --- Always remove current user's data first ---
    RMDir /r "$PROFILE\.openclaw"
    RMDir /r "$LOCALAPPDATA\clawx"
    RMDir /r "$APPDATA\clawx"

    ; --- Retry: if directories still exist (locked files), wait and try again ---
    ; Check .openclaw
    IfFileExists "$PROFILE\.openclaw\*.*" 0 _cu_openclawDone
      Sleep 3000
      RMDir /r "$PROFILE\.openclaw"
      IfFileExists "$PROFILE\.openclaw\*.*" 0 _cu_openclawDone
        nsExec::ExecToStack 'cmd.exe /c rd /s /q "$PROFILE\.openclaw"'
        Pop $0
        Pop $1
    _cu_openclawDone:

    ; Check AppData\Local\clawx
    IfFileExists "$LOCALAPPDATA\clawx\*.*" 0 _cu_localDone
      Sleep 3000
      RMDir /r "$LOCALAPPDATA\clawx"
      IfFileExists "$LOCALAPPDATA\clawx\*.*" 0 _cu_localDone
        nsExec::ExecToStack 'cmd.exe /c rd /s /q "$LOCALAPPDATA\clawx"'
        Pop $0
        Pop $1
    _cu_localDone:

    ; Check AppData\Roaming\clawx
    IfFileExists "$APPDATA\clawx\*.*" 0 _cu_roamingDone
      Sleep 3000
      RMDir /r "$APPDATA\clawx"
      IfFileExists "$APPDATA\clawx\*.*" 0 _cu_roamingDone
        nsExec::ExecToStack 'cmd.exe /c rd /s /q "$APPDATA\clawx"'
        Pop $0
        Pop $1
    _cu_roamingDone:

    ; --- Final check: warn user if any directories could not be removed ---
    StrCpy $R3 ""
    IfFileExists "$PROFILE\.openclaw\*.*" 0 +2
      StrCpy $R3 "$R3$\r$\n  • $PROFILE\.openclaw"
    IfFileExists "$LOCALAPPDATA\clawx\*.*" 0 +2
      StrCpy $R3 "$R3$\r$\n  • $LOCALAPPDATA\clawx"
    IfFileExists "$APPDATA\clawx\*.*" 0 +2
      StrCpy $R3 "$R3$\r$\n  • $APPDATA\clawx"
    StrCmp $R3 "" _cu_cleanupOk
      MessageBox MB_OK|MB_ICONEXCLAMATION \
        "Some data directories could not be removed (files may be in use):$\r$\n$R3$\r$\n$\r$\nPlease delete them manually after restarting your computer."
    _cu_cleanupOk:

    ; --- For per-machine (all users) installs, enumerate all user profiles ---
    StrCpy $R0 0

  _cu_enumLoop:
    EnumRegKey $R1 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList" $R0
    StrCmp $R1 "" _cu_enumDone

    ReadRegStr $R2 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$R1" "ProfileImagePath"
    StrCmp $R2 "" _cu_enumNext

    ExpandEnvStrings $R2 $R2
    StrCmp $R2 $PROFILE _cu_enumNext

    RMDir /r "$R2\.openclaw"
    RMDir /r "$R2\AppData\Local\clawx"
    RMDir /r "$R2\AppData\Roaming\clawx"

  _cu_enumNext:
    IntOp $R0 $R0 + 1
    Goto _cu_enumLoop

  _cu_enumDone:
  _cu_skipRemove:
!macroend
