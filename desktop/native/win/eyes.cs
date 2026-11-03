// persuna-eyes for Windows: the window in front (skipping Persuna's own
// process), its buttons, fields, links and text, with frames in physical
// screen pixels, from UI Automation — and one approved action at a time on
// the same connection. Nothing leaves the computer.
//
//   persuna-eyes serve          Stays running. One request per line on stdin,
//                               one JSON line back. Ends when stdin closes, so
//                               it can't outlive Persuna.
//   persuna-eyes read <pid>     One read, then exit (for tests).
//
// Requests (base64 is UTF-8 text; <skip> is Persuna's pid, whose windows and
// focus never count):
//   read <skip>                 The front window's elements (see Read).
//   click <skip> <x> <y>       Invoke the element under the point, else a real
//                               mouse click there. Answers {"done":true,"how":
//                               "invoke"|"mouse"}. Points are physical pixels.
//   type <skip> <b64-text>      Append to the focused field: its own setter
//                               when it has one (ValuePattern), else real
//                               keystrokes. Answers {"done":true,"how":
//                               "value"|"keys"}.
//   set <skip> <b64-label> <b64-text>
//                               Replace the named field's text (ValuePattern).
//   invoke <skip> <b64-label>   Press the named button or link (InvokePattern).
//   select <skip> <b64-label>   Choose the named list item (SelectionItem).
//   key <skip> <mods|-> <name>  Press a key (enter, tab, escape, space, arrows,
//                               delete, a-z, 0-9); mods comma-joins ctrl, shift,
//                               alt. Answers {"done":true}.
//   open <skip> <b64-app>       Start an app by plain name (no paths).
//
// An act answers {"done":true,...} or {"done":false,"why":"..."}; type and set
// include "length" when the field exposes it (re-read, never its text).
// Anything else — an unknown request, a crash — answers {"error":"..."}.
//
// Built by build.js with the C# compiler that comes with Windows, so it needs
// nothing installed and one file runs on both x64 and arm64.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Automation;

static class Eyes
{
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attribute, out int value, int size);
    [DllImport("user32.dll")] static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    [DllImport("user32.dll")] static extern short VkKeyScan(char ch);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

    const uint GW_HWNDNEXT = 2;
    const int DWMWA_CLOAKED = 14;
    const uint KEYEVENTF_KEYUP = 0x0002;
    const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    const uint MOUSEEVENTF_LEFTUP = 0x0004;
    const int MaxItems = 220;
    const int MaxVisits = 3000;
    const int MaxChildren = 120;
    const int MaxLabel = 160;
    const int WalkMs = 1200;
    const int MaxType = 2000;
    const int MaxValue = 100000;

    static readonly Dictionary<string, string> Roles = new Dictionary<string, string>
    {
        { "ControlType.Button", "button" }, { "ControlType.SplitButton", "button" },
        { "ControlType.MenuItem", "menu item" }, { "ControlType.Hyperlink", "link" },
        { "ControlType.Edit", "field" }, { "ControlType.Document", "text box" },
        { "ControlType.CheckBox", "checkbox" }, { "ControlType.RadioButton", "option" },
        { "ControlType.TabItem", "tab" }, { "ControlType.ComboBox", "menu" },
        { "ControlType.Text", "text" }, { "ControlType.Image", "image" },
        { "ControlType.ListItem", "item" }, { "ControlType.TreeItem", "item" },
        { "ControlType.DataItem", "cell" }, { "ControlType.Header", "heading" },
        { "ControlType.HeaderItem", "heading" },
    };

    [MTAThread]
    static int Main(string[] args)
    {
        // Physical pixels on every monitor, whatever its scaling.
        try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch (Exception) { }

        var output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
        output.AutoFlush = true;
        var command = args.Length > 0 ? args[0] : "";

        if (command == "read")
        {
            output.WriteLine(Answer("read " + (args.Length > 1 ? args[1] : "0")));
            return 0;
        }
        if (command != "serve")
        {
            Console.Error.WriteLine("usage: persuna-eyes serve | read <skip-pid>");
            return 2;
        }
        var input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
        string line;
        while ((line = input.ReadLine()) != null)
        {
            output.WriteLine(Answer(line));
        }
        return 0;
    }

    static readonly Dictionary<string, byte> KeyNames = new Dictionary<string, byte>
    {
        { "enter", 0x0D }, { "tab", 0x09 }, { "escape", 0x1B }, { "space", 0x20 },
        { "up", 0x26 }, { "down", 0x28 }, { "left", 0x25 }, { "right", 0x27 },
        { "delete", 0x2E },
    };

    static readonly Dictionary<string, byte> ModNames = new Dictionary<string, byte>
    {
        { "ctrl", 0x11 }, { "shift", 0x10 }, { "alt", 0x12 },
    };

    /// <summary>One request, one line of JSON. A failure is an answer, never a crash.</summary>
    static string Answer(string line)
    {
        try
        {
            var parts = line.Trim().Split(' ');
            uint skip;
            if (parts.Length == 2 && parts[0] == "read" && uint.TryParse(parts[1], out skip))
            {
                return Read(skip);
            }
            if (parts.Length >= 3 && uint.TryParse(parts[1], out skip))
            {
                if (parts[0] == "click" && parts.Length == 4) return Click(parts[2], parts[3]);
                if (parts[0] == "type" && parts.Length == 3) return TypeIntoFocus(skip, Decode(parts[2]));
                if (parts[0] == "set" && parts.Length == 4) return SetNamed(skip, Decode(parts[2]), Decode(parts[3]));
                if (parts[0] == "invoke" && parts.Length == 3) return InvokeNamed(skip, Decode(parts[2]));
                if (parts[0] == "select" && parts.Length == 3) return SelectNamed(skip, Decode(parts[2]));
                if (parts[0] == "key" && parts.Length == 4) return PressKey(parts[2], parts[3]);
                if (parts[0] == "open" && parts.Length == 3) return OpenApp(Decode(parts[2]));
            }
            return "{\"error\":\"unknown request\"}";
        }
        catch (Exception error)
        {
            return "{\"error\":" + Quote(error.GetType().Name) + "}";
        }
    }

    static string Decode(string text)
    {
        return Encoding.UTF8.GetString(Convert.FromBase64String(text));
    }

    static string Done(string extra)
    {
        return "{\"done\":true" + extra + "}";
    }

    static string Undone(string why)
    {
        return "{\"done\":false,\"why\":" + Quote(why) + "}";
    }

    /// <summary>First element in the front window named exactly this, in tree order.</summary>
    static AutomationElement FindNamed(IntPtr front, string label)
    {
        var want = (label ?? "").Trim();
        if (want.Length == 0) return null;
        var root = AutomationElement.FromHandle(front);
        var walker = TreeWalker.ControlViewWalker;
        var queue = new Queue<AutomationElement>();
        queue.Enqueue(root);
        var visits = 0;
        var clock = Stopwatch.StartNew();
        while (queue.Count > 0 && visits < MaxVisits && clock.ElapsedMilliseconds < WalkMs)
        {
            var element = queue.Dequeue();
            visits++;
            try
            {
                if (string.Equals((element.Current.Name ?? "").Trim(), want, StringComparison.OrdinalIgnoreCase))
                {
                    return element;
                }
                var child = walker.GetFirstChild(element);
                for (var n = 0; child != null && n < MaxChildren; n++)
                {
                    queue.Enqueue(child);
                    child = walker.GetNextSibling(child);
                }
            }
            catch (Exception)
            {
                // That element went away, or won't answer: carry on with the rest.
            }
        }
        return null;
    }

    /// <summary>The front window's named element, or null with the answer already decided.</summary>
    static AutomationElement FrontNamed(uint skip, string label, out string undone)
    {
        undone = null;
        var front = FrontWindow(skip);
        if (front == IntPtr.Zero)
        {
            undone = Undone("not found");
            return null;
        }
        var element = FindNamed(front, label);
        if (element == null) undone = Undone("not found");
        return element;
    }

    /// <summary>Press the named button or link. A wrong window fails closed: its names won't match.</summary>
    static string InvokeNamed(uint skip, string label)
    {
        string undone;
        var element = FrontNamed(skip, label, out undone);
        if (element == null) return undone;
        object pattern;
        if (!element.TryGetCurrentPattern(InvokePattern.Pattern, out pattern)) return Undone("can't invoke that");
        ((InvokePattern)pattern).Invoke();
        return Done("");
    }

    /// <summary>Choose the named list, tab or tree item.</summary>
    static string SelectNamed(uint skip, string label)
    {
        string undone;
        var element = FrontNamed(skip, label, out undone);
        if (element == null) return undone;
        object pattern;
        if (!element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pattern)) return Undone("can't select that");
        ((SelectionItemPattern)pattern).Select();
        return Done("");
    }

    /// <summary>A field's length, re-read after a write. The length only, never the text.</summary>
    static int ValueLength(AutomationElement element, int fallback)
    {
        try
        {
            var value = element.GetCurrentPropertyValue(ValuePattern.ValueProperty) as string;
            return value != null ? value.Length : fallback;
        }
        catch (Exception)
        {
            return fallback;
        }
    }

    /// <summary>Replace the named field's text. Refuses read-only fields.</summary>
    static string SetNamed(uint skip, string label, string text)
    {
        if (text.Length > MaxType) return Undone("too long");
        string undone;
        var element = FrontNamed(skip, label, out undone);
        if (element == null) return undone;
        object pattern;
        if (!element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) return Undone("needs a text field");
        var field = (ValuePattern)pattern;
        if (field.Current.IsReadOnly) return Undone("needs a text field");
        field.SetValue(text);
        return "{\"done\":true,\"length\":" + ValueLength(element, text.Length) + "}";
    }

    /// <summary>
    /// Append to the focused field: its own setter when it has one, else real
    /// keystrokes (Notepad's editor takes no ValuePattern). Refuses when
    /// Persuna itself still holds the focus — typing must never land in
    /// Persuna — or when any char has no key on this layout (checked first,
    /// so it never half-types).
    /// </summary>
    static string TypeIntoFocus(uint skip, string text)
    {
        if (text.Length > MaxType) return Undone("too long");
        AutomationElement focused;
        try
        {
            focused = AutomationElement.FocusedElement;
        }
        catch (Exception)
        {
            return Undone("nothing is focused");
        }
        if (focused == null) return Undone("nothing is focused");
        try
        {
            if (focused.Current.ProcessId == skip) return Undone("nothing is focused");
        }
        catch (Exception)
        {
            return Undone("nothing is focused");
        }
        object pattern;
        if (focused.TryGetCurrentPattern(ValuePattern.Pattern, out pattern))
        {
            var field = (ValuePattern)pattern;
            if (!field.Current.IsReadOnly)
            {
                var current = field.Current.Value ?? "";
                if (current.Length > MaxValue) return Undone("field is too full");
                field.SetValue(current + text);
                return "{\"done\":true,\"how\":\"value\",\"length\":"
                    + ValueLength(focused, current.Length + text.Length) + "}";
            }
        }
        var keys = new List<short>();
        foreach (var c in text)
        {
            var key = VkKeyScan(c);
            var shift = (key >> 8) & 0xFF;
            if (key == -1 || (shift != 0 && shift != 1)) return Undone("can't type that");
            keys.Add(key);
        }
        foreach (var key in keys)
        {
            var code = (byte)(key & 0xFF);
            var shifted = ((key >> 8) & 0xFF) == 1;
            if (shifted) keybd_event(0x10, 0, 0, UIntPtr.Zero);
            keybd_event(code, 0, 0, UIntPtr.Zero);
            keybd_event(code, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
            if (shifted) keybd_event(0x10, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        }
        var length = TextLength(focused);
        return "{\"done\":true,\"how\":\"keys\"" + (length >= 0 ? ",\"length\":" + length : "") + "}";
    }

    /// <summary>Focused text's length via TextPattern, or -1 when it won't say.</summary>
    static int TextLength(AutomationElement element)
    {
        try
        {
            object pattern;
            if (!element.TryGetCurrentPattern(TextPattern.Pattern, out pattern)) return -1;
            var text = ((TextPattern)pattern).DocumentRange.GetText(MaxValue);
            return text != null ? text.Length : -1;
        }
        catch (Exception)
        {
            return -1;
        }
    }

    /// <summary>
    /// Click a point: invoke the element under it when it presses like a button,
    /// else move the mouse there and click for real. Points are physical pixels.
    /// </summary>
    static string Click(string xs, string ys)
    {
        int x, y;
        if (!int.TryParse(xs, out x) || !int.TryParse(ys, out y) || x < 0 || y < 0 || x > 10000 || y > 10000)
        {
            return Undone("bad point");
        }
        try
        {
            var hit = AutomationElement.FromPoint(new System.Windows.Point(x, y));
            if (hit != null)
            {
                object pattern;
                if (hit.TryGetCurrentPattern(InvokePattern.Pattern, out pattern))
                {
                    ((InvokePattern)pattern).Invoke();
                    return "{\"done\":true,\"how\":\"invoke\"}";
                }
            }
        }
        catch (Exception)
        {
            // Nothing pressable there: fall through to the mouse.
        }
        SetCursorPos(x, y);
        mouse_event(MOUSEEVENTF_LEFTDOWN | MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
        return "{\"done\":true,\"how\":\"mouse\"}";
    }

    /// <summary>Press one key, holding the named modifiers. Only the allowlisted keys exist.</summary>
    static string PressKey(string mods, string name)
    {
        byte code;
        if (name.Length == 1
            && ((name[0] >= 'a' && name[0] <= 'z') || (name[0] >= '0' && name[0] <= '9')))
        {
            code = (byte)char.ToUpperInvariant(name[0]);
        }
        else if (!KeyNames.TryGetValue(name, out code))
        {
            return Undone("bad key");
        }
        var held = new List<byte>();
        if (mods != "-")
        {
            foreach (var mod in mods.Split(','))
            {
                byte modCode;
                if (!ModNames.TryGetValue(mod, out modCode)) return Undone("bad key");
                if (!held.Contains(modCode)) held.Add(modCode);
            }
        }
        foreach (var mod in held)
        {
            keybd_event(mod, 0, 0, UIntPtr.Zero);
            Thread.Sleep(5);
        }
        keybd_event(code, 0, 0, UIntPtr.Zero);
        Thread.Sleep(5);
        keybd_event(code, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        Thread.Sleep(5);
        for (var i = held.Count - 1; i >= 0; i--)
        {
            keybd_event(held[i], 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
            Thread.Sleep(5);
        }
        return Done("");
    }

    /// <summary>Start an app by plain name. Anything path-shaped is refused.</summary>
    static string OpenApp(string name)
    {
        var app = (name ?? "").Trim();
        if (app.Length == 0 || app.Length > 60) return Undone("bad name");
        foreach (var c in app)
        {
            if (!(char.IsLetterOrDigit(c) || c == ' ' || c == '.' || c == '\'' || c == '-' || c == '_'))
            {
                return Undone("bad name");
            }
        }
        try
        {
            Process.Start(app);
            return Done("");
        }
        catch (Exception)
        {
            return Undone("can't open that");
        }
    }

    static bool Cloaked(IntPtr h)
    {
        int cloaked;
        return DwmGetWindowAttribute(h, DWMWA_CLOAKED, out cloaked, sizeof(int)) == 0 && cloaked != 0;
    }

    /// <summary>The window in front, or the next visible one if that's Persuna.</summary>
    static IntPtr FrontWindow(uint skip)
    {
        var h = GetForegroundWindow();
        for (var i = 0; i < 50 && h != IntPtr.Zero; i++)
        {
            uint owner;
            GetWindowThreadProcessId(h, out owner);
            if (owner != skip && IsWindowVisible(h) && !Cloaked(h)) return h;
            h = GetWindow(h, GW_HWNDNEXT);
        }
        return IntPtr.Zero;
    }

    static string Label(string text)
    {
        var label = text.Trim();
        return label.Length > MaxLabel ? label.Substring(0, MaxLabel) : label;
    }

    static string Read(uint skip)
    {
        var front = FrontWindow(skip);
        if (front == IntPtr.Zero) return "{\"trusted\":true,\"app\":\"\",\"window\":\"\",\"items\":[]}";

        var root = AutomationElement.FromHandle(front);
        var walker = TreeWalker.ControlViewWalker;
        var items = new List<string>();
        var queue = new Queue<AutomationElement>();
        queue.Enqueue(root);
        var visits = 0;
        var clock = Stopwatch.StartNew();
        while (queue.Count > 0 && items.Count < MaxItems && visits < MaxVisits && clock.ElapsedMilliseconds < WalkMs)
        {
            var element = queue.Dequeue();
            visits++;
            try
            {
                var current = element.Current;
                var box = current.BoundingRectangle;
                string role;
                if (Roles.TryGetValue(current.ControlType.ProgrammaticName, out role)
                    && !string.IsNullOrEmpty(current.Name) && !current.IsOffscreen
                    && !box.IsEmpty && box.Width > 2 && box.Height > 2)
                {
                    items.Add("{\"role\":" + Quote(role) + ",\"label\":" + Quote(Label(current.Name))
                        + ",\"x\":" + (int)box.X + ",\"y\":" + (int)box.Y
                        + ",\"w\":" + (int)box.Width + ",\"h\":" + (int)box.Height + "}");
                }
                var child = walker.GetFirstChild(element);
                for (var n = 0; child != null && n < MaxChildren; n++)
                {
                    queue.Enqueue(child);
                    child = walker.GetNextSibling(child);
                }
            }
            catch (Exception)
            {
                // That element went away, or won't answer: carry on with the rest.
            }
        }

        var pid = root.Current.ProcessId;
        var json = new StringBuilder("{\"trusted\":true,\"app\":");
        json.Append(Quote(ProcessName(pid)));
        json.Append(",\"window\":").Append(Quote(root.Current.Name ?? ""));
        json.Append(",\"items\":[").Append(string.Join(",", items)).Append("]");
        json.Append(",\"focus\":").Append(Focus(pid)).Append("}");
        return json.ToString();
    }

    static string ProcessName(int pid)
    {
        try
        {
            using (var process = Process.GetProcessById(pid)) return process.ProcessName;
        }
        catch (Exception)
        {
            return "";
        }
    }

    /// <summary>The focused element (what the user is in), when it's in the front window.</summary>
    static string Focus(int pid)
    {
        try
        {
            var focused = AutomationElement.FocusedElement;
            if (focused == null) return "null";
            var current = focused.Current;
            string role;
            if (current.ProcessId != pid || string.IsNullOrEmpty(current.Name)
                || !Roles.TryGetValue(current.ControlType.ProgrammaticName, out role))
            {
                return "null";
            }
            return "{\"role\":" + Quote(role) + ",\"label\":" + Quote(Label(current.Name)) + "}";
        }
        catch (Exception)
        {
            return "null";
        }
    }

    static string Quote(string text)
    {
        var json = new StringBuilder("\"");
        foreach (var c in text)
        {
            if (c == '"') json.Append("\\\"");
            else if (c == '\\') json.Append("\\\\");
            else if (c < ' ') json.Append("\\u").Append(((int)c).ToString("x4"));
            else json.Append(c);
        }
        return json.Append('"').ToString();
    }
}
