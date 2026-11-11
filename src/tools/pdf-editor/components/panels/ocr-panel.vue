<script setup lang="ts">
import { usePdfEditor } from '../../pdf-editor.store';
import type { OcrLanguage } from '../../services/pdf-ocr.service';
import { parsePageRanges } from '../../services/geometry';

const state = usePdfEditor();
const { pageCount } = state;

const language = ref<OcrLanguage>('eng+nld');
const skipPagesWithText = ref(true);
const pageRange = ref('');
const status = ref('');
const done = ref<number | null>(null);

async function run() {
  done.value = null;
  let pages: number[] | undefined;
  try {
    pages = pageRange.value.trim() ? parsePageRanges(pageRange.value, pageCount.value) : undefined;
  }
  catch (e: any) {
    state.error.value = e.message;
    return;
  }
  const options = { language: language.value, skipPagesWithText: skipPagesWithText.value, pages };
  let processed = 0;
  await state.run('Recognizing text (OCR)', async (b) => {
    const { ocrPdf } = await import('../../services/pdf-ocr.service');
    const out = await ocrPdf(b, options, (p) => {
      status.value = `Page ${p.page}/${p.total}: ${p.status}`;
      state.progress.value = (p.page - 1 + p.progress) / Math.max(p.total, 1);
    });
    processed = out.pagesProcessed;
    return processed ? out.bytes : undefined;
  });
  status.value = '';
  if (!state.error.value) {
    done.value = processed;
  }
}
</script>

<template>
  <div class="panel-body">
    <h4>Recognize text</h4>
    <p class="hint">
      Makes scanned pages searchable and selectable by adding an invisible text layer, like Acrobat's "Recognize Text".
      Runs entirely in your browser; the OCR engine (~5 MB) loads the first time.
    </p>
    <div class="row">
      <label>Language</label>
      <n-select
        v-model:value="language"
        size="small"
        :options="[{ label: 'English + Dutch', value: 'eng+nld' }, { label: 'English', value: 'eng' }, { label: 'Dutch', value: 'nld' }]"
      />
    </div>
    <div class="row">
      <label>Pages</label>
      <n-input v-model:value="pageRange" size="small" placeholder="All pages (or e.g. 1-5)" />
    </div>
    <n-checkbox v-model:checked="skipPagesWithText">
      Skip pages that already contain text
    </n-checkbox>
    <c-button size="small" type="primary" data-test-id="run-ocr" @click="run">
      <icon-mdi-text-recognition mr-1 /> Run OCR
    </c-button>
    <p v-if="status" class="hint">
      {{ status }}
    </p>
    <n-alert v-if="done !== null" :type="done ? 'success' : 'info'" :show-icon="false">
      {{ done ? `Text recognized on ${done} page(s). Try selecting or searching it.` : 'No pages needed OCR (they already contain text).' }}
    </n-alert>
  </div>
</template>

<style lang="less" scoped>
@import './panel.less';
</style>
