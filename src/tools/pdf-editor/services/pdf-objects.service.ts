import {
  BlendMode,
  PDFHexString,
  PDFString,
  StandardFonts,
  degrees,
  rgb,
} from '@cantoo/pdf-lib';
import type { PDFDocument, PDFFont, PDFPage } from '@cantoo/pdf-lib';
import type { EditorObject, FieldObject, ObjectsByPage, PageBox, TextObject } from '../pdf-editor.types';
import { hexToRgb01, pdfRect, uprightBox, viewportToPdf } from './geometry';
import { getPageBoxes, loadPdfLib, savePdf } from './pdf-document.service';

function color(hex: string) {
  const { r, g, b } = hexToRgb01(hex);
  return rgb(r, g, b);
}

// Height of a text line relative to the font size; must match the editor overlay (line-height)
export const TEXT_LINE_HEIGHT = 1.2;
// Distance from the top of a line box to the baseline, relative to the font size
const BASELINE_OFFSET = 0.95;

function fontFor(obj: TextObject): StandardFonts {
  const table: Record<string, StandardFonts[]> = {
    // regular, bold, italic, bold-italic
    Helvetica: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
    TimesRoman: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
    Courier: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
  };
  return table[obj.font][(obj.bold ? 1 : 0) + (obj.italic ? 2 : 0)];
}

// Standard fonts only cover WinAnsi; replace characters they cannot encode instead of failing
export function sanitizeForFont(text: string, font: PDFFont): string {
  const supported = new Set(font.getCharacterSet());
  return [...text].map(ch => (ch === '\n' || supported.has(ch.codePointAt(0)!) ? ch : '?')).join('');
}

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } {
  const [header, data] = dataUrl.split(',');
  const mime = header.match(/data:([^;]+)/)?.[1] ?? 'image/png';
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return { bytes, mime };
}

function uniqueFieldName(doc: PDFDocument, wanted: string): string {
  const existing = new Set(doc.getForm().getFields().map(f => f.getName()));
  const base = (wanted || 'field').replace(/[.]/g, '_');
  if (!existing.has(base)) {
    return base;
  }
  let i = 2;
  while (existing.has(`${base}_${i}`)) {
    i++;
  }
  return `${base}_${i}`;
}

async function drawObject(doc: PDFDocument, page: PDFPage, box: PageBox, obj: EditorObject, fonts: Map<string, PDFFont>) {
  const rotate = degrees(box.rotation);

  switch (obj.type) {
    case 'text': {
      if (obj.background) {
        const b = uprightBox(box, obj);
        page.drawRectangle({ x: b.x, y: b.y, width: b.width, height: b.height, color: color(obj.background), rotate });
      }
      const fontName = fontFor(obj);
      if (!fonts.has(fontName)) {
        fonts.set(fontName, await doc.embedFont(fontName));
      }
      const font = fonts.get(fontName)!;
      const lines = sanitizeForFont(obj.text, font).split('\n');
      lines.forEach((line, i) => {
        const baselineY = obj.y + obj.fontSize * (BASELINE_OFFSET + TEXT_LINE_HEIGHT * i);
        const p = viewportToPdf(box, obj.x + 2, baselineY);
        page.drawText(line, { x: p.x, y: p.y, size: obj.fontSize, font, color: color(obj.color), rotate });
      });
      break;
    }
    case 'whiteout':
    case 'rect': {
      const b = uprightBox(box, obj);
      page.drawRectangle({
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        rotate,
        color: obj.fill ? color(obj.fill) : undefined,
        borderColor: obj.stroke ? color(obj.stroke) : undefined,
        borderWidth: obj.stroke ? obj.strokeWidth : 0,
        opacity: obj.opacity,
        borderOpacity: obj.opacity,
      });
      break;
    }
    case 'ellipse': {
      const c = viewportToPdf(box, obj.x + obj.w / 2, obj.y + obj.h / 2);
      page.drawEllipse({
        x: c.x,
        y: c.y,
        xScale: obj.w / 2,
        yScale: obj.h / 2,
        rotate,
        color: obj.fill ? color(obj.fill) : undefined,
        borderColor: obj.stroke ? color(obj.stroke) : undefined,
        borderWidth: obj.stroke ? obj.strokeWidth : 0,
        opacity: obj.opacity,
        borderOpacity: obj.opacity,
      });
      break;
    }
    case 'highlight': {
      const b = uprightBox(box, obj);
      page.drawRectangle({ x: b.x, y: b.y, width: b.width, height: b.height, rotate, color: color(obj.color), opacity: 0.4, blendMode: BlendMode.Multiply });
      break;
    }
    case 'underline':
    case 'strikeout': {
      const vy = obj.type === 'underline' ? obj.y + obj.h : obj.y + obj.h / 2;
      const start = viewportToPdf(box, obj.x, vy);
      const end = viewportToPdf(box, obj.x + obj.w, vy);
      page.drawLine({ start, end, thickness: Math.max(1, obj.h / 12), color: color(obj.color) });
      break;
    }
    case 'line':
    case 'arrow': {
      const start = viewportToPdf(box, obj.x1, obj.y1);
      const end = viewportToPdf(box, obj.x2, obj.y2);
      page.drawLine({ start, end, thickness: obj.strokeWidth, color: color(obj.stroke) });
      if (obj.type === 'arrow') {
        const angle = Math.atan2(obj.y2 - obj.y1, obj.x2 - obj.x1);
        const size = 6 + obj.strokeWidth * 2;
        for (const side of [-1, 1]) {
          const a = angle + Math.PI + (side * Math.PI) / 7;
          const tip = viewportToPdf(box, obj.x2 + Math.cos(a) * size, obj.y2 + Math.sin(a) * size);
          page.drawLine({ start: end, end: tip, thickness: obj.strokeWidth, color: color(obj.stroke) });
        }
      }
      break;
    }
    case 'ink': {
      for (let i = 1; i < obj.points.length; i++) {
        const start = viewportToPdf(box, obj.points[i - 1][0], obj.points[i - 1][1]);
        const end = viewportToPdf(box, obj.points[i][0], obj.points[i][1]);
        page.drawLine({ start, end, thickness: obj.strokeWidth, color: color(obj.stroke), lineCap: 1 as any });
      }
      break;
    }
    case 'image': {
      const { bytes, mime } = dataUrlToBytes(obj.dataUrl);
      const image = mime === 'image/jpeg' ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
      const b = uprightBox(box, obj);
      page.drawImage(image, { x: b.x, y: b.y, width: b.width, height: b.height, rotate });
      break;
    }
    case 'note': {
      // A real /Text annotation (sticky note), editable in Acrobat and other viewers
      const [x0, y0] = pdfRect(box, obj);
      const { r, g, b } = hexToRgb01(obj.color);
      const annotation = doc.context.obj({
        Type: 'Annot',
        Subtype: 'Text',
        Rect: [x0, y0, x0 + 20, y0 + 20],
        Contents: PDFHexString.fromText(obj.text),
        T: PDFHexString.fromText(obj.author || 'IT-Tools'),
        Name: 'Comment',
        C: [r, g, b],
        F: 4,
        Open: false,
        M: PDFString.fromDate(new Date()),
      });
      page.node.addAnnot(doc.context.register(annotation));
      break;
    }
    case 'field':
      addFormField(doc, page, box, obj);
      break;
    case 'redact':
      // applied separately, see pdf-redact.service
      break;
  }
}

function addFormField(doc: PDFDocument, page: PDFPage, box: PageBox, obj: FieldObject) {
  const form = doc.getForm();
  const b = uprightBox(box, obj);
  const placement = {
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    rotate: degrees(box.rotation),
    borderColor: rgb(0.4, 0.4, 0.4),
    borderWidth: 1,
    backgroundColor: rgb(1, 1, 1),
    textColor: rgb(0, 0, 0),
  };

  switch (obj.fieldType) {
    case 'text':
    case 'multiline': {
      const field = form.createTextField(uniqueFieldName(doc, obj.name));
      if (obj.fieldType === 'multiline') {
        field.enableMultiline();
      }
      if (obj.defaultValue) {
        field.setText(obj.defaultValue);
      }
      if (obj.required) {
        field.enableRequired();
      }
      field.addToPage(page, placement);
      field.setFontSize(obj.fontSize);
      break;
    }
    case 'checkbox': {
      const field = form.createCheckBox(uniqueFieldName(doc, obj.name));
      field.addToPage(page, placement);
      if (obj.defaultValue === 'true') {
        field.check();
      }
      if (obj.required) {
        field.enableRequired();
      }
      break;
    }
    case 'radio': {
      // radio buttons with the same name form one group; the option is the button's value
      const name = (obj.name || 'group').replace(/[.]/g, '_');
      const group = form.getFieldMaybe(name) ?? form.createRadioGroup(name);
      const option = obj.options[0] || `option${Date.now() % 1000}`;
      (group as any).addOptionToPage(option, page, placement);
      if (obj.defaultValue === 'true') {
        (group as any).select(option);
      }
      break;
    }
    case 'dropdown':
    case 'listbox': {
      const name = uniqueFieldName(doc, obj.name);
      const field = obj.fieldType === 'dropdown' ? form.createDropdown(name) : form.createOptionList(name);
      field.setOptions(obj.options.length ? obj.options : ['Option 1']);
      if (obj.defaultValue && obj.options.includes(obj.defaultValue)) {
        field.select(obj.defaultValue);
      }
      field.addToPage(page, placement);
      field.setFontSize(obj.fontSize);
      if (obj.required) {
        field.enableRequired();
      }
      break;
    }
  }
}

// Write all editor objects (except redactions) into the document
export async function applyObjects(bytes: Uint8Array, objects: ObjectsByPage): Promise<Uint8Array> {
  const pagesWithObjects = Object.entries(objects).filter(([, list]) => list.some(o => o.type !== 'redact'));
  if (pagesWithObjects.length === 0) {
    return bytes;
  }
  const doc = await loadPdfLib(bytes);
  const pages = doc.getPages();
  const boxes = getPageBoxes(doc);
  const fonts = new Map<string, PDFFont>();
  // draw shapes/whiteouts first so text and images end up on top, matching the editor stacking
  const order = ['whiteout', 'highlight', 'rect', 'ellipse', 'underline', 'strikeout', 'line', 'arrow', 'ink', 'image', 'text', 'note', 'field'];
  for (const [index, list] of pagesWithObjects) {
    const pageIndex = Number(index);
    const sorted = [...list].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
    for (const obj of sorted) {
      await drawObject(doc, pages[pageIndex], boxes[pageIndex], obj, fonts);
    }
  }
  return savePdf(doc);
}

export function hasNonRedactObjects(objects: ObjectsByPage) {
  return Object.values(objects).some(list => list.some(o => o.type !== 'redact'));
}

export function redactionsOf(objects: ObjectsByPage): Record<number, EditorObject[]> {
  const result: Record<number, EditorObject[]> = {};
  for (const [index, list] of Object.entries(objects)) {
    const redactions = list.filter(o => o.type === 'redact');
    if (redactions.length) {
      result[Number(index)] = redactions;
    }
  }
  return result;
}
