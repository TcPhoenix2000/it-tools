<script setup lang="ts">
import { newObjectId, usePdfEditor } from '../../pdf-editor.store';
import PdfSignatureDialog from '../pdf-signature-dialog.vue';

const state = usePdfEditor();
const { pendingImage, tool, currentPage, settings } = state;

const dialog = ref<{ show: boolean; mode: 'signature' | 'initials' }>({ show: false, mode: 'signature' });

function open(mode: 'signature' | 'initials') {
  dialog.value = { show: true, mode };
}

function onCreated(image: { dataUrl: string; width: number; height: number }) {
  pendingImage.value = image;
  tool.value = 'image';
  state.notice.value = 'Click on the page where the signature should go. Drag the corners to resize it.';
}

const dateFormat = ref<'locale' | 'iso'>('locale');
function addDate() {
  const now = new Date();
  const text = dateFormat.value === 'iso' ? now.toISOString().slice(0, 10) : now.toLocaleDateString();
  state.addObject(currentPage.value, {
    id: newObjectId(),
    type: 'text',
    x: 60,
    y: 60,
    w: text.length * settings.fontSize * 0.6 + 6,
    h: settings.fontSize * 1.2 + 2,
    text,
    fontSize: settings.fontSize,
    font: settings.font,
    bold: false,
    italic: false,
    color: settings.color,
    background: null,
  });
  tool.value = 'select';
  state.notice.value = 'Date added at the top left of the page: drag it into place.';
}
</script>

<template>
  <div class="panel-body">
    <h4>Fill &amp; sign</h4>
    <p class="hint">
      Create a signature by drawing, typing or uploading an image, then click the page to place it.
    </p>
    <div class="grid">
      <c-button type="primary" size="small" data-test-id="create-signature" @click="open('signature')">
        <icon-mdi-draw-pen mr-1 /> Signature
      </c-button>
      <c-button size="small" @click="open('initials')">
        <icon-mdi-format-letter-case mr-1 /> Initials
      </c-button>
    </div>
    <div class="row">
      <n-select v-model:value="dateFormat" size="small" :options="[{ label: 'Local date format', value: 'locale' }, { label: 'YYYY-MM-DD', value: 'iso' }]" />
      <c-button size="small" @click="addDate">
        <icon-mdi-calendar mr-1 /> Add date
      </c-button>
    </div>
    <div class="grid">
      <c-button size="small" @click="tool = 'text'">
        <icon-mdi-format-text mr-1 /> Add text
      </c-button>
      <c-button size="small" @click="tool = 'ink'">
        <icon-mdi-check-bold mr-1 /> Draw a mark
      </c-button>
    </div>
    <p v-if="pendingImage" class="hint">
      A signature is ready: click on the page to place it.
    </p>

    <h4>About signatures</h4>
    <p class="hint">
      These are visual (electronic) signatures, like Acrobat's "Fill &amp; Sign". To verify certificate-based digital
      signatures in a PDF, use the PDF signature checker tool.
    </p>

    <PdfSignatureDialog v-model:show="dialog.show" :mode="dialog.mode" @created="onCreated" />
  </div>
</template>

<style lang="less" scoped>
@import './panel.less';
</style>
