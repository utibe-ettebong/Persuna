// persuna-eyes: what's on screen, read on the Mac itself.
//
//   persuna-eyes ax <skip-pid>   The app in front (skipping Persuna's own pid):
//                                its buttons, fields, links and text, with
//                                exact frames, from the accessibility tree.
//   persuna-eyes ocr <image>     The text in a screenshot, with boxes, from
//                                Apple's on-device text recognition.
//
// Prints one JSON object. Nothing leaves the Mac. Frames are in screen points
// from the top-left of the main display; OCR boxes are in image pixels.
import AppKit
import ApplicationServices
import Foundation
import Vision

struct Item: Encodable {
  let role: String
  let label: String
  let x: Int, y: Int, w: Int, h: Int
}

func emit<T: Encodable>(_ value: T) {
  let data = try! JSONEncoder().encode(value)
  FileHandle.standardOutput.write(data)
}

// ---------- Accessibility tree ----------

/// Roles worth showing the model, and what to call them.
let ROLES: [String: String] = [
  "AXButton": "button", "AXMenuButton": "button", "AXPopUpButton": "menu",
  "AXCheckBox": "checkbox", "AXRadioButton": "option", "AXTab": "tab",
  "AXTextField": "field", "AXTextArea": "text box", "AXSearchField": "search", "AXComboBox": "field",
  "AXLink": "link", "AXMenuItem": "menu item", "AXMenuBarItem": "menu",
  "AXStaticText": "text", "AXHeading": "heading", "AXImage": "image",
  "AXCell": "cell", "AXRow": "row", "AXSlider": "slider", "AXDisclosureTriangle": "toggle",
]
let MAX_ITEMS = 220
let MAX_VISITS = 4000
let DEADLINE = Date().addingTimeInterval(0.9)

func attr(_ el: AXUIElement, _ name: String) -> AnyObject? {
  var value: AnyObject?
  return AXUIElementCopyAttributeValue(el, name as CFString, &value) == .success ? value : nil
}

func text(_ el: AXUIElement, _ name: String) -> String? {
  guard let s = attr(el, name) as? String else { return nil }
  let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
  return t.isEmpty ? nil : String(t.prefix(160))
}

func frame(_ el: AXUIElement) -> CGRect? {
  guard let p = attr(el, kAXPositionAttribute), let s = attr(el, kAXSizeAttribute) else { return nil }
  var point = CGPoint.zero, size = CGSize.zero
  guard AXValueGetValue(p as! AXValue, .cgPoint, &point), AXValueGetValue(s as! AXValue, .cgSize, &size) else { return nil }
  return CGRect(origin: point, size: size)
}

/// The front app that isn't Persuna: the topmost normal window's owner.
func frontApp(skipping skip: pid_t) -> (pid_t, String)? {
  let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
  for w in list {
    guard (w[kCGWindowLayer as String] as? Int) == 0,
          let pid = w[kCGWindowOwnerPID as String] as? pid_t, pid != skip else { continue }
    return (pid, w[kCGWindowOwnerName as String] as? String ?? "")
  }
  return nil
}

struct Tree: Encodable {
  let trusted: Bool
  let app: String
  let window: String
  let items: [Item]
}

func readTree(skip: pid_t) -> Tree {
  guard AXIsProcessTrusted() else { return Tree(trusted: false, app: "", window: "", items: []) }
  guard let (pid, name) = frontApp(skipping: skip) else { return Tree(trusted: true, app: "", window: "", items: []) }
  let app = AXUIElementCreateApplication(pid)
  AXUIElementSetMessagingTimeout(app, 0.25)
  // Chromium and Electron apps only build their tree when asked.
  AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
  let window = (attr(app, kAXFocusedWindowAttribute) ?? (attr(app, kAXWindowsAttribute) as? [AnyObject])?.first)
  guard let win = window else { return Tree(trusted: true, app: name, window: "", items: []) }
  let root = win as! AXUIElement
  let bounds = NSScreen.screens.first.map { CGRect(origin: .zero, size: $0.frame.size) } ?? .infinite
  var items: [Item] = []
  var queue: [AXUIElement] = [root]
  var visits = 0
  var seen = Set<String>()
  while !queue.isEmpty && items.count < MAX_ITEMS && visits < MAX_VISITS && Date() < DEADLINE {
    let el = queue.removeFirst()
    visits += 1
    let role = text(el, kAXRoleAttribute) ?? ""
    if let kind = ROLES[role], let f = frame(el), f.width > 2, f.height > 2, f.intersects(bounds) {
      let label = text(el, kAXTitleAttribute) ?? text(el, kAXDescriptionAttribute)
        ?? (role == "AXStaticText" || role == "AXTextField" || role == "AXTextArea" || role == "AXHeading" ? text(el, kAXValueAttribute) : nil)
        ?? text(el, kAXPlaceholderValueAttribute) ?? text(el, kAXHelpAttribute)
      if let label = label {
        let key = "\(kind)|\(label)|\(Int(f.minX))|\(Int(f.minY))"
        if !seen.contains(key) {
          seen.insert(key)
          items.append(Item(role: kind, label: label, x: Int(f.minX), y: Int(f.minY), w: Int(f.width), h: Int(f.height)))
        }
      }
    }
    if let kids = attr(el, kAXChildrenAttribute) as? [AXUIElement] { queue.append(contentsOf: kids.prefix(120)) }
  }
  return Tree(trusted: true, app: name, window: text(root, kAXTitleAttribute) ?? "", items: items)
}

// ---------- Text recognition ----------

struct Line: Encodable { let text: String; let x: Int, y: Int, w: Int, h: Int }
struct Read: Encodable { let width: Int; let height: Int; let lines: [Line] }

func readText(path: String) -> Read {
  guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
        let image = CGImageSourceCreateImageAtIndex(src, 0, nil) else { return Read(width: 0, height: 0, lines: []) }
  let w = image.width, h = image.height
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = true
  try? VNImageRequestHandler(cgImage: image).perform([request])
  let lines = (request.results ?? []).compactMap { obs -> Line? in
    guard let best = obs.topCandidates(1).first, best.confidence > 0.3 else { return nil }
    let b = obs.boundingBox // normalised, origin bottom-left
    return Line(text: String(best.string.prefix(200)),
                x: Int(b.minX * Double(w)), y: Int((1 - b.maxY) * Double(h)),
                w: Int(b.width * Double(w)), h: Int(b.height * Double(h)))
  }
  return Read(width: w, height: h, lines: Array(lines.prefix(300)))
}

let args = CommandLine.arguments
switch args.count > 1 ? args[1] : "" {
case "ax": emit(readTree(skip: pid_t(args.count > 2 ? Int32(args[2]) ?? 0 : 0)))
case "ocr" where args.count > 2: emit(readText(path: args[2]))
case "trusted": emit(["trusted": AXIsProcessTrusted()])
default:
  FileHandle.standardError.write("usage: persuna-eyes ax <skip-pid> | ocr <image> | trusted\n".data(using: .utf8)!)
  exit(2)
}
