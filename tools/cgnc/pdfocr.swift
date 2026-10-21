import Foundation
import PDFKit
import Vision
import AppKit
// pdfocr <pdf> <first page> <last page>: each page rendered at 2400 px wide, read by Vision (French), printed.
let a = CommandLine.arguments
guard a.count >= 4, let doc = PDFDocument(url: URL(fileURLWithPath: a[1])), let first = Int(a[2]), let last = Int(a[3]) else { print("usage"); exit(1) }
for i in (first - 1)..<min(last, doc.pageCount) {
  guard let page = doc.page(at: i) else { continue }
  let box = page.bounds(for: .mediaBox)
  let scale = 2400.0 / box.width
  let img = page.thumbnail(of: NSSize(width: box.width * scale, height: box.height * scale), for: .mediaBox)
  guard let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { continue }
  let req = VNRecognizeTextRequest()
  req.recognitionLevel = .accurate
  req.recognitionLanguages = ["fr-FR"]
  req.usesLanguageCorrection = false
  try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
  // lines top to bottom, each line's pieces left to right
  let obs = (req.results ?? []).compactMap { o -> (CGRect, String)? in
    guard let s = o.topCandidates(1).first?.string else { return nil }; return (o.boundingBox, s) }
  let rows = obs.sorted { abs($0.0.midY - $1.0.midY) > 0.006 ? $0.0.midY > $1.0.midY : $0.0.minX < $1.0.minX }
  print("=== PAGE \(i + 1)")
  var lastY: CGFloat = -1; var line = ""
  for (r, s) in rows {
    if lastY >= 0 && abs(r.midY - lastY) > 0.006 { print(line); line = "" }
    line += (line.isEmpty ? "" : " | ") + s; lastY = r.midY
  }
  if !line.isEmpty { print(line) }
}
