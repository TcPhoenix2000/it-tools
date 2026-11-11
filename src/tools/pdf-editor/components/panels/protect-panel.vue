<script setup lang="ts">
import { usePdfEditor } from '../../pdf-editor.store';
import { type PdfMetadata, encryptPdf, loadPdfLib, readMetadata, sanitizePdf, writeMetadata } from '../../services/pdf-document.service';
import { baseName, downloadBytes } from '../../services/download';

const state = usePdfEditor();
const { bytes, version, fileName } = state;

// ---- password protection ----
const protection = reactive({
  userPassword: '',
  ownerPassword: '',
  allowPrinting: true,
  allowCopying: false,
  allowModifying: false,
  allowAnnotating: true,
  allowFillingForms: true,
});

async function protect() {
  if (!protection.userPassword && !protection.ownerPassword) {
    state.error.value = 'Set at least one password.';
    return;
  }
  const options = { ...protection };
  await state.run('Encrypting', async (b) => {
    // the editor keeps working on the unprotected copy; only the download is encrypted
    downloadBytes(await encryptPdf(b, options), `${baseName(fileName.value)}-protected.pdf`);
    state.notice.value = options.userPassword
      ? 'Protected copy downloaded: a password is needed to open it.'
      : 'Protected copy downloaded: anyone can open it, but the permissions are restricted.';
  });
}

// ---- metadata ----
const meta = ref<PdfMetadata>({ title: '', author: '', subject: '', keywords: '', creator: '', producer: '' });
watch(version, async () => {
  if (bytes.value) {
    try {
      meta.value = readMetadata(await loadPdfLib(bytes.value));
    }
    catch {
      // unreadable metadata: start with empty fields
    }
  }
}, { immediate: true });

async function saveMetadata() {
  const values = { ...meta.value };
  await state.run('Saving properties', b => writeMetadata(b, values));
}

async function sanitize() {
  let removed: string[] = [];
  await state.run('Removing hidden information', async (b) => {
    const result = await sanitizePdf(b);
    removed = result.removed;
    return result.bytes;
  });
  if (!state.error.value) {
    state.notice.value = removed.length ? `Removed: ${removed.join(', ')}.` : 'No hidden information found.';
  }
}
</script>

<template>
  <div class="panel-body">
    <h4>Password protection</h4>
    <n-input v-model:value="protection.userPassword" size="small" type="password" show-password-on="click" placeholder="Password to open (optional)" :input-props="{ autocomplete: 'new-password' }" />
    <n-input v-model:value="protection.ownerPassword" size="small" type="password" show-password-on="click" placeholder="Permissions password" :input-props="{ autocomplete: 'new-password' }" />
    <n-checkbox v-model:checked="protection.allowPrinting">
      Allow printing
    </n-checkbox>
    <n-checkbox v-model:checked="protection.allowCopying">
      Allow copying text and images
    </n-checkbox>
    <n-checkbox v-model:checked="protection.allowModifying">
      Allow editing and page changes
    </n-checkbox>
    <n-checkbox v-model:checked="protection.allowAnnotating">
      Allow comments
    </n-checkbox>
    <n-checkbox v-model:checked="protection.allowFillingForms">
      Allow filling forms
    </n-checkbox>
    <c-button size="small" type="primary" data-test-id="protect" @click="protect">
      <icon-mdi-lock-outline mr-1 /> Download protected copy
    </c-button>
    <p class="hint">
      Encrypted with AES. Permission restrictions are honoured by compliant viewers, but are not a strong barrier on their own:
      use a password to open for real confidentiality. To remove a password, open the file here and enter it.
    </p>

    <h4>Document properties</h4>
    <n-input v-model:value="meta.title" size="small" placeholder="Title" />
    <n-input v-model:value="meta.author" size="small" placeholder="Author" />
    <n-input v-model:value="meta.subject" size="small" placeholder="Subject" />
    <n-input v-model:value="meta.keywords" size="small" placeholder="Keywords (comma separated)" />
    <div class="row">
      <n-input v-model:value="meta.creator" size="small" placeholder="Creator" />
      <n-input v-model:value="meta.producer" size="small" placeholder="Producer" />
    </div>
    <c-button size="small" @click="saveMetadata">
      Save properties
    </c-button>

    <h4>Remove hidden information</h4>
    <p class="hint">
      Strips document properties, XMP metadata, JavaScript, auto-run actions and embedded attachments.
    </p>
    <c-button size="small" @click="sanitize">
      <icon-mdi-broom mr-1 /> Sanitize document
    </c-button>
  </div>
</template>

<style lang="less" scoped>
@import './panel.less';
</style>
