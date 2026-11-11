<script setup lang="ts">
import { usePdfEditor } from '../../pdf-editor.store';
import { arrangePages, extractPages, insertBlankPage, insertFiles, rotatePages, splitPdf } from '../../services/pdf-document.service';
import { getPageText, renderPageToCanvas } from '../../services/pdf-render.service';
import { baseName, canvasToBytes, downloadBytes, downloadZip } from '../../services/download';
import { parsePageRanges } from '../../services/geometry';

const state = usePdfEditor();
const { pageCount, currentPage, selectedPages, targetPages, fileName, bytes, pdf } = state;

const targetLabel = computed(() => {
  const t = targetPages.value;
  return t.length === 1 ? `page ${t[0] + 1}` : `${t.length} pages (${t.map(i => i + 1).join(', ')})`;
});

function selectRange(input: string) {
  try {
    selectedPages.value = parsePageRanges(input, pageCount.value);
    state.error.value = null;
  }
  catch (e: any) {
    state.error.value = e.message;
  }
}
const rangeInput = ref('');

function allIndexes() {
  return Array.from({ length: pageCount.value }, (_, i) => i);
}

async function rotate(delta: number) {
  const pages = targetPages.value;
  await state.run('Rotating pages', b => rotatePages(b, pages, delta), { changesPages: true });
}

async function remove() {
  const remove = new Set(targetPages.value);
  if (remove.size >= pageCount.value) {
    state.error.value = 'A PDF must keep at least one page.';
    return;
  }
  await state.run('Deleting pages', b => arrangePages(b, allIndexes().filter(i => !remove.has(i))), { changesPages: true });
  selectedPages.value = [];
}

async function duplicate() {
  const dup = new Set(targetPages.value);
  const order = allIndexes().flatMap(i => (dup.has(i) ? [i, i] : [i]));
  await state.run('Duplicating pages', b => arrangePages(b, order), { changesPages: true });
}

async function reverse() {
  await state.run('Reversing page order', b => arrangePages(b, allIndexes().reverse()), { changesPages: true });
}

async function insertBlank() {
  const at = currentPage.value + 1;
  await state.run('Inserting page', b => insertBlankPage(b, at), { changesPages: true });
  currentPage.value = at;
}

async function extract() {
  const pages = targetPages.value;
  await state.run('Extracting pages', async (b) => {
    downloadBytes(await extractPages(b, pages), `${baseName(fileName.value)}-extract.pdf`);
  });
}

// ---- insert files ----
const insertPosition = ref<'after' | 'start' | 'end'>('end');
const insertInput = ref<HTMLInputElement>();
async function onInsertFiles(event: Event) {
  const files = [...((event.target as HTMLInputElement).files ?? [])];
  (event.target as HTMLInputElement).value = '';
  if (!files.length) {
    return;
  }
  const incoming = await Promise.all(files.map(async f => ({ name: f.name, type: f.type || (f.name.endsWith('.pdf') ? 'application/pdf' : ''), bytes: new Uint8Array(await f.arrayBuffer()) })));
  const at = insertPosition.value === 'start' ? 0 : insertPosition.value === 'after' ? currentPage.value + 1 : pageCount.value;
  await state.run('Inserting files', b => insertFiles(b, incoming, at), { changesPages: true });
  currentPage.value = Math.min(at, pageCount.value - 1);
}

// ---- split ----
const splitMode = ref<'every' | 'ranges'>('every');
const splitEvery = ref(1);
const splitRanges = ref('1-2; 3-');
async function split() {
  await state.run('Splitting', async (b) => {
    const parts = await splitPdf(b, splitMode.value === 'every' ? { kind: 'every', size: splitEvery.value } : { kind: 'ranges', ranges: splitRanges.value });
    const base = baseName(fileName.value);
    downloadZip(parts.map(p => ({ name: `${base}-${p.name}.pdf`, bytes: p.bytes })), `${base}-split.zip`);
    state.notice.value = `Split into ${parts.length} file(s).`;
  });
}

// ---- export ----
const imageFormat = ref<'image/png' | 'image/jpeg'>('image/png');
const imageDpi = ref(150);
async function exportImages() {
  const pages = selectedPages.value.length ? targetPages.value : allIndexes();
  await state.run('Exporting images', async () => {
    const ext = imageFormat.value === 'image/png' ? 'png' : 'jpg';
    const base = baseName(fileName.value);
    const files = [];
    for (const [n, i] of pages.entries()) {
      state.progress.value = n / pages.length;
      const canvas = await renderPageToCanvas(pdf.value!, i, imageDpi.value);
      files.push({ name: `${base}-page-${String(i + 1).padStart(3, '0')}.${ext}`, bytes: await canvasToBytes(canvas, imageFormat.value) });
    }
    if (files.length === 1) {
      downloadBytes(files[0].bytes, files[0].name, imageFormat.value);
    }
    else {
      downloadZip(files, `${base}-images.zip`);
    }
  });
}

async function exportText() {
  await state.run('Extracting text', async () => {
    const parts = [];
    for (let i = 0; i < pageCount.value; i++) {
      parts.push(`--- Page ${i + 1} ---\n${await getPageText(pdf.value!, i)}`);
    }
    downloadBytes(new TextEncoder().encode(parts.join('\n\n')), `${baseName(fileName.value)}.txt`, 'text/plain');
  });
}

const sizeLabel = computed(() => (bytes.value ? `${(bytes.value.length / 1024 / 1024).toFixed(2)} MB` : ''));
</script>

<template>
  <div class="panel-body">
    <p class="hint">
      Applies to <b>{{ targetLabel }}</b>. Ctrl/Shift-click thumbnails to select several, drag them to reorder.
    </p>
    <div flex gap-2>
      <n-input v-model:value="rangeInput" size="small" placeholder="Select pages, e.g. 1-3, 7" @keyup.enter="selectRange(rangeInput)" />
      <c-button size="small" @click="selectRange(rangeInput)">
        Select
      </c-button>
      <c-button size="small" variant="text" @click="selectedPages = []">
        Clear
      </c-button>
    </div>

    <div class="grid">
      <c-button size="small" @click="rotate(-90)">
        <icon-mdi-rotate-left mr-1 /> Rotate left
      </c-button>
      <c-button size="small" @click="rotate(90)">
        <icon-mdi-rotate-right mr-1 /> Rotate right
      </c-button>
      <c-button size="small" @click="duplicate">
        <icon-mdi-content-duplicate mr-1 /> Duplicate
      </c-button>
      <c-button size="small" type="error" @click="remove">
        <icon-mdi-delete-outline mr-1 /> Delete
      </c-button>
      <c-button size="small" @click="extract">
        <icon-mdi-file-export-outline mr-1 /> Extract
      </c-button>
      <c-button size="small" @click="insertBlank">
        <icon-mdi-file-plus-outline mr-1 /> Blank page
      </c-button>
      <c-button size="small" @click="reverse">
        <icon-mdi-swap-vertical mr-1 /> Reverse order
      </c-button>
    </div>

    <h4>Insert / merge files</h4>
    <p class="hint">
      PDFs are merged page by page; images become new pages.
    </p>
    <n-radio-group v-model:value="insertPosition" size="small">
      <n-radio-button value="start">
        At start
      </n-radio-button>
      <n-radio-button value="after">
        After current
      </n-radio-button>
      <n-radio-button value="end">
        At end
      </n-radio-button>
    </n-radio-group>
    <input ref="insertInput" type="file" accept=".pdf,application/pdf,image/*" multiple hidden @change="onInsertFiles">
    <c-button mt-2 size="small" @click="insertInput?.click()">
      <icon-mdi-file-document-multiple-outline mr-1 /> Choose PDFs or images…
    </c-button>

    <h4>Split</h4>
    <n-radio-group v-model:value="splitMode" size="small">
      <n-radio-button value="every">
        Every N pages
      </n-radio-button>
      <n-radio-button value="ranges">
        By ranges
      </n-radio-button>
    </n-radio-group>
    <div mt-2 flex items-center gap-2>
      <n-input-number v-if="splitMode === 'every'" v-model:value="splitEvery" size="small" :min="1" :max="pageCount" style="width: 110px" />
      <n-input v-else v-model:value="splitRanges" size="small" placeholder="1-3; 4-6; 7-" />
      <c-button size="small" @click="split">
        Split &amp; download
      </c-button>
    </div>

    <h4>Export</h4>
    <div flex flex-wrap items-center gap-2>
      <n-select v-model:value="imageFormat" size="small" style="width: 90px" :options="[{ label: 'PNG', value: 'image/png' }, { label: 'JPG', value: 'image/jpeg' }]" />
      <n-input-number v-model:value="imageDpi" size="small" :min="36" :max="600" :step="50" style="width: 110px">
        <template #suffix>
          dpi
        </template>
      </n-input-number>
      <c-button size="small" @click="exportImages">
        Pages as images
      </c-button>
    </div>
    <c-button mt-2 size="small" @click="exportText">
      <icon-mdi-text-box-outline mr-1 /> Export all text (.txt)
    </c-button>

    <p class="hint" mt-4>
      {{ pageCount }} pages · {{ sizeLabel }}
    </p>
  </div>
</template>

<style lang="less" scoped>
@import './panel.less';
</style>
