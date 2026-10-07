# NSIS hooks for Agent Studio (Windows).
# Creates an editable config directory under Program Files when installing
# for all users, and under %ProgramData%\AgentStudio always.

!macro NSIS_HOOK_POSTINSTALL
  ; Machine-wide editable config (writable without UAC for admins / ProgramData)
  CreateDirectory "$PROGRAMDATA\AgentStudio"
  ; Per-machine Program Files folder (all-users install)
  CreateDirectory "$PROGRAMFILES\AgentStudio"
  ; Copy example next to install dir resources if present
  IfFileExists "$INSTDIR\resources\agent-studio.yaml.example" 0 +3
    CopyFiles /SILENT "$INSTDIR\resources\agent-studio.yaml.example" "$PROGRAMDATA\AgentStudio\agent-studio.yaml.example"
    CopyFiles /SILENT "$INSTDIR\resources\agent-studio.yaml.example" "$PROGRAMFILES\AgentStudio\agent-studio.yaml.example"
  DetailPrint "Agent Studio: config folders ready. First launch opens the setup wizard."
!macroend

!macro NSIS_HOOK_PREINSTALL
!macroend

!macro NSIS_HOOK_PREUNINSTALL
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
!macroend
