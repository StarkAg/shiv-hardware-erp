' Launches print-selected.ps1 with no console window (used by the Ctrl+Alt+P shortcut).
' Usage: wscript print-selected.vbs [Color | "Black & White"]
Dim shell, script, mode
Set shell = CreateObject("WScript.Shell")
script = Replace(WScript.ScriptFullName, ".vbs", ".ps1")
mode = ""
If WScript.Arguments.Count > 0 Then mode = WScript.Arguments(0)
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & script & """ -Mode """ & mode & """", 0, False
