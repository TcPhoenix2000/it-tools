// All editor objects are stored in "viewport space": the page as the user sees it at zoom 1,
// in PDF points, origin top-left, y pointing down. They are converted to PDF user space
// (origin bottom-left, page rotation applied) only when written into the document.

export type StandardFontName = 'Helvetica' | 'TimesRoman' | 'Courier';

export type FormFieldType = 'text' | 'multiline' | 'checkbox' | 'radio' | 'dropdown' | 'listbox';

export type EditorTool =
  | 'select'
  | 'text'
  | 'edit-text'
  | 'whiteout'
  | 'highlight'
  | 'underline'
  | 'strikeout'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'ink'
  | 'image'
  | 'note'
  | 'redact'
  | 'field';

interface BaseObject {
  id: string
  x: number
  y: number
  w: number
  h: number
}

export interface TextObject extends BaseObject {
  type: 'text'
  text: string
  fontSize: number
  font: StandardFontName
  bold: boolean
  italic: boolean
  color: string
  // when set, the text is drawn on top of a filled box (used by "edit text" to cover the original)
  background: string | null
}

export interface ShapeObject extends BaseObject {
  type: 'rect' | 'ellipse' | 'whiteout'
  stroke: string | null
  fill: string | null
  strokeWidth: number
  opacity: number
}

export interface MarkupObject extends BaseObject {
  type: 'highlight' | 'underline' | 'strikeout'
  color: string
}

export interface LineObject extends BaseObject {
  type: 'line' | 'arrow'
  x1: number
  y1: number
  x2: number
  y2: number
  stroke: string
  strokeWidth: number
}

export interface InkObject extends BaseObject {
  type: 'ink'
  points: [number, number][]
  stroke: string
  strokeWidth: number
}

export interface ImageObject extends BaseObject {
  type: 'image'
  dataUrl: string
}

export interface NoteObject extends BaseObject {
  type: 'note'
  text: string
  color: string
  author: string
}

export interface RedactObject extends BaseObject {
  type: 'redact'
}

export interface FieldObject extends BaseObject {
  type: 'field'
  fieldType: FormFieldType
  name: string
  options: string[]
  defaultValue: string
  fontSize: number
  required: boolean
}

export type EditorObject =
  | TextObject
  | ShapeObject
  | MarkupObject
  | LineObject
  | InkObject
  | ImageObject
  | NoteObject
  | RedactObject
  | FieldObject;

export type ObjectsByPage = Record<number, EditorObject[]>;

export interface PageBox {
  // crop box in PDF user space
  x0: number
  y0: number
  x1: number
  y1: number
  // page /Rotate, normalised to 0 | 90 | 180 | 270
  rotation: number
}

export interface ToolSettings {
  color: string
  fill: string | null
  strokeWidth: number
  fontSize: number
  font: StandardFontName
  bold: boolean
  italic: boolean
  opacity: number
  highlightColor: string
  fieldType: FormFieldType
}
