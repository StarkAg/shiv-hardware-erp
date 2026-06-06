Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

shell.Run """" & scriptDir & "\print-server\start-windows.cmd" & """", 0, False
shell.Run """" & scriptDir & "\start-panel.cmd" & """", 0, False
