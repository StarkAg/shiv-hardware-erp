Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = scriptDir & "\start-watchdog.ps1"
cmd = "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -NonInteractive -File " & Chr(34) & ps1 & Chr(34)
shell.Run cmd, 0, False