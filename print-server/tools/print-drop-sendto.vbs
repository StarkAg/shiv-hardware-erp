' Right-click > Send to > Print ... : COPIES the selected files into the Print
' Drop folder (originals stay where they are); the print server prints them.
' Usage: wscript print-drop-sendto.vbs <subfolder or ""> <file> [<file> ...]
Option Explicit
Dim fso, shell, dropDir, target, i
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

dropDir = shell.ExpandEnvironmentStrings("%USERPROFILE%") & "\Print Drop"
target = dropDir
If WScript.Arguments.Count > 0 Then
  If WScript.Arguments(0) <> "auto" Then target = dropDir & "\" & WScript.Arguments(0)
End If
If Not fso.FolderExists(target) Then
  MsgBox "Print Drop folder not found:" & vbCrLf & target & vbCrLf & vbCrLf & "Is the Shiv Print Server running?", vbExclamation, "Shiv Print"
  WScript.Quit 1
End If

For i = 1 To WScript.Arguments.Count - 1
  If fso.FileExists(WScript.Arguments(i)) Then
    fso.CopyFile WScript.Arguments(i), target & "\", True
  End If
Next
