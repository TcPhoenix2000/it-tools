<script setup lang="ts">
import * as monaco from 'monaco-editor';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { usePdfEditor } from '../../pdf-editor.store';
import { openPdf } from '../../services/pdf-render.service';
import { type VisualDiff, documentText, visualDiff } from '../../services/pdf-compare.service';
import { useStyleStore } from '@/stores/style.store';

const state = usePdfEditor();
const { pdf, fileName } = state;
const styleStore = useStyleStore();

const other = shallowRef<PDFDocumentProxy | null>(null);
const otherName = ref('');
const showResult = ref(false);
const mode = ref<'text' | 'visual'>('text');
const comparePage = ref(1);
const diff = ref<VisualDiff | null>(null);
const container = ref<HTMLDivElement>();
let editor: monaco.editor.IStandaloneDiffEditor | null = null;

const input = ref<HTMLInputElement>();
async function onFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  (event.target as HTMLInputElement).value = '';
  if (!file) {
    return;
  }
  try {
    other.value?.loadingTask.destroy();
    other.value = await openPdf(new Uint8Array(await file.arrayBuffer()));
    otherName.value = file.name;
    showResult.value = true;
    await nextTick();
    await refresh();
  }
  catch (e: any) {
    state.error.value = `Could not open ${file.name}: ${e.message}`;
  }
}

async function refresh() {
  if (!pdf.value || !other.value) {
    return;
  }
  state.busy.value = 'Comparing';
  try {
    if (mode.value === 'text') {
      diff.value = null;
      await nextTick();
      const [a, b] = await Promise.all([documentText(pdf.value), documentText(other.value)]);
      editor?.dispose();
      editor = monaco.editor.createDiffEditor(container.value!, {
        readOnly: true,
        originalEditable: false,
        minimap: { enabled: false },
        renderSideBySide: true,
        wordWrap: 'on',
        theme: styleStore.isDarkTheme ? 'vs-dark' : 'vs',
        automaticLayout: true,
      });
      editor.setModel({ original: monaco.editor.createModel(a, 'plaintext'), modified: monaco.editor.createModel(b, 'plaintext') });
    }
    else {
      diff.value = await visualDiff(pdf.value, other.value, comparePage.value - 1);
    }
  }
  finally {
    state.busy.value = null;
  }
}

watch([mode, comparePage], () => showResult.value && refresh());

onBeforeUnmount(() => {
  editor?.getModel()?.original.dispose();
  editor?.getModel()?.modified.dispose();
  editor?.dispose();
  other.value?.loadingTask.destroy();
});

const maxPages = computed(() => Math.max(pdf.value?.numPages ?? 1, other.value?.numPages ?? 1));
</script>

<template>
  <div class="panel-body">
    <h4>Compare documents</h4>
    <p class="hint">
      Compare "{{ fileName }}" (left / before) with another version (right / after).
    </p>
    <input ref="input" type="file" accept=".pdf,application/pdf" hidden @change="onFile">
    <c-button size="small" type="primary" @click="input?.click()">
      <icon-mdi-file-compare mr-1 /> Choose the other PDF…
    </c-button>
    <p v-if="otherName" class="hint">
      Comparing with <b>{{ otherName }}</b>
    </p>

    <c-modal :open="showResult" style="width: 95vw; max-width: 1400px" @update:open="showResult = $event">
      <div mb-3 flex flex-wrap items-center gap-3>
        <n-radio-group v-model:value="mode" size="small">
          <n-radio-button value="text">
            Text changes
          </n-radio-button>
          <n-radio-button value="visual">
            Visual changes
          </n-radio-button>
        </n-radio-group>
        <template v-if="mode === 'visual'">
          <span>Page</span>
          <n-input-number v-model:value="comparePage" size="small" :min="1" :max="maxPages" style="width: 100px" />
          <span v-if="diff" op-70>{{ (diff.changedRatio * 100).toFixed(2) }}% of the page changed (red)</span>
        </template>
      </div>
      <div v-show="mode === 'text'" ref="container" class="diff" />
      <div v-if="mode === 'visual'" class="visual">
        <img v-if="diff" :src="diff.dataUrl" alt="visual difference">
        <p v-else op-70>
          This page does not exist in both documents.
        </p>
      </div>
    </c-modal>
  </div>
</template>

<style lang="less" scoped>
@import './panel.less';

.diff {
  height: 70vh;
}

.visual {
  max-height: 75vh;
  overflow: auto;
  text-align: center;

  img {
    max-width: 100%;
    box-shadow: 0 1px 6px rgba(0, 0, 0, 0.3);
  }
}
</style>
