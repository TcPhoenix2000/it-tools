<script setup lang="ts">
import SignaturePad from 'signature_pad';

const props = defineProps<{ show: boolean; mode: 'signature' | 'initials' }>();
const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
  (e: 'created', value: { dataUrl: string; width: number; height: number }): void
}>();

const tab = ref<'draw' | 'type' | 'upload'>('draw');
const penColor = ref('#0b2a6f');
const typed = ref('');
const typedFont = ref('cursive');
const remember = ref(true);
const canvas = ref<HTMLCanvasElement>();
let pad: SignaturePad | null = null;

const fonts = [
  { label: 'Handwriting', value: 'cursive' },
  { label: 'Brush', value: '"Brush Script MT", "Segoe Script", cursive' },
  { label: 'Elegant', value: '"Lucida Handwriting", "Apple Chancery", cursive' },
  { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
];

watch(() => props.show, async (show) => {
  if (!show) {
    return;
  }
  await nextTick();
  setupPad();
});

watch(tab, async (t) => {
  if (t === 'draw') {
    await nextTick();
    setupPad();
  }
});

watch(penColor, (c) => {
  if (pad) {
    pad.penColor = c;
  }
});

function setupPad() {
  if (!canvas.value) {
    return;
  }
  const ratio = window.devicePixelRatio || 1;
  canvas.value.width = canvas.value.offsetWidth * ratio;
  canvas.value.height = canvas.value.offsetHeight * ratio;
  canvas.value.getContext('2d')!.scale(ratio, ratio);
  pad?.off();
  pad = new SignaturePad(canvas.value, { penColor: penColor.value, minWidth: 0.8, maxWidth: 2.6 });
}

// Crop transparent borders so the signature is placed tightly
function trimCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = source.getContext('2d')!;
  const { width, height } = source;
  const data = ctx.getImageData(0, 0, width, height).data;
  let top = height;
  let left = width;
  let right = 0;
  let bottom = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 10) {
        top = Math.min(top, y);
        left = Math.min(left, x);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  }
  if (right < left) {
    return source;
  }
  const out = document.createElement('canvas');
  out.width = right - left + 9;
  out.height = bottom - top + 9;
  out.getContext('2d')!.drawImage(source, left - 4, top - 4, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

function typedToCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const size = props.mode === 'initials' ? 64 : 72;
  c.width = 1200;
  c.height = 200;
  const ctx = c.getContext('2d')!;
  ctx.font = `${size}px ${typedFont.value}`;
  ctx.fillStyle = penColor.value;
  ctx.textBaseline = 'middle';
  ctx.fillText(typed.value, 10, 100);
  return trimCanvas(c);
}

const uploadError = ref('');
async function onUpload(file: File) {
  uploadError.value = '';
  if (!file.type.startsWith('image/')) {
    uploadError.value = 'Please choose an image (PNG with transparent background works best).';
    return;
  }
  const bitmap = await createImageBitmap(file);
  const c = document.createElement('canvas');
  c.width = bitmap.width;
  c.height = bitmap.height;
  c.getContext('2d')!.drawImage(bitmap, 0, 0);
  finish(c);
}

const saved = useStorage<string[]>(computed(() => `pdf-editor:${props.mode}s`).value, [], undefined, { listenToStorageChanges: false });

function finish(source: HTMLCanvasElement) {
  const dataUrl = source.toDataURL('image/png');
  if (remember.value && !saved.value.includes(dataUrl)) {
    try {
      saved.value = [dataUrl, ...saved.value].slice(0, 6);
    }
    catch {
      // storage full or disabled: the signature is still used, just not remembered
    }
  }
  use(dataUrl, source.width, source.height);
}

function use(dataUrl: string, width: number, height: number) {
  // place at ~180pt wide for signatures, ~70pt for initials
  const target = props.mode === 'initials' ? 70 : 180;
  const scale = target / width;
  emit('created', { dataUrl, width: width * scale, height: height * scale });
  emit('update:show', false);
}

async function useSaved(dataUrl: string) {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  use(dataUrl, img.naturalWidth, img.naturalHeight);
}

function create() {
  if (tab.value === 'draw') {
    if (!pad || pad.isEmpty()) {
      return;
    }
    finish(trimCanvas(canvas.value!));
  }
  else if (tab.value === 'type' && typed.value.trim()) {
    finish(typedToCanvas());
  }
}

function forget(dataUrl: string) {
  saved.value = saved.value.filter(s => s !== dataUrl);
}
</script>

<template>
  <c-modal :open="show" style="width: 640px; max-width: 95vw" @update:open="emit('update:show', $event)">
    <h3 mt-0>
      {{ mode === 'initials' ? 'Create initials' : 'Create signature' }}
    </h3>

    <div v-if="saved.length" mb-3>
      <div mb-1 op-70>
        Saved in this browser
      </div>
      <div flex flex-wrap gap-2>
        <div v-for="s in saved" :key="s.slice(-40)" class="saved">
          <img :src="s" alt="saved signature" @click="useSaved(s)">
          <icon-mdi-close class="forget" @click="forget(s)" />
        </div>
      </div>
    </div>

    <n-tabs v-model:value="tab" type="segment" size="small">
      <n-tab-pane name="draw" tab="Draw">
        <canvas ref="canvas" class="pad" />
        <div mt-2 flex items-center gap-2>
          <n-color-picker v-model:value="penColor" :modes="['hex']" :show-alpha="false" size="small" style="width: 120px" />
          <c-button size="small" @click="pad?.clear()">
            Clear
          </c-button>
        </div>
      </n-tab-pane>
      <n-tab-pane name="type" tab="Type">
        <c-input-text v-model:value="typed" :placeholder="mode === 'initials' ? 'Your initials' : 'Your full name'" />
        <n-radio-group v-model:value="typedFont" mt-2>
          <n-radio v-for="f in fonts" :key="f.label" :value="f.value">
            <span :style="{ fontFamily: f.value, fontSize: '20px' }">{{ typed || f.label }}</span>
          </n-radio>
        </n-radio-group>
      </n-tab-pane>
      <n-tab-pane name="upload" tab="Upload">
        <c-file-upload accept="image/*" title="Drop an image of your signature here" @file-upload="onUpload" />
        <c-alert v-if="uploadError" mt-2>
          {{ uploadError }}
        </c-alert>
      </n-tab-pane>
    </n-tabs>

    <div mt-4 flex items-center justify-between>
      <n-checkbox v-model:checked="remember">
        Remember in this browser
      </n-checkbox>
      <div flex gap-2>
        <c-button @click="emit('update:show', false)">
          Cancel
        </c-button>
        <c-button v-if="tab !== 'upload'" type="primary" @click="create">
          Place on page
        </c-button>
      </div>
    </div>
  </c-modal>
</template>

<style lang="less" scoped>
.pad {
  width: 100%;
  height: 180px;
  border: 1px dashed rgba(127, 127, 127, 0.5);
  border-radius: 4px;
  background: #fff;
  touch-action: none;
  display: block;
}

.saved {
  position: relative;
  border: 1px solid rgba(127, 127, 127, 0.3);
  border-radius: 4px;
  background: #fff;
  padding: 4px;
  cursor: pointer;

  img {
    height: 40px;
    display: block;
  }

  .forget {
    position: absolute;
    top: -6px;
    right: -6px;
    background: #fff;
    border-radius: 50%;
    color: #c00;
    font-size: 14px;
  }
}
</style>
