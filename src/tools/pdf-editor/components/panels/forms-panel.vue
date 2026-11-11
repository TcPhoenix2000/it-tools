<script setup lang="ts">
import { usePdfEditor } from '../../pdf-editor.store';
import { type FormFieldInfo, fillFormFields, flattenForm, listFormFields, loadPdfLib } from '../../services/pdf-document.service';
import type { FormFieldType } from '../../pdf-editor.types';

const state = usePdfEditor();
const { bytes, version, tool, settings, fieldDraft } = state;

const fields = ref<FormFieldInfo[]>([]);
const values = ref<Record<string, string | boolean | string[]>>({});
const flattenOnApply = ref(false);
const loadError = ref('');

watch(version, async () => {
  loadError.value = '';
  if (!bytes.value) {
    fields.value = [];
    return;
  }
  try {
    fields.value = listFormFields(await loadPdfLib(bytes.value));
    values.value = Object.fromEntries(fields.value.map(f => [f.name, f.value]));
  }
  catch (e: any) {
    fields.value = [];
    loadError.value = e?.message ?? String(e);
  }
}, { immediate: true });

const editable = computed(() => fields.value.filter(f => f.type !== 'other'));

async function apply() {
  const v = { ...values.value };
  const flatten = flattenOnApply.value;
  await state.run(flatten ? 'Filling and flattening form' : 'Filling form', b => fillFormFields(b, v, flatten));
}

async function flatten() {
  await state.run('Flattening form', b => flattenForm(b));
}

const fieldTypes: { label: string; value: FormFieldType }[] = [
  { label: 'Text box', value: 'text' },
  { label: 'Multi-line text', value: 'multiline' },
  { label: 'Checkbox', value: 'checkbox' },
  { label: 'Radio button', value: 'radio' },
  { label: 'Dropdown', value: 'dropdown' },
  { label: 'List box', value: 'listbox' },
];

const needsOptions = computed(() => ['dropdown', 'listbox', 'radio'].includes(settings.fieldType));

function startPlacing() {
  tool.value = 'field';
  state.notice.value = 'Drag on the page to place the field. Fields are written into the PDF when you download it.';
}
</script>

<template>
  <div class="panel-body">
    <h4>Fill in form</h4>
    <p v-if="loadError" class="hint">
      {{ loadError }}
    </p>
    <p v-else-if="!editable.length" class="hint">
      This document has no fillable fields. Create some below.
    </p>
    <template v-else>
      <div v-for="f in editable" :key="f.name" class="field-row">
        <label :title="f.name">{{ f.name }}<span v-if="f.readOnly"> (read-only)</span></label>
        <n-checkbox v-if="f.type === 'checkbox'" :checked="values[f.name] as boolean" :disabled="f.readOnly" @update:checked="(v: boolean) => (values[f.name] = v)" />
        <n-select
          v-else-if="f.type === 'radio' || f.type === 'dropdown'"
          :value="values[f.name] as string" size="small"
          :disabled="f.readOnly"
          :options="f.options.map(o => ({ label: o, value: o }))"
          @update:value="(v: string) => (values[f.name] = v)"
        />
        <n-select
          v-else-if="f.type === 'listbox'"
          :value="values[f.name] as string[]" size="small"
          multiple
          :disabled="f.readOnly"
          :options="f.options.map(o => ({ label: o, value: o }))"
          @update:value="(v: string[]) => (values[f.name] = v)"
        />
        <n-input
          v-else
          :value="values[f.name] as string" size="small"
          :disabled="f.readOnly"
          :type="f.multiline ? 'textarea' : 'text'"
          @update:value="(v: string) => (values[f.name] = v)"
        />
      </div>
      <n-checkbox v-model:checked="flattenOnApply">
        Flatten after filling (fields become regular, non-editable content)
      </n-checkbox>
      <div flex gap-2>
        <c-button size="small" type="primary" @click="apply">
          Apply values
        </c-button>
        <c-button size="small" @click="flatten">
          Flatten form
        </c-button>
      </div>
    </template>

    <h4>Create fields</h4>
    <div class="row">
      <label>Type</label>
      <n-select v-model:value="settings.fieldType" size="small" :options="fieldTypes" data-test-id="field-type" />
    </div>
    <div class="row">
      <label>Name</label>
      <n-input v-model:value="fieldDraft.name" size="small" :placeholder="settings.fieldType === 'radio' ? 'Group name (shared by the buttons)' : 'Field name'" />
    </div>
    <div v-if="needsOptions" class="row">
      <label>{{ settings.fieldType === 'radio' ? 'Value' : 'Options' }}</label>
      <n-input v-model:value="fieldDraft.options" size="small" :placeholder="settings.fieldType === 'radio' ? 'Value of this button' : 'Comma separated'" />
    </div>
    <div class="row">
      <label>Default</label>
      <n-input v-if="settings.fieldType !== 'checkbox' && settings.fieldType !== 'radio'" v-model:value="fieldDraft.defaultValue" size="small" placeholder="Default value (optional)" />
      <n-checkbox v-else :checked="fieldDraft.defaultValue === 'true'" @update:checked="(v: boolean) => (fieldDraft.defaultValue = v ? 'true' : '')">
        Checked by default
      </n-checkbox>
    </div>
    <div class="row">
      <n-checkbox v-model:checked="fieldDraft.required">
        Required
      </n-checkbox>
      <n-input-number v-model:value="settings.fontSize" size="small" :min="0" :max="72" style="width: 100px">
        <template #suffix>
          pt
        </template>
      </n-input-number>
    </div>
    <c-button size="small" :type="tool === 'field' ? 'primary' : 'default'" data-test-id="place-field" @click="startPlacing">
      <icon-mdi-form-select mr-1 /> Draw field on page
    </c-button>
    <p class="hint">
      For a radio group, place one button per choice with the same name and a different value.
    </p>
  </div>
</template>

<style lang="less" scoped>
@import './panel.less';

.field-row {
  display: grid;
  grid-template-columns: 110px 1fr;
  align-items: center;
  gap: 8px;

  label {
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
