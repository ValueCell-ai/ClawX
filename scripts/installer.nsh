; ClawX Custom NSIS Installer/Uninstaller Script
;
; Install: enables long paths, adds resources\cli to user PATH for openclaw CLI.
; Uninstall: removes the PATH entry and optionally deletes user data.

!macro customInstall
  ; Enable Windows long path support (Windows 10 1607+ / Windows 11).
  ; pnpm virtual store paths can exceed the default MAX_PATH limit of 260 chars.
  ; Writing to HKLM requires admin privileges; on per-user installs without
  ; elevation this call silently fails — no crash, just no key written.
  WriteRegDWORD HKLM "SYSTEM\CurrentControlSet\Control\FileSystem" "LongPathsEnabled" 1

  ; Add resources\cli to the current user's PATH for openclaw CLI.
  ; Read current PATH, skip if already present, append otherwise.
  ReadRegStr $0 HKCU "Environment" "Path"
  StrCmp $0 "" _ci_setNew

  ; Check if our CLI dir is already in PATH
  Push "$INSTDIR\resources\cli"
  Push $0
  Call _ci_StrContains
  Pop $1
  StrCmp $1 "" 0 _ci_done

  ; Append to existing PATH
  StrCpy $0 "$0;$INSTDIR\resources\cli"
  Goto _ci_write

  _ci_setNew:
    StrCpy $0 "$INSTDIR\resources\cli"

  _ci_write:
    WriteRegExpandStr HKCU "Environment" "Path" $0
    ; Broadcast WM_SETTINGCHANGE so running Explorer/terminals pick up the change
    SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=500

  _ci_done:
!macroend

; Helper: check if $R0 (needle) is found within $R1 (haystack).
; Pushes needle then haystack before call; pops result (needle if found, "" if not).
Function _ci_StrContains
  Exch $R1 ; haystack
  Exch
  Exch $R0 ; needle
  Push $R2
  Push $R3
  Push $R4

  StrLen $R3 $R0
  StrLen $R4 $R1
  IntOp $R4 $R4 - $R3

  StrCpy $R2 0
  _ci_loop:
    IntCmp $R2 $R4 0 0 _ci_notfound
    StrCpy $1 $R1 $R3 $R2
    StrCmp $1 $R0 _ci_found
    IntOp $R2 $R2 + 1
    Goto _ci_loop

  _ci_found:
    StrCpy $R0 $R0
    Goto _ci_end

  _ci_notfound:
    StrCpy $R0 ""

  _ci_end:
    Pop $R4
    Pop $R3
    Pop $R2
    Pop $R1
    Exch $R0
FunctionEnd

!macro customUnInstall
  ; Remove resources\cli from user PATH
  ReadRegStr $0 HKCU "Environment" "Path"
  StrCmp $0 "" _cu_pathDone

  ; Remove our entry (with leading or trailing semicolons)
  Push $0
  Push "$INSTDIR\resources\cli"
  Call un._cu_RemoveFromPath
  Pop $0
  WriteRegExpandStr HKCU "Environment" "Path" $0
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=500

  _cu_pathDone:

  ; Ask user if they want to completely remove all user data
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Do you want to completely remove all ClawX user data?$\r$\n$\r$\nThis will delete:$\r$\n  • .openclaw folder (configuration & skills)$\r$\n  • AppData\Local\clawx (local app data)$\r$\n  • AppData\Roaming\clawx (roaming app data)$\r$\n$\r$\nSelect 'No' to keep your data for future reinstallation." \
    /SD IDNO IDYES _cu_removeData IDNO _cu_skipRemove

  _cu_removeData:
    ; --- Always remove current user's data first ---
    RMDir /r "$PROFILE\.openclaw"
    RMDir /r "$LOCALAPPDATA\clawx"
    RMDir /r "$APPDATA\clawx"

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

; Uninstaller helper: remove a substring from a semicolon-delimited PATH string.
; Push haystack, push needle before call; pops cleaned string.
Function un._cu_RemoveFromPath
  Exch $R0 ; needle
  Exch
  Exch $R1 ; haystack

  ; Try removing ";needle" (entry in the middle or end)
  Push "$R1"
  Push ";$R0"
  Call un._ci_StrReplace
  Pop $R1

  ; Try removing "needle;" (entry at the start)
  Push "$R1"
  Push "$R0;"
  Call un._ci_StrReplace
  Pop $R1

  ; Try removing exact match (only entry)
  StrCmp $R1 $R0 0 +2
    StrCpy $R1 ""

  Pop $R0
  Exch $R1
FunctionEnd

; Uninstaller helper: remove first occurrence of needle from haystack.
; Push haystack, push needle; pops result.
Function un._ci_StrReplace
  Exch $R0 ; needle
  Exch
  Exch $R1 ; haystack
  Push $R2
  Push $R3
  Push $R4
  Push $R5

  StrLen $R3 $R0
  StrLen $R4 $R1
  StrCpy $R5 ""
  StrCpy $R2 0

  _usr_loop:
    IntCmp $R2 $R4 _usr_done _usr_done
    StrCpy $1 $R1 $R3 $R2
    StrCmp $1 $R0 _usr_found
    StrCpy $1 $R1 1 $R2
    StrCpy $R5 "$R5$1"
    IntOp $R2 $R2 + 1
    Goto _usr_loop

  _usr_found:
    ; Copy the part after the needle
    IntOp $R2 $R2 + $R3
    StrCpy $1 $R1 "" $R2
    StrCpy $R5 "$R5$1"

  _usr_done:
    StrCpy $R1 $R5
    Pop $R5
    Pop $R4
    Pop $R3
    Pop $R2
    Pop $R0
    Exch $R1
FunctionEnd
