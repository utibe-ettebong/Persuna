// persuna-eyes for Windows: the window in front (skipping Persuna's own
// process), its buttons, fields, links and text, with frames in physical
// screen pixels, from UI Automation. Nothing leaves the computer.
//
//   persuna-eyes serve          Stays running. One request per line on stdin
//                               ("read <skip-pid>"), one JSON line back. Ends
//                               when stdin closes, so it can't outlive Persuna.
//   persuna-eyes read <pid>     One read, then exit (for tests).
//
// Built by build.js with the C# compiler that comes with Windows, so it needs
// nothing installed and one file runs on both x64 and arm64.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Automation;

static class Eyes
{
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attribute, out int value, int size);

    const uint GW_HWNDNEXT = 2;
    const int DWMWA_CLOAKED = 14;
    const int MaxItems = 220;
    const int MaxVisits = 3000;
    const int MaxChildren = 120;
    const int MaxLabel = 160;
    const int WalkMs = 1200;

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
            return "{\"error\":\"unknown request\"}";
        }
        catch (Exception error)
        {
            return "{\"error\":" + Quote(error.GetType().Name) + "}";
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
