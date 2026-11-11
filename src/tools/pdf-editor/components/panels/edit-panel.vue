<script setup lang="ts">
import type { Component } from 'vue';
import type { EditorTool } from '../../pdf-editor.types';
import { usePdfEditor } from '../../pdf-editor.store';
import { type StampPosition, addHeaderFooter, addWatermark } from '../../services/pdf-document.service';
import { parsePageRanges } from '../../services/geometry';
import IconSelect from '~icons/mdi/cursor-default-outline';
import IconText from '~icons/mdi/format-text';
import IconEditText from '~icons/mdi/form-textbox';
import IconWhiteout from '~icons/mdi/eraser';
import IconHighlight from '~icons/mdi/marker';
import IconUnderline from '~icons/mdi/format-underline';
import IconStrike from '~icons/mdi/format-strikethrough-variant';
import IconRect from '~icons/mdi/rectangle-outline';
import IconEllipse from '~icons/mdi/ellipse-outline';
import IconLine from '~icons/mdi/vector-line';
import IconArrow from '~icons/mdi/arrow-top-right';
import IconInk from '~icons/mdi/draw';
import IconImage from '~icons/mdi/image-plus-outline';
import IconNote from '~icons/mdi/comment-plus-outline';

const state = usePdfEditor();
const { tool, settings, selectedObject, currentPage, pageCount, pendingImage } = state;

const tools: { name: EditorTool; label: string; icon: Component }[] = [
  { name: 'select', label: 'Select / move', icon: IconSelect },
  { name: 'text', label: 'Add text', icon: IconText },
  { name: 'edit-text', label: 'Edit existing text', icon: IconEditText },
  { name: 'whiteout', label: 'Whiteout', icon: IconWhiteout },
  { name: 'highlight', label: 'Highlight', icon: IconHighlight },
  { name: 'underline', label: 'Underline', icon: IconUnderline },
  { name: 'strikeout', label: 'Strikethrough', icon: IconStrike },
  { name: 'rect', label: 'Rectangle', icon: IconRect },
  { name: 'ellipse', label: 'Ellipse', icon: IconEllipse },
  { name: 'line', label: 'Line', icon: IconLine },
  { name: 'arrow', label: 'Arrow', icon: IconArrow },
  { name: 'ink', label: 'Freehand', icon: IconInk },
  { name: 'image', label: 'Image', icon: IconImage },
  { name: 'note', label: 'Sticky note', icon: IconNote },
];

const imageInput = ref<HTMLInputElement>();
function chooseTool(name: EditorTool) {
  if (name === 'image') {
    imageInput.value?.click();
    return;
  }
  tool.value = name;
}

async function onImage(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  (event.target as HTMLInputElement).value = '';
  if (!file) {
    return;
  }
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  const isJpeg = file.type === 'image/jpeg';
  const dataUrl = canvas.toDataURL(isJpeg ? 'image/jpeg' : 'image/png', 0.92);
  const scale = Math.min(1, 250 / bitmap.width);
  pendingImage.value = { dataUrl, width: bitmap.width * scale * 0.75, height: bitmap.height * scale * 0.75 };
  tool.value = 'image';
  state.notice.value = 'Click on the page to place the image.';
}

const toolHelp = computed(() => ({
  'select': 'Click an object to select it; drag to move, use the corner handles to resize. Delete removes it, arrows nudge it.',
  'text': 'Click where the text should go and start typing. Double-click text later to edit it.',
  'edit-text': 'Click a line of existing text: it is covered and replaced by an editable copy.',
  'whiteout': 'Drag over content to cover it with white.',
  'highlight': 'Drag over text to highlight it.',
  'underline': 'Drag over text to underline it.',
  'strikeout': 'Drag over text to strike it through.',
  'rect': 'Drag to draw a rectangle.',
  'ellipse': 'Drag to draw an ellipse.',
  'line': 'Drag to draw a line.',
  'arrow': 'Drag to draw an arrow.',
  'ink': 'Draw freehand.',
  'image': 'Click on the page to place the image.',
  'note': 'Click to add a sticky note; type its text below.',
  'redact': '',
  'field': '',
} as Record<EditorTool, string>)[tool.value]);

// ---- selected object properties ----
function patch(values: Record<string, unknown>) {
  if (selectedObject.value) {
    state.updateObject(currentPage.value, selectedObject.value.id, values as any, { history: true });
  }
}
const sel = computed(() => selectedObject.value as any);

const fontOptions = [
  { label: 'Helvetica (sans)', value: 'Helvetica' },
  { label: 'Times (serif)', value: 'TimesRoman' },
  { label: 'Courier (mono)', value: 'Courier' },
];

// ---- watermark ----
const watermark = reactive({ text: 'CONFIDENTIAL', fontSize: 60, color: '#d32f2f', opacity: 0.25, angle: 45, pages: '' });
async function applyWatermark() {
  const pages = watermark.pages.trim() ? parsePageRanges(watermark.pages, pageCount.value) : null;
  await state.run('Adding watermark', b => addWatermark(b, { ...watermark, pages }));
}

// ---- header / footer / page numbers ----
const stamp = reactive({
  template: 'Page {page} of {total}',
  position: 'bottom-center' as StampPosition,
  fontSize: 10,
  color: '#000000',
  margin: 24,
  startNumber: 1,
  batesPrefix: 'DOC',
  batesDigits: 6,
  skipFirstPage: false,
});
const positions = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'].map(p => ({ label: p.replace('-', ' '), value: p }));
const presets = [
  { label: 'Page X of Y', value: 'Page {page} of {total}' },
  { label: 'Page number', value: '{page}' },
  { label: 'Bates number', value: '{bates}' },
  { label: 'Date', value: '{date}' },
];
async function applyStamp() {
  await state.run('Adding header/footer', b => addHeaderFooter(b, { ...stamp }));
}
</script>

<template>
  <div class="panel-body">
    <div class="tools">
      <c-tooltip v-for="t in tools" :key="t.name" :tooltip="t.label">
        <c-button
          :type="tool === t.name ? 'primary' : 'default'"
          size="small"
          :aria-label="t.label"
          :data-test-id="`tool-${t.name}`"
          style="width: 100%"
          @click="chooseTool(t.name)"
        >
          <component :is="t.icon" />
        </c-button>
      </c-tooltip>
    </div>
    <input ref="imageInput" type="file" accept="image/*" hidden @change="onImage">
    <p class="hint">
      {{ toolHelp }}
    </p>

    <!-- selected object -->
    <template v-if="sel">
      <h4>Selected: {{ sel.type }}</h4>
      <template v-if="sel.type === 'text'">
        <n-input type="textarea" :value="sel.text" :autosize="{ minRows: 2, maxRows: 6 }" @update:value="(v: string) => patch({ text: v })" />
        <div class="row">
          <n-select :value="sel.font" size="small" :options="fontOptions" @update:value="(v: string) => patch({ font: v })" />
          <n-input-number :value="sel.fontSize" size="small" :min="4" :max="200" style="width: 100px" @update:value="(v: number | null) => v && patch({ fontSize: v })" />
        </div>
        <div class="row">
          <n-checkbox :checked="sel.bold" @update:checked="(v: boolean) => patch({ bold: v })">
            Bold
          </n-checkbox>
          <n-checkbox :checked="sel.italic" @update:checked="(v: boolean) => patch({ italic: v })">
            Italic
          </n-checkbox>
          <n-color-picker :value="sel.color" size="small" :modes="['hex']" :show-alpha="false" style="width: 90px" @update:value="(v: string) => patch({ color: v })" />
        </div>
        <n-checkbox :checked="!!sel.background" @update:checked="(v: boolean) => patch({ background: v ? '#ffffff' : null })">
          White background (covers what is underneath)
        </n-checkbox>
      </template>
      <template v-else-if="sel.type === 'rect' || sel.type === 'ellipse'">
        <div class="row">
          <label>Stroke</label>
          <n-color-picker :value="sel.stroke ?? '#000000'" size="small" :modes="['hex']" :show-alpha="false" @update:value="(v: string) => patch({ stroke: v })" />
          <n-input-number :value="sel.strokeWidth" size="small" :min="0" :max="30" style="width: 90px" @update:value="(v: number | null) => patch({ strokeWidth: v ?? 0 })" />
        </div>
        <div class="row">
          <label>Fill</label>
          <n-color-picker :value="sel.fill ?? '#ffffff'" size="small" :modes="['hex']" :show-alpha="false" @update:value="(v: string) => patch({ fill: v })" />
          <c-button size="small" variant="text" @click="patch({ fill: null })">
            None
          </c-button>
        </div>
        <div class="row">
          <label>Opacity</label>
          <n-slider :value="sel.opacity" :min="0.1" :max="1" :step="0.05" @update:value="(v: number) => patch({ opacity: v })" />
        </div>
      </template>
      <template v-else-if="sel.type === 'line' || sel.type === 'arrow' || sel.type === 'ink'">
        <div class="row">
          <label>Color</label>
          <n-color-picker :value="sel.stroke" size="small" :modes="['hex']" :show-alpha="false" @update:value="(v: string) => patch({ stroke: v })" />
          <n-input-number :value="sel.strokeWidth" size="small" :min="1" :max="30" style="width: 90px" @update:value="(v: number | null) => v && patch({ strokeWidth: v })" />
        </div>
      </template>
      <template v-else-if="sel.type === 'highlight' || sel.type === 'underline' || sel.type === 'strikeout'">
        <div class="row">
          <label>Color</label>
          <n-color-picker :value="sel.color" size="small" :modes="['hex']" :show-alpha="false" @update:value="(v: string) => patch({ color: v })" />
        </div>
      </template>
      <template v-else-if="sel.type === 'note'">
        <n-input type="textarea" :value="sel.text" placeholder="Note text" :autosize="{ minRows: 3, maxRows: 8 }" @update:value="(v: string) => patch({ text: v })" />
        <div class="row">
          <n-input :value="sel.author" size="small" placeholder="Author" @update:value="(v: string) => patch({ author: v })" />
          <n-color-picker :value="sel.color" size="small" :modes="['hex']" :show-alpha="false" style="width: 90px" @update:value="(v: string) => patch({ color: v })" />
        </div>
      </template>
      <c-button size="small" type="error" @click="state.removeObject(currentPage, sel.id)">
        <icon-mdi-delete-outline mr-1 /> Delete object
      </c-button>
    </template>

    <!-- defaults for new objects -->
    <h4>New object style</h4>
    <div class="row">
      <label>Color</label>
      <n-color-picker v-model:value="settings.color" size="small" :modes="['hex']" :show-alpha="false" />
    </div>
    <div class="row">
      <label>Highlight</label>
      <n-color-picker v-model:value="settings.highlightColor" size="small" :modes="['hex']" :show-alpha="false" :swatches="['#ffeb3b', '#a5d6a7', '#90caf9', '#f48fb1', '#ffcc80']" />
    </div>
    <div class="row">
      <label>Font</label>
      <n-select v-model:value="settings.font" size="small" :options="fontOptions" />
      <n-input-number v-model:value="settings.fontSize" size="small" :min="4" :max="200" style="width: 90px" />
    </div>
    <div class="row">
      <label>Line width</label>
      <n-input-number v-model:value="settings.strokeWidth" size="small" :min="1" :max="30" style="width: 90px" />
      <n-checkbox :checked="!!settings.fill" @update:checked="(v: boolean) => (settings.fill = v ? '#ffffff' : null)">
        Fill shapes
      </n-checkbox>
    </div>

    <h4>Watermark</h4>
    <n-input v-model:value="watermark.text" size="small" placeholder="Watermark text" />
    <div class="row">
      <n-input-number v-model:value="watermark.fontSize" size="small" :min="8" :max="200" style="width: 90px" />
      <n-input-number v-model:value="watermark.angle" size="small" :min="-90" :max="90" style="width: 90px">
        <template #suffix>
          °
        </template>
      </n-input-number>
      <n-color-picker v-model:value="watermark.color" size="small" :modes="['hex']" :show-alpha="false" />
    </div>
    <div class="row">
      <label>Opacity</label>
      <n-slider v-model:value="watermark.opacity" :min="0.05" :max="1" :step="0.05" />
    </div>
    <div class="row">
      <n-input v-model:value="watermark.pages" size="small" placeholder="All pages (or e.g. 1-3)" />
      <c-button size="small" @click="applyWatermark">
        Apply
      </c-button>
    </div>

    <h4>Header, footer &amp; page numbers</h4>
    <div class="row">
      <n-select size="small" :options="presets" placeholder="Preset" @update:value="(v: string) => (stamp.template = v)" />
      <n-select v-model:value="stamp.position" size="small" :options="positions" />
    </div>
    <n-input v-model:value="stamp.template" size="small" placeholder="Text: {page}, {total}, {bates}, {date}" />
    <div class="row">
      <label>Start at</label>
      <n-input-number v-model:value="stamp.startNumber" size="small" :min="0" style="width: 90px" />
      <n-input-number v-model:value="stamp.fontSize" size="small" :min="5" :max="48" style="width: 90px">
        <template #suffix>
          pt
        </template>
      </n-input-number>
    </div>
    <div v-if="stamp.template.includes('{bates}')" class="row">
      <label>Bates</label>
      <n-input v-model:value="stamp.batesPrefix" size="small" placeholder="Prefix" />
      <n-input-number v-model:value="stamp.batesDigits" size="small" :min="1" :max="12" style="width: 90px" />
    </div>
    <div class="row">
      <n-checkbox v-model:checked="stamp.skipFirstPage">
        Skip first page
      </n-checkbox>
      <c-button size="small" @click="applyStamp">
        Apply
      </c-button>
    </div>
  </div>
</template>

<style lang="less" scoped>
@import './panel.less';
</style>
