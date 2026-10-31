# persuna-eyes for Windows: the window in front (skipping Persuna's own
# process), its buttons, fields, links and text, with frames in physical
# screen pixels, from UI Automation. Prints one JSON object. Nothing leaves
# the computer. Usage: powershell -File eyes.ps1 -SkipPid <pid>
param([int]$SkipPid = 0)
$ErrorActionPreference = "SilentlyContinue"
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class PersunaWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@

$roles = @{
  "ControlType.Button" = "button"; "ControlType.SplitButton" = "button"; "ControlType.MenuItem" = "menu item"
  "ControlType.Hyperlink" = "link"; "ControlType.Edit" = "field"; "ControlType.Document" = "text box"
  "ControlType.CheckBox" = "checkbox"; "ControlType.RadioButton" = "option"; "ControlType.TabItem" = "tab"
  "ControlType.ComboBox" = "menu"; "ControlType.Text" = "text"; "ControlType.Image" = "image"
  "ControlType.ListItem" = "item"; "ControlType.TreeItem" = "item"; "ControlType.DataItem" = "cell"
  "ControlType.Header" = "heading"; "ControlType.HeaderItem" = "heading"
}

# The window in front, or the next visible one if that's Persuna.
$h = [PersunaWin]::GetForegroundWindow()
for ($i = 0; $i -lt 50 -and $h -ne [IntPtr]::Zero; $i++) {
  $owner = 0; [void][PersunaWin]::GetWindowThreadProcessId($h, [ref]$owner)
  if ($owner -ne $SkipPid -and [PersunaWin]::IsWindowVisible($h)) { break }
  $h = [PersunaWin]::GetWindow($h, 2) # GW_HWNDNEXT
}
if ($h -eq [IntPtr]::Zero) { '{"trusted":true,"app":"","window":"","items":[]}'; exit }

$root = [System.Windows.Automation.AutomationElement]::FromHandle($h)
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$items = New-Object System.Collections.ArrayList
$queue = New-Object System.Collections.Queue
$queue.Enqueue($root)
$visits = 0
$deadline = (Get-Date).AddMilliseconds(1200)
while ($queue.Count -gt 0 -and $items.Count -lt 220 -and $visits -lt 3000 -and (Get-Date) -lt $deadline) {
  $el = $queue.Dequeue(); $visits++
  $c = $el.Current
  $kind = $roles[$c.ControlType.ProgrammaticName]
  $r = $c.BoundingRectangle
  if ($kind -and $c.Name -and -not $c.IsOffscreen -and $r.Width -gt 2 -and $r.Height -gt 2) {
    $label = $c.Name.Trim()
    if ($label.Length -gt 160) { $label = $label.Substring(0, 160) }
    [void]$items.Add([ordered]@{ role = $kind; label = $label; x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height })
  }
  $child = $walker.GetFirstChild($el); $n = 0
  while ($child -ne $null -and $n -lt 120) { $queue.Enqueue($child); $child = $walker.GetNextSibling($child); $n++ }
}
$proc = Get-Process -Id $root.Current.ProcessId
# The focused element (what the user is in), when it's in the front window.
$focus = $null
try {
  $f = [System.Windows.Automation.AutomationElement]::FocusedElement
  if ($f -ne $null -and $f.Current.ProcessId -eq $root.Current.ProcessId) {
    $fc = $f.Current
    $fkind = $roles[$fc.ControlType.ProgrammaticName]
    if ($fkind -and $fc.Name) {
      $flabel = $fc.Name.Trim()
      if ($flabel.Length -gt 160) { $flabel = $flabel.Substring(0, 160) }
      $focus = [ordered]@{ role = $fkind; label = $flabel }
    }
  }
} catch {}
[ordered]@{ trusted = $true; app = $proc.ProcessName; window = $root.Current.Name; items = $items; focus = $focus } | ConvertTo-Json -Compress -Depth 4
