
Option Explicit

Dim shell, fso, projectDir, logDir, logFile
Dim pidFile, command, file
Dim maxLogSize, maxBackups, i
Dim psCommand

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

projectDir = fso.GetAbsolutePathName(shell.CurrentDirectory)
logDir = projectDir & "\logs"
logFile = logDir & "\office-dashboard.log"
pidFile = logDir & "\office-dashboard.pid"

maxLogSize = 5 * 1024 * 1024
maxBackups = 5

If Not fso.FolderExists(logDir) Then
    fso.CreateFolder(logDir)
End If

' Log rotation
If fso.FileExists(logFile) Then

    Set file = fso.GetFile(logFile)

    If file.Size >= maxLogSize Then

        Set file = Nothing

        If fso.FileExists(logFile & "." & maxBackups) Then
            fso.DeleteFile logFile & "." & maxBackups, True
        End If

        For i = maxBackups - 1 To 1 Step -1
            If fso.FileExists(logFile & "." & i) Then
                fso.MoveFile logFile & "." & i, _
                             logFile & "." & (i + 1)
            End If
        Next

        fso.MoveFile logFile, logFile & ".1"

    Else
        Set file = Nothing
    End If

End If

' Launch npm through hidden PowerShell process
psCommand = "$p = Start-Process -FilePath 'cmd.exe' " & _
    "-ArgumentList '/c npm start >> """ & logFile & """ 2>&1' " & _
    "-WorkingDirectory '" & Replace(projectDir, "'", "''") & "' " & _
    "-WindowStyle Hidden -PassThru; " & _
    "$p.Id | Set-Content -Path '" & Replace(pidFile, "'", "''") & "'"

command = "powershell.exe -NoProfile -WindowStyle Hidden -Command """ & _
          psCommand & """"

' Run hidden (0 = hidden, False = do not wait)
shell.Run command, 0, False

Set file = Nothing
Set shell = Nothing
Set fso = Nothing
