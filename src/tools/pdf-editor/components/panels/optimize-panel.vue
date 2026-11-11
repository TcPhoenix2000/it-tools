<script setup lang="ts">
import { usePdfEditor } from '../../pdf-editor.store';
import { type CompressionLevel, compressPdf } from '../../services/pdf-optimize.service';

const state = usePdfEditor();
const { bytes, pageCount } = state;

const level = ref<CompressionLevel>('balanced');
const result = ref<{ before: number; after: number; images: number } | null>(null);

// "Maximum" always rasterizes, which can make small text-only files larger: say so honestly
const change = computed(() => {
  if (!result.value?.before) {
    return 'no change';
  }
  const pct = Math.round((1 - result.value.after / result.value.before) * 100);
  return pct >= 0 ? `${pct}% smaller` : `${-pct}% larger`;
});

const levels = [
  { value: 'lossless', label: 'Lossless', help: 'Repacks the file structure. No quality loss.' },
  { value: 'balanced', label: 'Balanced', help: 'Recompresses large photos (max 2000 px, good quality). Text stays sharp and selectable.' },
  { value: 'strong', label: 'Strong', help: 'Smaller photos (max 1400 px, lower quality). Text stays sharp and selectable.' },
  { value: 'maximum', label: 'Maximum', help: 'Turns every page into an image. Smallest file, but text is no longer selectable (run OCR afterwards).' },
];

const help = computed(() => levels.find(l => l.value === level.value)?.help);
const formatSize = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${(n / 1024).toFixed(0)} KB`);

async function compress() {
  const before = bytes.value?.length ?? 0;
  let images = 0;
  const chosen = level.value;
  await state.run('Compressing', async (b) => {
    const out = await compressPdf(b, chosen, pageCount.value);
    images = out.imagesRecompressed;
    if (out.bytes.length >= b.length && chosen !== 'maximum') {
      state.notice.value = 'This document is already well optimized: keeping the original.';
      return b;
    }
    return out.bytes;
  });
  if (!state.error.value) {
    result.value = { before, after: bytes.value?.length ?? 0, images };
  }
}
</script>

<template>
  <div class="panel-body">
    <h4>Reduce file size</h4>
    <n-radio-group v-model:value="level" size="small">
      <n-radio-button v-for="l in levels" :key="l.value" :value="l.value">
        {{ l.label }}
      </n-radio-button>
    </n-radio-group>
    <p class="hint">
      {{ help }}
    </p>
    <c-button size="small" type="primary" data-test-id="compress" @click="compress">
      <icon-mdi-zip-box-outline mr-1 /> Compress
    </c-button>
    <n-alert v-if="result" type="success" :show-icon="false">
      {{ formatSize(result.before) }} → {{ formatSize(result.after) }}
      ({{ change }}<span v-if="result.images">, {{ result.images }} image(s) recompressed</span>).
      Use Undo to go back.
    </n-alert>
    <p class="hint">
      Current size: {{ bytes ? formatSize(bytes.length) : '' }}
    </p>
  </div>
</template>

<style lang="less" scoped>
@import './panel.less';
</style>
