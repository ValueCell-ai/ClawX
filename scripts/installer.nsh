; ClawX Custom NSIS Uninstaller Script
; Provides a "Complete Removal" option during uninstallation
; to delete .openclaw config and AppData resources.
; Handles both per-user and per-machine (all users) installations.
; Supports Chinese (Simplified/Traditional) and English UI.

!macro customUnInstall
  ; Detect language: Chinese Simplified (2052), Chinese Traditional (1028)
  ; $LANGUAGE is set by the NSIS installer/uninstaller language selection.
  StrCmp $LANGUAGE "2052" _cu_useChinese
  StrCmp $LANGUAGE "1028" _cu_useChinese

  ; --- English message (default) ---
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Do you want to completely remove all ClawX user data?$\r$\n$\r$\nThis will delete:$\r$\n  • .openclaw folder (configuration & skills)$\r$\n  • AppData\Local\clawx (local app data)$\r$\n  • AppData\Roaming\clawx (roaming app data)$\r$\n$\r$\nSelect 'No' to keep your data for future reinstallation." \
    /SD IDNO IDYES _cu_removeData IDNO _cu_skipRemove
  Goto _cu_afterPrompt

  ; --- Chinese message ---
  _cu_useChinese:
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "是否完全移除所有 ClawX 用户数据？$\r$\n$\r$\n将删除以下内容：$\r$\n  • .openclaw 文件夹（配置和技能）$\r$\n  • AppData\Local\clawx（本地应用数据）$\r$\n  • AppData\Roaming\clawx（漫游应用数据）$\r$\n$\r$\n选择"否"可保留数据以便将来重新安装。" \
    /SD IDNO IDYES _cu_removeData IDNO _cu_skipRemove

  _cu_afterPrompt:
  Goto _cu_skipRemove

  _cu_removeData:
    ; --- Always remove current user's data first ---
    RMDir /r "$PROFILE\.openclaw"
    RMDir /r "$LOCALAPPDATA\clawx"
    RMDir /r "$APPDATA\clawx"

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
    RMDir /r "$R2\AppData\Local\clawx"
    RMDir /r "$R2\AppData\Roaming\clawx"

  _cu_enumNext:
    IntOp $R0 $R0 + 1
    Goto _cu_enumLoop

  _cu_enumDone:
  _cu_skipRemove:
!macroend
