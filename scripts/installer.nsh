; ClawX Custom NSIS Installer/Uninstaller Script
;
; Install: enables long paths, adds resources\cli to user PATH for openclaw CLI.
; Uninstall: removes the PATH entry and optionally deletes user data.

!include "LogicLib.nsh"

!ifndef nsProcess::FindProcess
  !include "nsProcess.nsh"
!endif

Var /GLOBAL clawxRollbackDir

!macro customHeader
  ; Show install details by default so users can see what stage is running.
  ShowInstDetails show
  ShowUninstDetails show
!macroend

!ifndef BUILD_UNINSTALLER
Function ClawXMoveLegacyInstallDir
  Exch $R6

  ${if} $R6 == ""
    Goto _clawx_legacy_move_done
  ${endIf}
  ${if} $R6 == $INSTDIR
    Goto _clawx_legacy_move_done
  ${endIf}

  IfFileExists "$R6\" 0 _clawx_legacy_move_done
    DetailPrint "Moving previous ClawX installation at $R6 out of the way..."
    SetOutPath $TEMP
    nsExec::ExecToStack `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith('$R6', [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
    Pop $0
    Pop $1
    Sleep 1000
    StrCpy $R8 0

  _clawx_legacy_find_free_stale:
    IfFileExists "$R6._stale_$R8\" 0 _clawx_legacy_found_free_stale
    IntOp $R8 $R8 + 1
    Goto _clawx_legacy_find_free_stale

  _clawx_legacy_found_free_stale:
    ClearErrors
    Rename "$R6" "$R6._stale_$R8"
    IfErrors 0 _clawx_legacy_stale_moved
      DetailPrint "Waiting for file locks at $R6 to clear..."
      nsExec::ExecToStack `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith('$R6', [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
      Pop $0
      Pop $1
      Sleep 2000
      ClearErrors
      Rename "$R6" "$R6._stale_$R8"
      IfErrors 0 _clawx_legacy_stale_moved
      DetailPrint "Removing previous ClawX installation at $R6..."
      nsExec::ExecToStack 'cmd.exe /c rd /s /q "$R6"'
      Pop $0
      Pop $1
      Goto _clawx_legacy_move_done
  _clawx_legacy_stale_moved:
    ExecShell "" "cmd.exe" `/c ping -n 61 127.0.0.1 >nul & rd /s /q "$R6._stale_$R8"` SW_HIDE

  _clawx_legacy_move_done:
    ClearErrors
    Pop $R6
FunctionEnd

!macro clawxMoveLegacyInstallDir ROOT_KEY
  ReadRegStr $R6 ${ROOT_KEY} "${INSTALL_REGISTRY_KEY}" InstallLocation
  Push $R6
  Call ClawXMoveLegacyInstallDir
!macroend
!endif


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
        # App exited cleanly. Still kill long-lived child processes (gateway,
        # uv, python) which may not have followed the app's graceful exit.
        nsExec::ExecToStack 'taskkill /F /IM openclaw-gateway.exe'
        Pop $0
        Pop $1
        Goto done_killing
      ${endIf}
      # App didn't exit in time; fall through to force-kill
    ${endIf}

    doStopProcess:
    DetailPrint `Closing running "${PRODUCT_NAME}"...`

    # Kill ALL processes whose executable lives inside $INSTDIR.
    # This covers ClawX.exe (multiple Electron processes), openclaw-gateway.exe,
    # python.exe (skills runtime), uv.exe (package manager), and any other
    # child process that might hold file locks in the installation directory.
    #
    # Use PowerShell Get-CimInstance for path-based matching (most reliable),
    # with taskkill name-based fallback for restricted environments.
    # Note: Using backticks ` ` for the NSIS string allows us to use single quotes inside.
    nsExec::ExecToStack `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith('$INSTDIR', [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
    Pop $0
    Pop $1

    ${if} $0 != 0
      # PowerShell failed (policy restriction, etc.) — fall back to name-based kill
      nsExec::ExecToStack 'taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"'
      Pop $0
      Pop $1
    ${endIf}

    # Also kill well-known child processes that may have detached from the
    # Electron process tree or run from outside $INSTDIR (e.g. system python).
    nsExec::ExecToStack 'taskkill /F /IM openclaw-gateway.exe'
    Pop $0
    Pop $1

    # Wait for Windows to fully release file handles after process termination.
    # 5 seconds accommodates slow antivirus scanners and filesystem flush delays.
    Sleep 5000
    DetailPrint "Processes terminated. Continuing installation..."

    done_killing:
      ${nsProcess::Unload}
  ${endIf}

  ; Even if ClawX.exe was not detected as running, orphan child processes
  ; (python.exe, openclaw-gateway.exe, uv.exe, etc.) from a previous crash
  ; or unclean shutdown may still hold file locks inside $INSTDIR.
  ; Unconditionally kill any process whose executable lives in the install dir.
  nsExec::ExecToStack `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith('$INSTDIR', [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
  Pop $0
  Pop $1

  ; Always kill known process names as a belt-and-suspenders approach.
  ; PowerShell path-based kill may miss processes if the old ClawX was installed
  ; in a different directory than $INSTDIR (e.g., per-machine -> per-user migration).
  ; taskkill is name-based and catches processes regardless of their install location.
  nsExec::ExecToStack 'taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"'
  Pop $0
  Pop $1
  nsExec::ExecToStack 'taskkill /F /IM openclaw-gateway.exe'
  Pop $0
  Pop $1
  ; Note: we intentionally do NOT kill uv.exe globally — it is a popular
  ; Python package manager and other users/CI jobs may have uv running.
  ; The PowerShell path-based kill above already handles uv inside $INSTDIR.

  ; Brief wait for handle release (main wait was already done above if app was running)
  Sleep 2000

  ; Do not continue while the old UI process is still alive. Continuing in that
  ; state can leave the running old process/window in place, making the user see
  ; the old version after an otherwise successful extract.  Use process-list
  ; commands instead of nsProcess here: field diagnostics showed ClawX.exe can
  ; remain alive while the old installer still reports success; this check must
  ; fail closed even when taskkill or the nsProcess plugin misses/elevates poorly.
  StrCpy $R7 0
  _clawx_verify_closed:
    nsExec::ExecToStack `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "if (Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.Name -ieq '${APP_EXECUTABLE_FILENAME}' }) { exit 0 } else { exit 1 }"`
    Pop $R0
    Pop $R1
    ${if} $R0 != 0
      nsExec::ExecToStack 'cmd.exe /c tasklist /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" | find /I "${APP_EXECUTABLE_FILENAME}" >nul'
      Pop $R0
      Pop $R1
    ${endIf}
    ${if} $R0 == 0
      IntOp $R7 $R7 + 1
      DetailPrint `Waiting for "${PRODUCT_NAME}" to close (attempt $R7)...`
      nsExec::ExecToStack 'taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"'
      Pop $0
      Pop $1
      nsExec::ExecToStack `cmd.exe /c wmic process where "name='${APP_EXECUTABLE_FILENAME}'" call terminate`
      Pop $0
      Pop $1
      Sleep 2000
      ${if} $R7 < 5
        Goto _clawx_verify_closed
      ${endIf}
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "ClawX is still running and cannot be replaced safely. Please close ClawX and retry installation." /SD IDCANCEL IDRETRY _clawx_verify_closed
      SetErrorLevel 2
      Quit
    ${endIf}

  !ifndef BUILD_UNINSTALLER
    StrCpy $clawxRollbackDir ""

    ; Release NSIS's CWD on $INSTDIR BEFORE the rename check.
    ; NSIS sets CWD to $INSTDIR in .onInit; Windows refuses to rename a directory
    ; that any process (including NSIS itself) has as its CWD.
    SetOutPath $TEMP

    ; Move legacy installs discovered in both registry hives before handling the
    ; current $INSTDIR.  This covers per-user <-> per-machine migrations and
    ; custom install directories where the new $INSTDIR is not the old location.
    !insertmacro clawxMoveLegacyInstallDir HKCU
    !insertmacro clawxMoveLegacyInstallDir HKLM

    ; Pre-emptively clear the old installation directory so that the 7z
  ; extraction `CopyFiles` step in extractAppPackage.nsh won't fail on
  ; locked files.  electron-builder's extractUsing7za macro extracts to a
  ; temp folder first, then uses `CopyFiles /SILENT` to copy into $INSTDIR.
  ; If ANY file in $INSTDIR is still locked, CopyFiles fails and triggers a
  ; "Can't modify ClawX's files" retry loop -> "ClawX 无法关闭" dialog.
  ;
  ; Strategy: rename (move) the old $INSTDIR out of the way.  Rename works
  ; even when AV/indexer have files open for reading (they use
  ; FILE_SHARE_DELETE sharing mode), whereas CopyFiles fails because it
  ; needs write/overwrite access which some AV products deny.
  ; Check if a previous installation exists ($INSTDIR is a directory).
  ; Use trailing backslash — the correct NSIS idiom for directory existence.
  ; (IfFileExists "$INSTDIR\*.*" only matches files containing a dot and
  ;  would fail for extensionless files or pure-subdirectory layouts.)
  IfFileExists "$INSTDIR\" 0 _instdir_clean
    DetailPrint "Moving previous installation out of the way..."
    ; Find the first available stale directory name (e.g. $INSTDIR._stale_0)
    ; This ensures we NEVER have to synchronously delete old leftovers before
    ; renaming the current $INSTDIR. We just move it out of the way instantly.
    StrCpy $R8 0
  _find_free_stale:
    IfFileExists "$INSTDIR._stale_$R8\" 0 _found_free_stale
    IntOp $R8 $R8 + 1
    Goto _find_free_stale

  _found_free_stale:
    ClearErrors
    Rename "$INSTDIR" "$INSTDIR._stale_$R8"
    IfErrors 0 _stale_moved
      ; Rename still failed — retry process termination, then delete synchronously.
      ; Large openclaw bundles (#1026+) can make rd /s /q take several minutes.
      DetailPrint "Waiting for file locks to clear, then removing old files..."
      nsExec::ExecToStack 'taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"'
      Pop $0
      Pop $1
      nsExec::ExecToStack 'taskkill /F /IM openclaw-gateway.exe'
      Pop $0
      Pop $1
      Sleep 3000
      nsExec::ExecToStack 'cmd.exe /c rd /s /q "$INSTDIR"'
      Pop $0
      Pop $1
      Sleep 2000
      RMDir "$INSTDIR"
      IfFileExists "$INSTDIR\" 0 _recreate_clean_instdir
        DetailPrint "Failed to remove previous installation directory; aborting to avoid leaving the old version installed."
        MessageBox MB_OK|MB_ICONEXCLAMATION "Unable to replace the previous ClawX installation because files are still locked. Please close ClawX and retry installation." /SD IDOK
        SetErrorLevel 2
        Quit
      _recreate_clean_instdir:
      CreateDirectory "$INSTDIR"
      Goto _instdir_clean
  _stale_moved:
    StrCpy $clawxRollbackDir "$INSTDIR._stale_$R8"
    CreateDirectory "$INSTDIR"
  _instdir_clean:

  ; During overwrite installs, stale files can still survive if the old
  ; installation directory was only partially removed after a locked-file
  ; fallback. Explicitly remove the bundled skills subtree so old skills
  ; (apple-notes, discord, etc.) do not remain under resources\openclaw\skills.
  IfFileExists "$INSTDIR\resources\openclaw\skills\" 0 _openclaw_skills_clean
    DetailPrint "Removing stale bundled OpenClaw skills from previous install..."
    RMDir /r "$INSTDIR\resources\openclaw\skills"
    IfFileExists "$INSTDIR\resources\openclaw\skills\" 0 _openclaw_skills_clean
      nsExec::ExecToStack 'cmd.exe /c rd /s /q "$INSTDIR\resources\openclaw\skills"'
      Pop $0
      Pop $1
  _openclaw_skills_clean:

  ; Opposite-hive registry cleanup is intentionally done in customInstall after
  ; successful extraction, so a failed update can still roll back to the old app
  ; with its existing uninstall entries intact.
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
  ; Now that the new files and current-hive registry entries have been written,
  ; remove stale entries from the opposite hive so Windows Apps & Features does
  ; not continue showing the old version after cross-hive upgrades.
  DetailPrint "Clearing stale ClawX registry entries from the opposite install scope..."
  ${if} $installMode == "all"
    DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY}"
    DeleteRegKey HKCU "${INSTALL_REGISTRY_KEY}"
    !ifdef UNINSTALL_REGISTRY_KEY_2
      DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY_2}"
    !endif
  ${else}
    DeleteRegKey HKLM "${UNINSTALL_REGISTRY_KEY}"
    DeleteRegKey HKLM "${INSTALL_REGISTRY_KEY}"
    !ifdef UNINSTALL_REGISTRY_KEY_2
      DeleteRegKey HKLM "${UNINSTALL_REGISTRY_KEY_2}"
    !endif
  ${endIf}
  ClearErrors

  ; Async cleanup of old dirs left by the rename loop in customCheckAppRunning.
  ; Wait 60s before starting deletion to avoid I/O contention with ClawX's
  ; first launch (Windows Defender scan, ASAR mapping, etc.).
  ; ExecShell SW_HIDE is completely detached from NSIS and avoids pipe blocking.
  IfFileExists "$INSTDIR._stale_0\" 0 _ci_stale_cleaned
    ; Use PowerShell to extract the basename of $INSTDIR so the glob works
    ; even when the user picked a custom install folder name.
    ; E.g. $INSTDIR = D:\Apps\MyClaw → glob = MyClaw._stale_*
    ExecShell "" "cmd.exe" `/c ping -n 61 127.0.0.1 >nul & cd /d "$INSTDIR\.." & for /d %D in ("$INSTDIR._stale_*") do rd /s /q "%D"` SW_HIDE
  _ci_stale_cleaned:
  DetailPrint "Core files extracted. Finalizing system integration..."

  ; Enable Windows long path support (Windows 10 1607+ / Windows 11).
  ; pnpm virtual store paths can exceed the default MAX_PATH limit of 260 chars.
  ; Writing to HKLM requires admin privileges; on per-user installs without
  ; elevation this call silently fails — no crash, just no key written.
  DetailPrint "Enabling long-path support (if permissions allow)..."
  WriteRegDWORD HKLM "SYSTEM\CurrentControlSet\Control\FileSystem" "LongPathsEnabled" 1

  ; Add $INSTDIR to Windows Defender exclusion list so that real-time scanning
  ; doesn't block the first app launch (Defender scans every newly-created file,
  ; causing 10-30s startup delay on a fresh install).  Requires elevation;
  ; silently fails on non-admin per-user installs (no harm done).
  DetailPrint "Configuring Windows Defender exclusion..."
  nsExec::ExecToStack `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Add-MpPreference -ExclusionPath '$INSTDIR' -ErrorAction SilentlyContinue"`
  Pop $0
  Pop $1

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
  ; Remove Windows Defender exclusion added during install
  nsExec::ExecToStack `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Remove-MpPreference -ExclusionPath '$INSTDIR' -ErrorAction SilentlyContinue"`
  Pop $0
  Pop $1

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

  ; Ask user if they want to remove AppData (preserves .openclaw)
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Do you want to remove ClawX application data?$\r$\n$\r$\nThis will delete:$\r$\n  • AppData\Local\clawx (local app data)$\r$\n  • AppData\Roaming\clawx (roaming app data)$\r$\n$\r$\nYour .openclaw folder (configuration & skills) will be preserved.$\r$\nSelect 'No' to keep all data for future reinstallation." \
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

    ; --- Always remove current user's AppData first ---
    ; NOTE: .openclaw directory is intentionally preserved (user configuration & skills)
    RMDir /r "$LOCALAPPDATA\clawx"
    RMDir /r "$APPDATA\clawx"

    ; --- Retry: if directories still exist (locked files), wait and try again ---

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

    ; ExpandEnvStrings requires distinct src and dest registers
    ExpandEnvStrings $R3 $R2
    StrCmp $R3 $PROFILE _cu_enumNext

    ; NOTE: .openclaw directory is intentionally preserved for all users
    RMDir /r "$R3\AppData\Local\clawx"
    RMDir /r "$R3\AppData\Roaming\clawx"

  _cu_enumNext:
    IntOp $R0 $R0 + 1
    Goto _cu_enumLoop

  _cu_enumDone:
  _cu_skipRemove:
!macroend
