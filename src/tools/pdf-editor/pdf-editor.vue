<script setup lang="ts">
import { createPdfEditorState, pdfEditorKey } from './pdf-editor.store';
import { PdfPasswordError, openPdf } from './services/pdf-render.service';
import { decryptPdf, insertFiles } from './services/pdf-document.service';
import PdfPageEditor from './components/pdf-page-editor.vue';
import PdfThumbnails from './components/pdf-thumbnails.vue';
import OrganizePanel from './components/panels/organize-panel.vue';
import EditPanel from './components/panels/edit-panel.vue';
import FormsPanel from './components/panels/forms-panel.vue';
import SignPanel from './components/panels/sign-panel.vue';
import RedactPanel from './components/panels/redact-panel.vue';
import ProtectPanel from './components/panels/protect-panel.vue';
import OptimizePanel from './components/panels/optimize-panel.vue';
import OcrPanel from './components/panels/ocr-panel.vue';
import ComparePanel from './components/panels/compare-panel.vue';

const state = createPdfEditorState();
provide(pdfEditorKey, state);
const { isLoaded, fileName, pageCount, currentPage, zoom, busy, progress, error, notice, undoStack, redoStack, hasPendingEdits, pendingRedactions, bytes } = state;

const panel = ref('edit');
const passwordPrompt = ref<{ bytes: Uint8Array; name: string; incorrect: boolean } | null>(null);
const password = ref('');

async function readFile(file: File) {
  return { name: file.name, type: file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : ''), bytes: new Uint8Array(await file.arrayBuffer()) };
}

async function openFiles(files: File[]) {
  if (!files.length) {
    return;
  }
  error.value = null;
  busy.value = 'Opening';
  try {
    const incoming = await Promise.all(files.map(readFile));
    const first = incoming[0];
    if (incoming.length === 1 && first.type === 'application/pdf') {
      try {
        await openPdf(first.bytes).then(d => d.loadingTask.destroy());
      }
      catch (e) {
        if (e instanceof PdfPasswordError) {
          passwordPrompt.value = { bytes: first.bytes, name: first.name, incorrect: false };
          return;
        }
        throw e;
      }
      state.close();
      fileName.value = first.name;
      await state.load(first.bytes);
    }
    else {
      // several files, or images: combine them into one new PDF
      const combined = await insertFiles(null, incoming);
      state.close();
      fileName.value = incoming.length === 1 ? first.name.replace(/\.[^.]+$/, '.pdf') : 'combined.pdf';
      await state.load(combined);
    }
  }
  catch (e: any) {
    error.value = `Could not open the file: ${e?.message ?? e}`;
  }
  finally {
    busy.value = null;
  }
}

async function submitPassword() {
  const prompt = passwordPrompt.value;
  if (!prompt || busy.value) {
    return;
  }
  const attempt = password.value;
  busy.value = 'Unlocking';
  try {
    // check the password with pdf.js, then remove the encryption so the document can be edited
    await openPdf(prompt.bytes, attempt).then(d => d.loadingTask.destroy());
    const decrypted = await decryptPdf(prompt.bytes, attempt);
    state.close();
    fileName.value = prompt.name;
    await state.load(decrypted);
    passwordPrompt.value = null;
    notice.value = 'Document unlocked. It will be saved without a password unless you protect it again in the Protect tab.';
  }
  catch (e: any) {
    if (e instanceof PdfPasswordError) {
      passwordPrompt.value = { ...prompt, incorrect: true };
    }
    else {
      error.value = `Could not unlock the document: ${e?.message ?? e}`;
      passwordPrompt.value = null;
    }
  }
  finally {
    // don't wipe a password the user started typing while this attempt was running
    if (password.value === attempt) {
      password.value = '';
    }
    busy.value = null;
  }
}

const fileInput = ref<HTMLInputElement>();
function pickFile() {
  fileInput.value?.click();
}
function onFileInput(event: Event) {
  const files = [...((event.target as HTMLInputElement).files ?? [])];
  (event.target as HTMLInputElement).value = '';
  openFiles(files);
}

async function newBlank() {
  const { PDFDocument } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]);
  state.close();
  fileName.value = 'new-document.pdf';
  await state.load(await doc.save());
}

function setZoom(value: number) {
  zoom.value = Math.min(4, Math.max(0.25, Math.round(value * 100) / 100));
}

const viewer = ref<HTMLDivElement>();
async function fitWidth() {
  if (!state.pdf.value || !viewer.value) {
    return;
  }
  const page = await state.pdf.value.getPage(currentPage.value + 1);
  const width = page.getViewport({ scale: 1 }).width;
  setZoom((viewer.value.clientWidth - 48) / width);
}

function goTo(page: number) {
  currentPage.value = Math.min(Math.max(page, 0), pageCount.value - 1);
  state.selectedObjectId.value = null;
}

async function print() {
  await state.run('Preparing print', async () => undefined);
  if (!bytes.value) {
    return;
  }
  const url = URL.createObjectURL(new Blob([bytes.value], { type: 'application/pdf' }));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// drag & drop anywhere on the editor
const dropping = ref(false);
function onDrop(event: DragEvent) {
  dropping.value = false;
  const files = [...(event.dataTransfer?.files ?? [])];
  if (files.length) {
    openFiles(files);
  }
}

// warn before leaving with unsaved edits
useEventListener(window, 'beforeunload', (event: BeforeUnloadEvent) => {
  if (isLoaded.value && (undoStack.value.length > 0 || hasPendingEdits.value)) {
    event.preventDefault();
  }
});

const panels = [
  { name: 'organize', label: 'Organize' },
  { name: 'edit', label: 'Edit' },
  { name: 'forms', label: 'Forms' },
  { name: 'sign', label: 'Sign' },
  { name: 'redact', label: 'Redact' },
  { name: 'protect', label: 'Protect' },
  { name: 'optimize', label: 'Optimize' },
  { name: 'ocr', label: 'OCR' },
  { name: 'compare', label: 'Compare' },
];
</script>

<template>
  <div class="pdf-editor" @dragover.prevent="dropping = true" @dragleave.self="dropping = false" @drop.prevent="onDrop">
    <input ref="fileInput" type="file" accept=".pdf,application/pdf,image/*" multiple hidden @change="onFileInput">

    <!-- start screen -->
    <c-card v-if="!isLoaded" class="start">
      <c-file-upload
        multiple
        accept=".pdf,application/pdf,image/*"
        title="Drop a PDF here to edit it, or several PDFs/images to combine them into one, or click to choose files"
        @files-upload="openFiles"
      />
      <div mt-3 flex flex-wrap items-center justify-between gap-2>
        <span op-70>
          Everything happens in your browser: files are never uploaded.
        </span>
        <c-button @click="newBlank">
          Start from a blank page
        </c-button>
      </div>
    </c-card>

    <template v-else>
      <!-- toolbar -->
      <c-card class="toolbar">
        <div class="toolbar-row">
          <c-tooltip tooltip="Open another file">
            <c-button circle variant="text" aria-label="Open" @click="pickFile">
              <icon-mdi-folder-open-outline />
            </c-button>
          </c-tooltip>
          <span class="file-name" :title="fileName">{{ fileName }}</span>

          <span class="sep" />
          <c-button circle variant="text" aria-label="Previous page" :disabled="currentPage === 0" @click="goTo(currentPage - 1)">
            <icon-mdi-chevron-left />
          </c-button>
          <span data-test-id="page-indicator">{{ currentPage + 1 }} / {{ pageCount }}</span>
          <c-button circle variant="text" aria-label="Next page" :disabled="currentPage >= pageCount - 1" @click="goTo(currentPage + 1)">
            <icon-mdi-chevron-right />
          </c-button>

          <span class="sep" />
          <c-button circle variant="text" aria-label="Zoom out" @click="setZoom(zoom - 0.1)">
            <icon-mdi-magnify-minus-outline />
          </c-button>
          <span class="zoom">{{ Math.round(zoom * 100) }}%</span>
          <c-button circle variant="text" aria-label="Zoom in" @click="setZoom(zoom + 0.1)">
            <icon-mdi-magnify-plus-outline />
          </c-button>
          <c-button size="small" variant="text" @click="fitWidth">
            Fit
          </c-button>

          <span class="sep" />
          <c-tooltip tooltip="Undo (Ctrl+Z)">
            <c-button circle variant="text" aria-label="Undo" :disabled="!undoStack.length || !!busy" @click="state.undo()">
              <icon-mdi-undo />
            </c-button>
          </c-tooltip>
          <c-tooltip tooltip="Redo (Ctrl+Y)">
            <c-button circle variant="text" aria-label="Redo" :disabled="!redoStack.length || !!busy" @click="state.redo()">
              <icon-mdi-redo />
            </c-button>
          </c-tooltip>

          <span class="grow" />
          <span v-if="pendingRedactions" class="badge warn">{{ pendingRedactions }} redaction(s) pending</span>
          <c-tooltip tooltip="Print">
            <c-button circle variant="text" aria-label="Print" @click="print">
              <icon-mdi-printer-outline />
            </c-button>
          </c-tooltip>
          <c-button type="primary" data-test-id="download-pdf" :disabled="!!busy" @click="state.exportPdf()">
            <icon-mdi-download mr-1 /> Download PDF
          </c-button>
          <c-tooltip tooltip="Close document">
            <c-button circle variant="text" aria-label="Close" @click="state.close()">
              <icon-mdi-close />
            </c-button>
          </c-tooltip>
        </div>
      </c-card>

      <div class="workspace">
        <c-card class="sidebar">
          <PdfThumbnails />
        </c-card>

        <div ref="viewer" class="viewer">
          <PdfPageEditor />
        </div>

        <c-card class="panel">
          <n-tabs v-model:value="panel" type="line" size="small" :tabs-padding="4">
            <n-tab-pane v-for="p in panels" :key="p.name" :name="p.name" :tab="p.label" display-directive="show:lazy">
              <OrganizePanel v-if="p.name === 'organize'" />
              <EditPanel v-else-if="p.name === 'edit'" />
              <FormsPanel v-else-if="p.name === 'forms'" />
              <SignPanel v-else-if="p.name === 'sign'" />
              <RedactPanel v-else-if="p.name === 'redact'" />
              <ProtectPanel v-else-if="p.name === 'protect'" />
              <OptimizePanel v-else-if="p.name === 'optimize'" />
              <OcrPanel v-else-if="p.name === 'ocr'" />
              <ComparePanel v-else-if="p.name === 'compare'" />
            </n-tab-pane>
          </n-tabs>
        </c-card>
      </div>
    </template>

    <!-- status -->
    <div v-if="busy" class="status busy">
      <n-spin size="small" />
      <span>{{ busy }}…</span>
      <n-progress v-if="progress !== null" type="line" :percentage="Math.round(progress * 100)" style="width: 160px" :show-indicator="false" />
    </div>
    <n-alert v-if="error" type="error" class="status-alert" data-test-id="pdf-error">
      <div flex items-start justify-between gap-2>
        <span>{{ error }}</span>
        <icon-mdi-close cursor-pointer @click="error = null" />
      </div>
    </n-alert>
    <n-alert v-else-if="notice" type="info" class="status-alert">
      <div flex items-start justify-between gap-2>
        <span>{{ notice }}</span>
        <icon-mdi-close cursor-pointer @click="notice = null" />
      </div>
    </n-alert>

    <div v-if="dropping" class="drop-overlay">
      Drop to open
    </div>

    <!-- password prompt -->
    <c-modal :open="!!passwordPrompt" @update:open="!$event && (passwordPrompt = null)">
      <h3 mt-0>
        Password required
      </h3>
      <p>"{{ passwordPrompt?.name }}" is protected. Enter its password to open and edit it.</p>
      <form @submit.prevent="submitPassword">
        <n-input v-model:value="password" type="password" show-password-on="click" placeholder="Password" autofocus :input-props="{ autocomplete: 'off' }" />
        <n-alert v-if="passwordPrompt?.incorrect" type="error" mt-2>
          Incorrect password.
        </n-alert>
        <div mt-3 flex justify-end gap-2>
          <c-button @click="passwordPrompt = null">
            Cancel
          </c-button>
          <c-button type="primary" :disabled="!!busy" @click="submitPassword">
            Unlock
          </c-button>
        </div>
      </form>
    </c-modal>
  </div>
</template>

<style lang="less" scoped>
.pdf-editor {
  // the tool uses the full page width instead of the default 600px column
  flex: 0 0 100% !important;
  max-width: 100%;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.start {
  max-width: 640px;
  width: 100%;
  margin: 0 auto;
}

.toolbar {
  padding: 6px 10px !important;
}

.toolbar-row {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;

  .file-name {
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }

  .sep {
    width: 1px;
    height: 20px;
    background: rgba(127, 127, 127, 0.3);
    margin: 0 6px;
  }

  .zoom {
    min-width: 44px;
    text-align: center;
  }

  .grow {
    flex: 1;
  }
}

.badge {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 10px;

  &.warn {
    background: rgba(240, 160, 32, 0.2);
    color: #c27c0e;
  }
}

.workspace {
  display: grid;
  grid-template-columns: 170px minmax(0, 1fr) 340px;
  gap: 12px;
  height: calc(100vh - 230px);
  min-height: 520px;
}

.sidebar,
.panel {
  padding: 0 !important;
  overflow-y: auto;
}

.panel {
  padding: 4px 12px 12px !important;
}

.viewer {
  overflow: auto;
  background: rgba(127, 127, 127, 0.12);
  border-radius: 4px;
}

@media (max-width: 1100px) {
  .workspace {
    grid-template-columns: 120px minmax(0, 1fr);
    height: auto;

    .panel {
      grid-column: 1 / -1;
    }

    .viewer {
      height: 70vh;
    }
  }
}

@media (max-width: 700px) {
  .workspace {
    grid-template-columns: minmax(0, 1fr);

    .sidebar {
      max-height: 160px;
    }
  }
}

.status {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: 6px;
  background: rgba(30, 30, 30, 0.9);
  color: #fff;
}

.status-alert {
  position: fixed;
  left: 50%;
  bottom: 20px;
  transform: translateX(-50%);
  z-index: 20;
  max-width: min(640px, 90vw);
}

.drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  border: 3px dashed #18a058;
  border-radius: 8px;
  background: rgba(24, 160, 88, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  pointer-events: none;
}
</style>
