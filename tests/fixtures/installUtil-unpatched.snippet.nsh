Function uninstallOldVersion
  StrCpy $uninstallerFileNameTemp "$PLUGINSDIR\old-uninstaller.exe"
  !insertmacro copyFile "$uninstallerFileName" "$uninstallerFileNameTemp"

  # Retry counter
  StrCpy $R5 0

  UninstallLoop:
    IntOp $R5 $R5 + 1

    ${if} $R5 > 5
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY OneMoreAttempt
      Return
    ${endIf}

  OneMoreAttempt:
    ExecWait '"$uninstallerFileNameTemp" /S /KEEP_APP_DATA $0 _?=$installationDir' $R0
    ifErrors TryInPlace CheckResult

    TryInPlace:
      ExecWait '"$uninstallerFileName" /S /KEEP_APP_DATA $0 _?=$installationDir' $R0
      ifErrors DoesNotExist

    CheckResult:
      ${if} $R0 == 0
        Return
      ${endIf}

    Sleep 1000
    Goto UninstallLoop

  DoesNotExist:
    SetErrors
FunctionEnd
