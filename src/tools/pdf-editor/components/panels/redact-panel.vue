<script setup lang="ts">
import { newObjectId, usePdfEditor } from '../../pdf-editor.store';
import { type SearchMatch, searchText } from '../../services/pdf-render.service';
import { applyRedactions } from '../../services/pdf-redact.service';
import { redactionsOf } from '../../services/pdf-objects.service';
import { sanitizePdf } from '../../services/pdf-document.service';

const state = usePdfEditor();
const { tool, pdf, objects, pendingRedactions, currentPage } = state;

const query = ref('');
const regex = ref(false);
const caseSensitive = ref(false);
const matches = ref<SearchMatch[]>([]);
const searched = ref(false);

const presets = [
  { label: 'Email addresses', pattern: '[\\w.+-]+@[\\w-]+\\.[\\w.-]+' },
  { label: 'Phone numbers', pattern: '\\+?\\d[\\d ()./-]{7,}\\d' },
  { label: 'IBAN numbers', pattern: '[A-Z]{2}\\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?' },
  { label: 'Credit card numbers', pattern: '\\b(?:\\d[ -]?){13,16}\\b' },
  { label: 'Belgian national numbers', pattern: '\\b\\d{2}[.]?\\d{2}[.]?\\d{2}[-]?\\d{3}[.]?\\d{2}\\b' },
];

function usePreset(pattern: string) {
  query.value = pattern;
  regex.value = true;
  search();
}

async function search() {
  if (!pdf.value) {
    return;
  }
  try {
    matches.value = await searchText(pdf.value, query.value, { regex: regex.value, caseSensitive: caseSensitive.value });
    searched.value = true;
    state.error.value = null;
  }
  catch (e: any) {
    state.error.value = `Invalid search: ${e.message}`;
  }
}

function markAll() {
  state.addObjects(matches.value.map(m => ({
    pageIndex: m.pageIndex,
    obj: { id: newObjectId(), type: 'redact' as const, x: m.x - 1, y: m.y - 1, w: m.w + 2, h: m.h + 2 },
  })));
  state.notice.value = `${matches.value.length} area(s) marked for redaction. Review them, then click "Apply redactions".`;
  matches.value = [];
}

const sanitize = ref(true);
const ocrAfter = ref(false);

async function apply() {
  const redactions = redactionsOf(objects.value);
  const pages = Object.keys(redactions).map(Number);
  const doSanitize = sanitize.value;
  await state.run('Applying redactions', async (b) => {
    let out = await applyRedactions(b, redactions);
    if (doSanitize) {
      out = (await sanitizePdf(out)).bytes;
    }
    if (ocrAfter.value) {
      const { ocrPdf } = await import('../../services/pdf-ocr.service');
      out = (await ocrPdf(out, { language: 'eng+nld', skipPagesWithText: false, pages }, p => (state.progress.value = (p.page - 1 + p.progress) / p.total))).bytes;
    }
    return out;
  });
  if (!state.error.value) {
    // the redaction boxes are now burned into the pages
    const remaining = { ...objects.value };
    for (const page of pages) {
      remaining[page] = (remaining[page] ?? []).filter(o => o.type !== 'redact');
    }
    objects.value = remaining;
    state.notice.value = `Redacted ${pages.length} page(s). The removed content is gone from the file.`;
  }
}

function goTo(m: SearchMatch) {
  currentPage.value = m.pageIndex;
}
</script>

<template>
  <div class="panel-body">
    <h4>Mark for redaction</h4>
    <c-button size="small" :type="tool === 'redact' ? 'primary' : 'default'" data-test-id="tool-redact" @click="tool = 'redact'">
      <icon-mdi-marker-cancel mr-1 /> Draw redaction boxes
    </c-button>

    <h4>Search &amp; redact</h4>
    <div class="row">
      <n-input v-model:value="query" size="small" placeholder="Text or pattern to find" @keyup.enter="search" />
      <c-button size="small" @click="search">
        Find
      </c-button>
    </div>
    <div class="row">
      <n-checkbox v-model:checked="caseSensitive" size="small">
        Match case
      </n-checkbox>
      <n-checkbox v-model:checked="regex" size="small">
        Regular expression
      </n-checkbox>
    </div>
    <div flex flex-wrap gap-1>
      <c-button v-for="p in presets" :key="p.label" size="small" variant="text" @click="usePreset(p.pattern)">
        {{ p.label }}
      </c-button>
    </div>
    <template v-if="searched">
      <p class="hint">
        {{ matches.length }} match(es) found.
      </p>
      <div v-if="matches.length" class="matches">
        <div v-for="(m, i) in matches.slice(0, 200)" :key="i" class="match" @click="goTo(m)">
          <b>p{{ m.pageIndex + 1 }}</b> {{ m.context }}
        </div>
      </div>
      <c-button v-if="matches.length" size="small" type="warning" @click="markAll">
        Mark all {{ matches.length }} for redaction
      </c-button>
    </template>

    <h4>Apply</h4>
    <p class="hint">
      {{ pendingRedactions }} area(s) marked. Applying removes everything under the boxes for good: affected pages are
      re-rendered as images, so hidden text cannot be recovered by copy &amp; paste.
    </p>
    <n-checkbox v-model:checked="sanitize">
      Also remove metadata, JavaScript and attachments
    </n-checkbox>
    <n-checkbox v-model:checked="ocrAfter">
      Run OCR on redacted pages (keeps them searchable)
    </n-checkbox>
    <div flex gap-2>
      <c-button size="small" type="error" :disabled="!pendingRedactions" data-test-id="apply-redactions" @click="apply">
        Apply redactions
      </c-button>
      <c-button size="small" :disabled="!pendingRedactions" @click="state.removeObjectsOfType('redact')">
        Clear marks
      </c-button>
    </div>
  </div>
</template>

<style lang="less" scoped>
@import './panel.less';

.matches {
  max-height: 180px;
  overflow-y: auto;
  font-size: 12px;
  border: 1px solid rgba(127, 127, 127, 0.2);
  border-radius: 4px;
}

.match {
  padding: 3px 6px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  &:hover {
    background: rgba(127, 127, 127, 0.1);
  }
}
</style>
