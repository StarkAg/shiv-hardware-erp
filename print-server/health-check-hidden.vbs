' Runs health-check.ps1 with no window, for the "Shiv Print Server Health" task.
' Waits for it to finish so the task never runs two checks at once.
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = scriptDir & "\health-check.ps1"
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -NonInteractive -File " & Chr(34) & ps1 & Chr(34)
shell.Run cmd, 0, True
