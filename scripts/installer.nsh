; ClawX Custom NSIS Uninstaller Script
; Provides a "Complete Removal" option during uninstallation
; to delete .openclaw config and AppData resources.
; Handles both per-user and per-machine (all users) installations.

!macro customUnInstall
  ; Ask user if they want to completely remove all user data
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Do you want to completely remove all ClawX user data?$\r$\n$\r$\nThis will delete:$\r$\n  • .openclaw folder (configuration & skills)$\r$\n  • AppData\Local\ClawX (local app data)$\r$\n  • AppData\Roaming\ClawX (roaming app data)$\r$\n$\r$\nSelect 'No' to keep your data for future reinstallation." \
    /SD IDNO IDYES _cu_removeData IDNO _cu_skipRemove

  _cu_removeData:
    ; --- Always remove current user's data first ---
    RMDir /r "$PROFILE\.openclaw"
    RMDir /r "$LOCALAPPDATA\ClawX"
    RMDir /r "$APPDATA\ClawX"

    ; --- For per-machine (all users) installs, enumerate all user profiles ---
    ; Registry key HKLM\...\ProfileList contains a subkey for each user SID.
    ; Each subkey has a ProfileImagePath value like "C:\Users\username"
    ; (which may contain unexpanded env vars like %SystemDrive%).
    ; We iterate all profiles, expand the path, skip the current user
    ; (already cleaned above), and remove data for every other user.
    ; RMDir /r silently does nothing if the directory doesn't exist or
    ; we lack permissions, so this is safe for per-user installs too.

    StrCpy $R0 0  ; Registry enum index

  _cu_enumLoop:
    EnumRegKey $R1 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList" $R0
    StrCmp $R1 "" _cu_enumDone  ; No more subkeys -> done

    ; Read ProfileImagePath for this SID
    ReadRegStr $R2 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$R1" "ProfileImagePath"
    StrCmp $R2 "" _cu_enumNext  ; Skip entries without a path

    ; ProfileImagePath may contain unexpanded env vars (e.g. %SystemDrive%),
    ; expand them to get the real path.
    ExpandEnvStrings $R2 $R2

    ; Skip the current user's profile (already cleaned above)
    StrCmp $R2 $PROFILE _cu_enumNext

    ; Remove .openclaw and AppData for this user profile
    RMDir /r "$R2\.openclaw"
    RMDir /r "$R2\AppData\Local\ClawX"
    RMDir /r "$R2\AppData\Roaming\ClawX"

  _cu_enumNext:
    IntOp $R0 $R0 + 1
    Goto _cu_enumLoop

  _cu_enumDone:
  _cu_skipRemove:
!macroend
