<script setup lang="ts">
import type { EditorObject, FieldObject, InkObject, LineObject, TextObject } from '../pdf-editor.types';
import { newObjectId, usePdfEditor } from '../pdf-editor.store';
import { type TextRun, getTextRuns, pageViewportSize, renderPage } from '../services/pdf-render.service';
import { normalizeRect } from '../services/geometry';
import { TEXT_LINE_HEIGHT } from '../services/pdf-objects.service';

const state = usePdfEditor();
const { pdf, currentPage, zoom, version, tool, settings, fieldDraft, pageObjects, selectedObjectId, editingObjectId, pendingImage } = state;

const canvas = ref<HTMLCanvasElement>();
const layer = ref<HTMLDivElement>();
// the textarea lives inside a v-for, so Vue fills this ref with an array
const textarea = ref<HTMLTextAreaElement[]>([]);
function focusTextarea() {
  nextTick(() => textarea.value[0]?.focus());
}
const size = ref({ width: 595, height: 842 });
const rendering = ref(false);
let textRuns: TextRun[] | null = null;
let textRunsPage = -1;

const fontFamilies: Record<string, string> = {
  Helvetica: 'Helvetica, Arial, sans-serif',
  TimesRoman: '"Times New Roman", Times, serif',
  Courier: '"Courier New", Courier, monospace',
};

async function render() {
  const doc = pdf.value;
  if (!doc || !canvas.value || currentPage.value >= doc.numPages) {
    return;
  }
  rendering.value = true;
  try {
    size.value = await pageViewportSize(doc, currentPage.value);
    await renderPage(doc, currentPage.value, zoom.value, canvas.value);
  }
  finally {
    rendering.value = false;
  }
}

watch([pdf, currentPage, zoom, version], () => render(), { flush: 'post' });
onMounted(render);

// ---- pointer handling ----

interface Point { x: number; y: number }
type Drag =
  | { kind: 'create'; start: Point; current: Point; points: [number, number][] }
  | { kind: 'move'; id: string; start: Point; orig: EditorObject; moved: boolean }
  | { kind: 'resize'; id: string; handle: string; start: Point; orig: EditorObject; moved: boolean };

const drag = ref<Drag | null>(null);

function toPage(event: PointerEvent): Point {
  const rect = layer.value!.getBoundingClientRect();
  return {
    x: Math.min(Math.max((event.clientX - rect.left) / zoom.value, 0), size.value.width),
    y: Math.min(Math.max((event.clientY - rect.top) / zoom.value, 0), size.value.height),
  };
}

function findObject(id: string) {
  return pageObjects.value.find(o => o.id === id);
}

function measureText(obj: TextObject) {
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.font = `${obj.italic ? 'italic ' : ''}${obj.bold ? 'bold ' : ''}${obj.fontSize}px ${fontFamilies[obj.font]}`;
  const lines = obj.text.split('\n');
  const width = Math.max(...lines.map(l => ctx.measureText(l || ' ').width));
  return { w: Math.max(width + 6, obj.fontSize), h: lines.length * obj.fontSize * TEXT_LINE_HEIGHT + 2 };
}

async function runAt(p: Point): Promise<TextRun | null> {
  if (!pdf.value) {
    return null;
  }
  if (!textRuns || textRunsPage !== currentPage.value) {
    textRuns = await getTextRuns(pdf.value, currentPage.value);
    textRunsPage = currentPage.value;
  }
  return textRuns.find(r => p.x >= r.x - 1 && p.x <= r.x + r.w + 1 && p.y >= r.y - 1 && p.y <= r.y + r.h + 1) ?? null;
}

function guessFont(family: string): TextObject['font'] {
  if (/mono|courier/i.test(family)) {
    return 'Courier';
  }
  if (/serif|times|georgia|garamond/i.test(family) && !/sans/i.test(family)) {
    return 'TimesRoman';
  }
  return 'Helvetica';
}

function createText(p: Point, init: Partial<TextObject> = {}) {
  const obj: TextObject = {
    id: newObjectId(),
    type: 'text',
    x: p.x,
    y: p.y,
    w: 20,
    h: settings.fontSize * TEXT_LINE_HEIGHT,
    text: '',
    fontSize: settings.fontSize,
    font: settings.font,
    bold: settings.bold,
    italic: settings.italic,
    color: settings.color,
    background: null,
    ...init,
  };
  Object.assign(obj, measureText(obj), init.w ? { w: Math.max(init.w, measureText(obj).w) } : {});
  state.addObject(currentPage.value, obj);
  editingObjectId.value = obj.id;
  tool.value = 'select';
  focusTextarea();
}

async function onPointerDown(event: PointerEvent) {
  if (event.button !== 0 || !layer.value) {
    return;
  }
  const target = event.target as HTMLElement;
  if (target.tagName === 'TEXTAREA') {
    return;
  }
  // keep the browser from moving focus (it would blur a text box we are about to create) or selecting text
  event.preventDefault();
  if (editingObjectId.value) {
    finishEditing();
  }
  const p = toPage(event);
  const id = target.closest<HTMLElement>('[data-id]')?.dataset.id;
  const handle = target.dataset.handle;

  if (tool.value === 'select') {
    if (id && findObject(id)) {
      selectedObjectId.value = id;
      layer.value.setPointerCapture(event.pointerId);
      drag.value = handle
        ? { kind: 'resize', id, handle, start: p, orig: { ...findObject(id)! }, moved: false }
        : { kind: 'move', id, start: p, orig: { ...findObject(id)! }, moved: false };
    }
    else {
      selectedObjectId.value = null;
    }
    return;
  }

  switch (tool.value) {
    case 'text':
      createText(p);
      return;
    case 'edit-text': {
      const run = await runAt(p);
      if (run) {
        createText({ x: run.x - 1, y: run.y - 1 }, {
          text: run.text,
          fontSize: Math.round(run.fontSize * 10) / 10,
          font: guessFont(run.fontFamily),
          background: '#ffffff',
          w: run.w + 4,
        });
      }
      else {
        state.notice.value = 'No text found there. Click directly on a line of text to edit it.';
      }
      return;
    }
    case 'note':
      state.addObject(currentPage.value, { id: newObjectId(), type: 'note', x: p.x - 10, y: p.y - 10, w: 20, h: 20, text: '', color: '#ffd400', author: '' });
      tool.value = 'select';
      return;
    case 'image': {
      if (!pendingImage.value) {
        state.notice.value = 'Choose an image or signature first.';
        return;
      }
      const { dataUrl, width, height } = pendingImage.value;
      state.addObject(currentPage.value, { id: newObjectId(), type: 'image', x: p.x - width / 2, y: p.y - height / 2, w: width, h: height, dataUrl });
      pendingImage.value = null;
      tool.value = 'select';
      return;
    }
  }

  layer.value.setPointerCapture(event.pointerId);
  drag.value = { kind: 'create', start: p, current: p, points: [[p.x, p.y]] };
}

function onPointerMove(event: PointerEvent) {
  const d = drag.value;
  if (!d) {
    return;
  }
  const p = toPage(event);
  if (d.kind === 'create') {
    d.current = p;
    if (tool.value === 'ink') {
      d.points.push([p.x, p.y]);
    }
    return;
  }
  const dx = p.x - d.start.x;
  const dy = p.y - d.start.y;
  if (!d.moved) {
    if (Math.abs(dx) + Math.abs(dy) < 1) {
      return;
    }
    state.snapshot();
    d.moved = true;
  }
  const o = d.orig as any;
  if (d.kind === 'move') {
    const patch: any = { x: o.x + dx, y: o.y + dy };
    if (o.type === 'line' || o.type === 'arrow') {
      Object.assign(patch, { x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy });
    }
    if (o.type === 'ink') {
      patch.points = o.points.map(([x, y]: [number, number]) => [x + dx, y + dy]);
    }
    state.updateObject(currentPage.value, d.id, patch);
    return;
  }
  // resize
  if (d.handle === 'p1' || d.handle === 'p2') {
    const n = d.handle === 'p1' ? 1 : 2;
    const line = { ...o, [`x${n}`]: p.x, [`y${n}`]: p.y };
    state.updateObject(currentPage.value, d.id, { ...line, ...normalizeRect(line.x1, line.y1, line.x2, line.y2) });
    return;
  }
  let { x, y, w, h } = o;
  if (d.handle.includes('e')) {
    w = Math.max(4, o.w + dx);
  }
  if (d.handle.includes('s')) {
    h = Math.max(4, o.h + dy);
  }
  if (d.handle.includes('w')) {
    w = Math.max(4, o.w - dx);
    x = o.x + o.w - w;
  }
  if (d.handle.includes('n')) {
    h = Math.max(4, o.h - dy);
    y = o.y + o.h - h;
  }
  // images and signatures keep their aspect ratio
  if (o.type === 'image') {
    const ratio = o.w / o.h;
    h = w / ratio;
    if (d.handle.includes('n')) {
      y = o.y + o.h - h;
    }
  }
  const patch: any = { x, y, w, h };
  if (o.type === 'text') {
    // resizing a text box scales its font
    patch.fontSize = Math.max(4, Math.round(o.fontSize * (h / o.h) * 10) / 10);
    patch.w = measureText({ ...o, fontSize: patch.fontSize }).w;
  }
  state.updateObject(currentPage.value, d.id, patch);
}

function onPointerUp(event: PointerEvent) {
  const d = drag.value;
  drag.value = null;
  if (layer.value?.hasPointerCapture(event.pointerId)) {
    layer.value.releasePointerCapture(event.pointerId);
  }
  if (!d || d.kind !== 'create') {
    return;
  }
  const { start, current } = d;
  const rect = normalizeRect(start.x, start.y, current.x, current.y);
  const base = { id: newObjectId(), ...rect };
  const t = tool.value;
  let obj: EditorObject | null = null;

  if (t === 'line' || t === 'arrow') {
    if (Math.hypot(current.x - start.x, current.y - start.y) < 4) {
      return;
    }
    obj = { ...base, type: t, x1: start.x, y1: start.y, x2: current.x, y2: current.y, stroke: settings.color, strokeWidth: settings.strokeWidth } as LineObject;
  }
  else if (t === 'ink') {
    if (d.points.length < 2) {
      return;
    }
    const xs = d.points.map(pt => pt[0]);
    const ys = d.points.map(pt => pt[1]);
    obj = { ...base, ...normalizeRect(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)), type: 'ink', points: d.points, stroke: settings.color, strokeWidth: settings.strokeWidth } as InkObject;
  }
  else {
    if (rect.w < 4 || rect.h < 4) {
      return;
    }
    switch (t) {
      case 'rect':
      case 'ellipse':
        obj = { ...base, type: t, stroke: settings.color, fill: settings.fill, strokeWidth: settings.strokeWidth, opacity: settings.opacity };
        break;
      case 'whiteout':
        obj = { ...base, type: 'whiteout', stroke: null, fill: '#ffffff', strokeWidth: 0, opacity: 1 };
        break;
      case 'highlight':
      case 'underline':
      case 'strikeout':
        obj = { ...base, type: t, color: t === 'highlight' ? settings.highlightColor : settings.color };
        break;
      case 'redact':
        obj = { ...base, type: 'redact' };
        break;
      case 'field': {
        const field: FieldObject = {
          ...base,
          type: 'field',
          fieldType: settings.fieldType,
          name: fieldDraft.name || settings.fieldType,
          options: fieldDraft.options.split(',').map(s => s.trim()).filter(Boolean),
          defaultValue: fieldDraft.defaultValue,
          fontSize: settings.fontSize,
          required: fieldDraft.required,
        };
        if (field.fieldType === 'checkbox' || field.fieldType === 'radio') {
          const side = Math.max(10, Math.min(rect.w, rect.h));
          Object.assign(field, { w: side, h: side });
        }
        obj = field;
        break;
      }
    }
  }
  if (obj) {
    state.addObject(currentPage.value, obj);
  }
}

// ---- inline text editing ----

const editingObject = computed(() => pageObjects.value.find(o => o.id === editingObjectId.value && o.type === 'text') as TextObject | undefined);

function onTextInput(event: Event) {
  const obj = editingObject.value;
  if (!obj) {
    return;
  }
  const text = (event.target as HTMLTextAreaElement).value;
  const measured = measureText({ ...obj, text });
  state.updateObject(currentPage.value, obj.id, { text, h: measured.h, w: Math.max(measured.w, obj.background ? obj.w : 0) });
}

function finishEditing() {
  const obj = editingObject.value;
  editingObjectId.value = null;
  if (obj && !obj.text.trim() && !obj.background) {
    state.removeObject(currentPage.value, obj.id);
  }
}

function startEditing(obj: EditorObject) {
  if (obj.type === 'text') {
    selectedObjectId.value = obj.id;
    editingObjectId.value = obj.id;
    focusTextarea();
  }
}

// ---- keyboard shortcuts ----

function onKeyDown(event: KeyboardEvent) {
  const target = event.target as HTMLElement;
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
  if (event.key === 'Escape') {
    if (editingObjectId.value) {
      finishEditing();
    }
    else {
      selectedObjectId.value = null;
      tool.value = 'select';
    }
    return;
  }
  if (typing) {
    return;
  }
  const mod = event.ctrlKey || event.metaKey;
  if (mod && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    event.shiftKey ? state.redo() : state.undo();
  }
  else if (mod && event.key.toLowerCase() === 'y') {
    event.preventDefault();
    state.redo();
  }
  else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedObjectId.value) {
    event.preventDefault();
    state.removeObject(currentPage.value, selectedObjectId.value);
  }
  else if (selectedObjectId.value && event.key.startsWith('Arrow')) {
    event.preventDefault();
    const obj = findObject(selectedObjectId.value) as any;
    const step = event.shiftKey ? 10 : 1;
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    const patch: any = { x: obj.x + dx, y: obj.y + dy };
    if (obj.type === 'line' || obj.type === 'arrow') {
      Object.assign(patch, { x1: obj.x1 + dx, y1: obj.y1 + dy, x2: obj.x2 + dx, y2: obj.y2 + dy });
    }
    if (obj.type === 'ink') {
      patch.points = obj.points.map(([x, y]: [number, number]) => [x + dx, y + dy]);
    }
    state.updateObject(currentPage.value, obj.id, patch);
  }
}

onMounted(() => window.addEventListener('keydown', onKeyDown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown));

// ---- presentation helpers ----

const preview = computed(() => {
  const d = drag.value;
  return d?.kind === 'create' ? { ...normalizeRect(d.start.x, d.start.y, d.current.x, d.current.y), start: d.start, current: d.current, points: d.points } : null;
});

const boxObjects = computed(() => pageObjects.value.filter(o => !['line', 'arrow', 'ink'].includes(o.type)));
const pathObjects = computed(() => pageObjects.value.filter(o => ['line', 'arrow', 'ink'].includes(o.type)) as (LineObject | InkObject)[]);

function boxStyle(o: EditorObject) {
  return { left: `${o.x}px`, top: `${o.y}px`, width: `${o.w}px`, height: `${o.h}px` };
}

function textStyle(o: TextObject) {
  return {
    fontFamily: fontFamilies[o.font],
    fontSize: `${o.fontSize}px`,
    lineHeight: TEXT_LINE_HEIGHT,
    fontWeight: o.bold ? 'bold' : 'normal',
    fontStyle: o.italic ? 'italic' : 'normal',
    color: o.color,
    background: o.background ?? 'transparent',
  };
}

function arrowHead(o: LineObject) {
  const angle = Math.atan2(o.y2 - o.y1, o.x2 - o.x1);
  const s = 6 + o.strokeWidth * 2;
  const pts = [-1, 1].map((side) => {
    const a = angle + Math.PI + (side * Math.PI) / 7;
    return `${o.x2 + Math.cos(a) * s},${o.y2 + Math.sin(a) * s}`;
  });
  return `M${pts[0]} L${o.x2},${o.y2} L${pts[1]}`;
}

const cursor = computed(() => {
  switch (tool.value) {
    case 'select':
      return 'default';
    case 'text':
    case 'edit-text':
      return 'text';
    case 'image':
    case 'note':
      return 'copy';
    default:
      return 'crosshair';
  }
});

const selected = computed(() => pageObjects.value.find(o => o.id === selectedObjectId.value) ?? null);
const handles = ['nw', 'ne', 'sw', 'se'];
</script>

<template>
  <div class="page-shell">
    <div class="page" :style="{ width: `${size.width * zoom}px`, height: `${size.height * zoom}px` }">
      <canvas ref="canvas" class="page-canvas" />
      <div
        ref="layer"
        class="layer"
        :style="{ width: `${size.width}px`, height: `${size.height}px`, transform: `scale(${zoom})`, cursor }"
        data-test-id="pdf-layer"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      >
        <!-- box objects -->
        <div
          v-for="o in boxObjects"
          :key="o.id"
          :data-id="o.id"
          class="obj"
          :class="[`obj-${o.type}`, { selected: o.id === selectedObjectId }]"
          :style="boxStyle(o)"
          @dblclick.stop="startEditing(o)"
        >
          <template v-if="o.type === 'text'">
            <textarea
              v-if="o.id === editingObjectId"
              ref="textarea"
              class="text-edit"
              :style="textStyle(o)"
              :value="o.text"
              spellcheck="false"
              @input="onTextInput"
              @blur="finishEditing"
            />
            <div v-else class="text-view" :style="textStyle(o)">
              {{ o.text || ' ' }}
            </div>
          </template>
          <div
            v-else-if="o.type === 'rect' || o.type === 'ellipse'"
            class="fill"
            :style="{
              border: o.stroke ? `${o.strokeWidth}px solid ${o.stroke}` : 'none',
              background: o.fill ?? 'transparent',
              opacity: o.opacity,
              borderRadius: o.type === 'ellipse' ? '50%' : '0',
            }"
          />
          <div v-else-if="o.type === 'whiteout'" class="fill" style="background: #fff" />
          <div v-else-if="o.type === 'highlight'" class="fill" :style="{ background: o.color, opacity: 0.4, mixBlendMode: 'multiply' }" />
          <div v-else-if="o.type === 'underline'" class="fill" :style="{ borderBottom: `${Math.max(1, o.h / 12)}px solid ${o.color}` }" />
          <div v-else-if="o.type === 'strikeout'" class="fill strike" :style="{ '--strike-color': o.color, '--strike-width': `${Math.max(1, o.h / 12)}px` }" />
          <img v-else-if="o.type === 'image'" class="fill" :src="o.dataUrl" draggable="false" alt="">
          <div v-else-if="o.type === 'note'" class="note" :style="{ background: o.color }" :title="o.text">
            <icon-mdi-comment-text-outline />
          </div>
          <div v-else-if="o.type === 'redact'" class="fill redact">
            REDACT
          </div>
          <div v-else-if="o.type === 'field'" class="fill field">
            <span>{{ o.fieldType }}: {{ o.name }}</span>
          </div>

          <template v-if="o.id === selectedObjectId && o.id !== editingObjectId && o.type !== 'note'">
            <div v-for="h in handles" :key="h" class="handle" :class="h" :data-handle="h" :data-id="o.id" />
          </template>
        </div>

        <!-- vector objects -->
        <svg class="vectors" :width="size.width" :height="size.height" :viewBox="`0 0 ${size.width} ${size.height}`">
          <g v-for="o in pathObjects" :key="o.id" :data-id="o.id" class="vector" :class="{ selected: o.id === selectedObjectId }">
            <template v-if="o.type === 'ink'">
              <polyline :points="o.points.map(p => p.join(',')).join(' ')" fill="none" :stroke="o.stroke" :stroke-width="o.strokeWidth" stroke-linecap="round" stroke-linejoin="round" />
              <polyline :points="o.points.map(p => p.join(',')).join(' ')" fill="none" stroke="transparent" stroke-width="10" />
            </template>
            <template v-else>
              <line :x1="o.x1" :y1="o.y1" :x2="o.x2" :y2="o.y2" :stroke="o.stroke" :stroke-width="o.strokeWidth" stroke-linecap="round" />
              <path v-if="o.type === 'arrow'" :d="arrowHead(o)" fill="none" :stroke="o.stroke" :stroke-width="o.strokeWidth" stroke-linecap="round" />
              <line :x1="o.x1" :y1="o.y1" :x2="o.x2" :y2="o.y2" stroke="transparent" stroke-width="10" />
            </template>
          </g>
          <!-- endpoints of a selected line -->
          <template v-if="selected && (selected.type === 'line' || selected.type === 'arrow')">
            <circle :cx="selected.x1" :cy="selected.y1" r="4" class="endpoint" data-handle="p1" :data-id="selected.id" />
            <circle :cx="selected.x2" :cy="selected.y2" r="4" class="endpoint" data-handle="p2" :data-id="selected.id" />
          </template>
          <rect v-if="selected && selected.type === 'ink'" :x="selected.x - 3" :y="selected.y - 3" :width="selected.w + 6" :height="selected.h + 6" class="ink-selection" />

          <!-- drawing preview -->
          <template v-if="preview">
            <polyline v-if="tool === 'ink'" :points="preview.points.map(p => p.join(',')).join(' ')" fill="none" :stroke="settings.color" :stroke-width="settings.strokeWidth" stroke-linecap="round" />
            <line v-else-if="tool === 'line' || tool === 'arrow'" :x1="preview.start.x" :y1="preview.start.y" :x2="preview.current.x" :y2="preview.current.y" :stroke="settings.color" :stroke-width="settings.strokeWidth" />
            <ellipse v-else-if="tool === 'ellipse'" :cx="preview.x + preview.w / 2" :cy="preview.y + preview.h / 2" :rx="preview.w / 2" :ry="preview.h / 2" class="preview" />
            <rect v-else :x="preview.x" :y="preview.y" :width="preview.w" :height="preview.h" class="preview" />
          </template>
        </svg>
      </div>
      <div v-if="rendering" class="rendering">
        <n-spin size="small" />
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
// The shell grows with the page so a page wider than the viewer scrolls instead of being
// cut off on the left (which flex centering would do); margin: auto still centres smaller pages.
.page-shell {
  display: flex;
  box-sizing: border-box;
  width: max-content;
  min-width: 100%;
  padding: 16px;
}

.page {
  position: relative;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.25);
  background: #fff;
  flex: none;
  margin: 0 auto;
}

.page-canvas {
  position: absolute;
  inset: 0;
  display: block;
}

.layer {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
  touch-action: none;
  user-select: none;
}

.obj {
  position: absolute;
  box-sizing: border-box;

  &.selected {
    outline: 1px dashed #1e88e5;
    outline-offset: 1px;
  }
}

.fill {
  position: absolute;
  inset: 0;
  box-sizing: border-box;
  pointer-events: none;
}

.strike::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  border-top: var(--strike-width) solid var(--strike-color);
}

.text-view,
.text-edit {
  position: absolute;
  inset: 0;
  margin: 0;
  padding: 0 0 0 2px;
  white-space: pre;
  overflow: visible;
  box-sizing: border-box;
}

.text-view {
  pointer-events: none;
}

.text-edit {
  border: none;
  outline: 1px solid #1e88e5;
  resize: none;
  overflow: hidden;
  min-width: 100%;
}

.note {
  width: 20px;
  height: 20px;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #333;
  font-size: 14px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
  pointer-events: none;
}

.redact {
  background: rgba(0, 0, 0, 0.7);
  border: 1px solid #e53935;
  color: #ff8a80;
  font-size: 9px;
  font-family: sans-serif;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.field {
  border: 1px dashed #1e88e5;
  background: rgba(30, 136, 229, 0.1);
  color: #1565c0;
  font-size: 8px;
  font-family: sans-serif;
  overflow: hidden;
  white-space: nowrap;
  padding: 1px 2px;
}

.handle {
  position: absolute;
  width: 8px;
  height: 8px;
  background: #fff;
  border: 1px solid #1e88e5;
  z-index: 2;

  &.nw { left: -5px; top: -5px; cursor: nwse-resize; }
  &.ne { right: -5px; top: -5px; cursor: nesw-resize; }
  &.sw { left: -5px; bottom: -5px; cursor: nesw-resize; }
  &.se { right: -5px; bottom: -5px; cursor: nwse-resize; }
}

.vectors {
  position: absolute;
  inset: 0;
  overflow: visible;
  pointer-events: none;

  .vector {
    pointer-events: stroke;
    cursor: move;
  }

  .endpoint {
    fill: #fff;
    stroke: #1e88e5;
    pointer-events: all;
    cursor: crosshair;
  }

  .ink-selection {
    fill: none;
    stroke: #1e88e5;
    stroke-dasharray: 3 2;
  }

  .preview {
    fill: rgba(30, 136, 229, 0.12);
    stroke: #1e88e5;
    stroke-dasharray: 4 3;
  }
}

.rendering {
  position: absolute;
  right: 8px;
  top: 8px;
}
</style>
