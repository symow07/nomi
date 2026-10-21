import Foundation
import PDFKit
import AppKit
// pdfpng <pdf> <page> <out.png> [width]
let a = CommandLine.arguments
guard a.count >= 4, let doc = PDFDocument(url: URL(fileURLWithPath: a[1])), let p = Int(a[2]), let page = doc.page(at: p - 1) else { exit(1) }
let w = a.count > 4 ? Double(a[4])! : 1100
let box = page.bounds(for: .mediaBox); let s = w / box.width
let img = page.thumbnail(of: NSSize(width: box.width * s, height: box.height * s), for: .mediaBox)
guard let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) else { exit(1) }
try! png.write(to: URL(fileURLWithPath: a[3]))
