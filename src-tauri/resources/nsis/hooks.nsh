; NoteBoard NSIS Hooks
; NSIS_HOOK_POSTINSTALL: 手写文件关联注册表项
; NSIS_HOOK_POSTUNINSTALL: 清理注册表项
; 详见 docs/09-开发路线图.md 14.4/14.5

!macro NSIS_HOOK_POSTINSTALL
  ; 清理旧版内置更新器遗留的批处理，防止卸载旧版并安装完成后再次启动 NoteBoard
  ; 仅处理系统临时目录中的更新脚本，不触碰 %APPDATA%\NoteBoard 用户数据
  Delete "$TEMP\NoteBoard-updates\apply_update.cmd"

  ; 注册应用程序
  WriteRegStr HKCU "Software\Classes\Applications\NoteBoard.exe" "" "NoteBoard"
  WriteRegStr HKCU "Software\Classes\Applications\NoteBoard.exe\shell\open\command" "" '"$INSTDIR\NoteBoard.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\Applications\NoteBoard.exe" "FriendlyAppName" "NoteBoard"
  WriteRegStr HKCU "Software\Classes\Applications\NoteBoard.exe" "SupportedTypes" ".md;.markdown;.txt;.json;.yaml;.yml;.sql;.js;.ts;.py;.rs;.go;.java;.c;.cpp;.cs;.sh;.css;.xml;.html;.excalidraw"
  WriteRegStr HKCU "Software\Classes\Applications\NoteBoard.exe\SupportedTypes" ".nb" ""
  WriteRegStr HKCU "Software\Classes\Applications\NoteBoard.exe\SupportedTypes" ".nbdoc" ""

  ; .nb is shared with Wolfram. Preserve the merged system/user default;
  ; Windows UserChoice is deliberately never modified.
  ReadRegStr $R0 HKCR ".nb" ""
  ${If} $R0 == ""
    WriteRegStr HKCU "Software\Classes\.nb" "" "NoteBoard.Document"
  ${EndIf}
  WriteRegStr HKCU "Software\Classes\.nb\OpenWithProgids" "NoteBoard.Document" ""
  WriteRegStr HKCU "Software\Classes\.nbdoc\OpenWithProgids" "NoteBoard.Document" ""
  !insertmacro NB_DOCUMENT_CONTEXT "nb"
  !insertmacro NB_DOCUMENT_CONTEXT "nbdoc"

  ; 为每个扩展名注册 OpenWithProgids
  !define EXTENSIONS ".md;.markdown;.txt;.json;.yaml;.yml;.sql;.js;.ts;.py;.rs;.go;.java;.c;.cpp;.cs;.sh;.css;.xml;.html;.excalidraw"

  ; Markdown 文件关联
  WriteRegStr HKCU "Software\Classes\.md\OpenWithProgids" "NoteBoard" ""
  WriteRegStr HKCU "Software\Classes\.markdown\OpenWithProgids" "NoteBoard" ""
  WriteRegStr HKCU "Software\Classes\.txt\OpenWithProgids" "NoteBoard" ""
  WriteRegStr HKCU "Software\Classes\.json\OpenWithProgids" "NoteBoard" ""
  WriteRegStr HKCU "Software\Classes\.yaml\OpenWithProgids" "NoteBoard" ""
  WriteRegStr HKCU "Software\Classes\.yml\OpenWithProgids" "NoteBoard" ""
  WriteRegStr HKCU "Software\Classes\.excalidraw\OpenWithProgids" "NoteBoard" ""

  ; Tauri's update mode leaves existing shortcuts intact. Give NoteBoard-owned
  ; shortcuts a dedicated icon path and repair desktop links made by Codex's
  ; LocalCache installer so they launch this installation.
  !insertmacro NB_REPAIR_SHORTCUT "$DESKTOP\${PRODUCTNAME}.lnk"
  !insertmacro NB_REPAIR_SHORTCUT "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  ${If} $AppStartMenuFolder != ""
    !insertmacro NB_REPAIR_SHORTCUT "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
  ${EndIf}

  ; 刷新 Shell 缓存
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, i 0, i 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; 清理应用程序注册
  DeleteRegKey HKCU "Software\Classes\Applications\NoteBoard.exe"
  ReadRegStr $R0 HKCU "Software\Classes\.nb" ""
  ${If} $R0 == "NoteBoard.Document"
    DeleteRegValue HKCU "Software\Classes\.nb" ""
  ${EndIf}
  DeleteRegValue HKCU "Software\Classes\.nb\OpenWithProgids" "NoteBoard.Document"
  DeleteRegValue HKCU "Software\Classes\.nbdoc\OpenWithProgids" "NoteBoard.Document"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.nb\shell\NoteBoard.Open"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.nbdoc\shell\NoteBoard.Open"

  ; 清理文件关联
  DeleteRegValue HKCU "Software\Classes\.md\OpenWithProgids" "NoteBoard"
  DeleteRegValue HKCU "Software\Classes\.markdown\OpenWithProgids" "NoteBoard"
  DeleteRegValue HKCU "Software\Classes\.txt\OpenWithProgids" "NoteBoard"
  DeleteRegValue HKCU "Software\Classes\.json\OpenWithProgids" "NoteBoard"
  DeleteRegValue HKCU "Software\Classes\.yaml\OpenWithProgids" "NoteBoard"
  DeleteRegValue HKCU "Software\Classes\.yml\OpenWithProgids" "NoteBoard"
  DeleteRegValue HKCU "Software\Classes\.excalidraw\OpenWithProgids" "NoteBoard"

  ; 刷新 Shell 缓存
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, i 0, i 0)'
!macroend

!macro NB_DOCUMENT_CONTEXT EXT
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.${EXT}\shell\NoteBoard.Open" "" "用 NoteBoard 打开"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.${EXT}\shell\NoteBoard.Open" "Icon" "$INSTDIR\NoteBoard.exe,0"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.${EXT}\shell\NoteBoard.Open\command" "" '"$INSTDIR\NoteBoard.exe" "%1"'
!macroend

!macro NB_REPAIR_SHORTCUT SHORTCUT
  ${If} ${FileExists} "${SHORTCUT}"
    !insertmacro ComHlpr_CreateInProcInstance ${CLSID_ShellLink} ${IID_IShellLink} r0 .r6
    ${If} $6 >= 0
    ${AndIf} $0 P<> 0
      ${IUnknown::QueryInterface} $0 '("${IID_IPersistFile}",.r1).r6'
      ${If} $6 >= 0
      ${AndIf} $1 P<> 0
        ${IPersistFile::Load} $1 '("${SHORTCUT}", ${STGM_READWRITE}).r6'
        ${If} $6 >= 0
          ; A t output parameter allocates its own NSIS string buffer. Keep
          ; the returned path in $2; no System::Alloc/System::Free is needed.
          ${IShellLink::GetPath} $0 '(.r2, ${NSIS_MAX_STRLEN}, 0, ${SLGP_RAWPATH}).r6'
          ${If} $6 >= 0
            StrCpy $5 0
            ${If} $2 == "$INSTDIR\${MAINBINARYNAME}.exe"
              StrCpy $5 1
            ${Else}
              ; Only migrate NoteBoard links that point into a packaged app's
              ; LocalCache. Do not take over unrelated shortcuts with this name.
              StrLen $3 "$LOCALAPPDATA\Packages\"
              StrCpy $4 $2 $3
              ${If} $4 == "$LOCALAPPDATA\Packages\"
                StrLen $3 "\LocalCache\Local\NoteBoard\${MAINBINARYNAME}.exe"
                IntOp $3 0 - $3
                StrCpy $4 $2 "" $3
                ${If} $4 == "\LocalCache\Local\NoteBoard\${MAINBINARYNAME}.exe"
                  ${IShellLink::SetPath} $0 '(w "$INSTDIR\${MAINBINARYNAME}.exe").r6'
                  ${If} $6 >= 0
                    StrCpy $5 1
                  ${EndIf}
                ${EndIf}
              ${EndIf}
            ${EndIf}
            ${If} $5 = 1
              ${IShellLink::SetIconLocation} $0 '(w "$INSTDIR\NoteBoard-white-pen.ico",0).r6'
              ${If} $6 >= 0
                ${IPersistFile::Save} $1 '("${SHORTCUT}",1).r6'
                ${If} $6 >= 0
                  ; Refresh this shortcut's shell view without disturbing
                  ; Explorer or the machine-wide icon cache.
                  System::Call 'shell32::SHChangeNotify(i 0x00002000, i 0x00001005, w "${SHORTCUT}", p 0)'
                ${EndIf}
              ${EndIf}
            ${EndIf}
          ${EndIf}
        ${EndIf}
        ${IUnknown::Release} $1 ""
      ${EndIf}
      ${IUnknown::Release} $0 ""
    ${EndIf}
  ${EndIf}
!macroend
