import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { InjectionKey } from 'vue';
import type { EditorObject, EditorTool, ObjectsByPage, ToolSettings } from './pdf-editor.types';
import { applyObjects, hasNonRedactObjects } from './services/pdf-objects.service';
import { openPdf } from './services/pdf-render.service';
import { baseName, downloadBytes } from './services/download';

interface Snapshot {
  bytes: Uint8Array | null
  objects: ObjectsByPage
  fileName: string
}

const MAX_HISTORY = 25;

export function createPdfEditorState() {
  const fileName = ref('document.pdf');
  const bytes = shallowRef<Uint8Array | null>(null);
  const pdf = shallowRef<PDFDocumentProxy | null>(null);
  const pageCount = ref(0);
  const currentPage = ref(0);
  const selectedPages = ref<number[]>([]);
  const zoom = ref(1);
  const version = ref(0);

  const objects = ref<ObjectsByPage>({});
  const selectedObjectId = ref<string | null>(null);
  const editingObjectId = ref<string | null>(null);
  const tool = ref<EditorTool>('select');
  // image or signature waiting to be placed with the 'image' tool
  const pendingImage = ref<{ dataUrl: string; width: number; height: number } | null>(null);
  const settings = reactive<ToolSettings>({
    color: '#000000',
    fill: null,
    strokeWidth: 2,
    fontSize: 12,
    font: 'Helvetica',
    bold: false,
    italic: false,
    opacity: 1,
    highlightColor: '#ffeb3b',
    fieldType: 'text',
  });
  const fieldDraft = reactive({ name: 'field', options: 'Option 1, Option 2', required: false, defaultValue: '' });

  const busy = ref<string | null>(null);
  const progress = ref<number | null>(null);
  const error = ref<string | null>(null);
  const notice = ref<string | null>(null);

  const undoStack = shallowRef<Snapshot[]>([]);
  const redoStack = shallowRef<Snapshot[]>([]);

  const isLoaded = computed(() => !!bytes.value && !!pdf.value);
  const pageObjects = computed(() => objects.value[currentPage.value] ?? []);
  const selectedObject = computed<EditorObject | null>(() => pageObjects.value.find(o => o.id === selectedObjectId.value) ?? null);
  const pendingRedactions = computed(() => Object.values(objects.value).reduce((n, list) => n + list.filter(o => o.type === 'redact').length, 0));
  const hasPendingEdits = computed(() => hasNonRedactObjects(objects.value));
  const targetPages = computed(() => (selectedPages.value.length ? [...selectedPages.value].sort((a, b) => a - b) : [currentPage.value]));

  function cloneObjects(): ObjectsByPage {
    return JSON.parse(JSON.stringify(objects.value));
  }

  function snapshot() {
    undoStack.value = [...undoStack.value.slice(-(MAX_HISTORY - 1)), { bytes: bytes.value, objects: cloneObjects(), fileName: fileName.value }];
    redoStack.value = [];
  }

  async function load(newBytes: Uint8Array, options: { keepPage?: boolean } = {}) {
    const previous = pdf.value;
    const doc = await openPdf(newBytes);
    pdf.value = doc;
    bytes.value = newBytes;
    pageCount.value = doc.numPages;
    if (!options.keepPage || currentPage.value >= doc.numPages) {
      currentPage.value = options.keepPage ? Math.max(0, doc.numPages - 1) : 0;
    }
    selectedPages.value = selectedPages.value.filter(p => p < doc.numPages);
    version.value++;
    previous?.loadingTask.destroy();
  }

  async function restore(state: Snapshot) {
    objects.value = state.objects;
    fileName.value = state.fileName;
    selectedObjectId.value = null;
    editingObjectId.value = null;
    if (state.bytes && state.bytes !== bytes.value) {
      await load(state.bytes, { keepPage: true });
    }
    else if (!state.bytes) {
      close();
    }
  }

  async function undo() {
    const last = undoStack.value.at(-1);
    if (!last) {
      return;
    }
    redoStack.value = [...redoStack.value, { bytes: bytes.value, objects: cloneObjects(), fileName: fileName.value }];
    undoStack.value = undoStack.value.slice(0, -1);
    await restore(last);
  }

  async function redo() {
    const next = redoStack.value.at(-1);
    if (!next) {
      return;
    }
    undoStack.value = [...undoStack.value, { bytes: bytes.value, objects: cloneObjects(), fileName: fileName.value }];
    redoStack.value = redoStack.value.slice(0, -1);
    await restore(next);
  }

  // Write pending editor objects (not redactions) into the document
  async function commit() {
    if (!bytes.value || !hasNonRedactObjects(objects.value)) {
      return;
    }
    const output = await applyObjects(bytes.value, objects.value);
    const remaining: ObjectsByPage = {};
    for (const [page, list] of Object.entries(objects.value)) {
      const redactions = list.filter(o => o.type === 'redact');
      if (redactions.length) {
        remaining[Number(page)] = redactions;
      }
    }
    objects.value = remaining;
    selectedObjectId.value = null;
    editingObjectId.value = null;
    await load(output, { keepPage: true });
  }

  // Run a document operation with undo support, a busy indicator and error reporting
  async function run(label: string, operation: (input: Uint8Array) => Promise<Uint8Array | void>, options: { changesPages?: boolean } = {}) {
    if (!bytes.value || busy.value) {
      return;
    }
    if (options.changesPages && pendingRedactions.value > 0) {
      error.value = 'Apply or remove the pending redactions before reorganising pages.';
      return;
    }
    busy.value = label;
    error.value = null;
    notice.value = null;
    try {
      snapshot();
      await commit();
      const output = await operation(bytes.value);
      if (output) {
        await load(output, { keepPage: true });
      }
    }
    catch (e: any) {
      undoStack.value = undoStack.value.slice(0, -1);
      error.value = e?.message ?? String(e);
    }
    finally {
      busy.value = null;
      progress.value = null;
    }
  }

  async function exportPdf() {
    if (!bytes.value) {
      return;
    }
    if (pendingRedactions.value > 0) {
      error.value = `There are ${pendingRedactions.value} pending redaction(s). Apply them in the Redact tab first, or remove them.`;
      return;
    }
    await run('Saving', async () => undefined);
    if (bytes.value && !error.value) {
      downloadBytes(bytes.value, `${baseName(fileName.value)}.pdf`);
    }
  }

  function close() {
    pdf.value?.loadingTask.destroy();
    pdf.value = null;
    bytes.value = null;
    pageCount.value = 0;
    currentPage.value = 0;
    selectedPages.value = [];
    objects.value = {};
    selectedObjectId.value = null;
    editingObjectId.value = null;
    undoStack.value = [];
    redoStack.value = [];
    version.value++;
  }

  // ---- editor objects ----

  function addObject(pageIndex: number, obj: EditorObject) {
    snapshot();
    objects.value = { ...objects.value, [pageIndex]: [...(objects.value[pageIndex] ?? []), obj] };
    selectedObjectId.value = obj.id;
  }

  function updateObject(pageIndex: number, id: string, patch: Partial<EditorObject>, options: { history?: boolean } = {}) {
    if (options.history) {
      snapshot();
    }
    const list = objects.value[pageIndex] ?? [];
    objects.value = { ...objects.value, [pageIndex]: list.map(o => (o.id === id ? ({ ...o, ...patch } as EditorObject) : o)) };
  }

  function removeObject(pageIndex: number, id: string) {
    snapshot();
    objects.value = { ...objects.value, [pageIndex]: (objects.value[pageIndex] ?? []).filter(o => o.id !== id) };
    if (selectedObjectId.value === id) {
      selectedObjectId.value = null;
      editingObjectId.value = null;
    }
  }

  function removeObjectsOfType(type: EditorObject['type']) {
    snapshot();
    const next: ObjectsByPage = {};
    for (const [page, list] of Object.entries(objects.value)) {
      next[Number(page)] = list.filter(o => o.type !== type);
    }
    objects.value = next;
  }

  function addObjects(entries: { pageIndex: number; obj: EditorObject }[]) {
    if (!entries.length) {
      return;
    }
    snapshot();
    const next = { ...objects.value };
    for (const { pageIndex, obj } of entries) {
      next[pageIndex] = [...(next[pageIndex] ?? []), obj];
    }
    objects.value = next;
  }

  return {
    fileName,
    bytes,
    pdf,
    pageCount,
    currentPage,
    selectedPages,
    zoom,
    version,
    objects,
    selectedObjectId,
    editingObjectId,
    tool,
    pendingImage,
    settings,
    fieldDraft,
    busy,
    progress,
    error,
    notice,
    undoStack,
    redoStack,
    isLoaded,
    pageObjects,
    selectedObject,
    pendingRedactions,
    hasPendingEdits,
    targetPages,
    snapshot,
    load,
    undo,
    redo,
    commit,
    run,
    exportPdf,
    close,
    addObject,
    addObjects,
    updateObject,
    removeObject,
    removeObjectsOfType,
  };
}

export type PdfEditorState = ReturnType<typeof createPdfEditorState>;

export const pdfEditorKey: InjectionKey<PdfEditorState> = Symbol('pdf-editor');

export function usePdfEditor(): PdfEditorState {
  const state = inject(pdfEditorKey);
  if (!state) {
    throw new Error('usePdfEditor must be used inside the PDF editor');
  }
  return state;
}

let idCounter = 0;
export function newObjectId() {
  idCounter++;
  return `obj-${Date.now().toString(36)}-${idCounter}`;
}
