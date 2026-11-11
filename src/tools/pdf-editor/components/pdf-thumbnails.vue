<script setup lang="ts">
import draggable from 'vuedraggable';
import { usePdfEditor } from '../pdf-editor.store';
import { renderThumbnail } from '../services/pdf-render.service';
import { arrangePages, rotatePages } from '../services/pdf-document.service';

const state = usePdfEditor();
const { pdf, pageCount, currentPage, selectedPages, version, objects } = state;

interface Thumb { index: number; src: string | null }
const thumbs = ref<Thumb[]>([]);
let generation = 0;

async function renderAll() {
  const doc = pdf.value;
  const current = ++generation;
  thumbs.value = Array.from({ length: pageCount.value }, (_, index) => ({ index, src: null }));
  if (!doc) {
    return;
  }
  for (let i = 0; i < doc.numPages; i++) {
    // render around the current page first so large documents feel responsive
    const src = await renderThumbnail(doc, i).catch(() => null);
    if (current !== generation) {
      return;
    }
    thumbs.value[i] = { index: i, src };
  }
}

watch(version, renderAll, { immediate: true });

function onClick(index: number, event: MouseEvent) {
  if (event.ctrlKey || event.metaKey) {
    selectedPages.value = selectedPages.value.includes(index)
      ? selectedPages.value.filter(i => i !== index)
      : [...selectedPages.value, index];
  }
  else if (event.shiftKey) {
    const [from, to] = [Math.min(currentPage.value, index), Math.max(currentPage.value, index)];
    selectedPages.value = Array.from({ length: to - from + 1 }, (_, k) => from + k);
  }
  else {
    selectedPages.value = [];
  }
  currentPage.value = index;
  state.selectedObjectId.value = null;
}

async function onReorder() {
  const order = thumbs.value.map(t => t.index);
  if (order.every((v, i) => v === i)) {
    return;
  }
  const target = order.indexOf(currentPage.value);
  await state.run('Reordering pages', bytes => arrangePages(bytes, order), { changesPages: true });
  currentPage.value = Math.max(0, target);
  selectedPages.value = [];
}

async function rotate(index: number, delta: number) {
  await state.run('Rotating', bytes => rotatePages(bytes, [index], delta), { changesPages: true });
}

async function remove(index: number) {
  if (pageCount.value <= 1) {
    state.error.value = 'A PDF must keep at least one page.';
    return;
  }
  const order = Array.from({ length: pageCount.value }, (_, i) => i).filter(i => i !== index);
  await state.run('Deleting page', bytes => arrangePages(bytes, order), { changesPages: true });
}

const editedPages = computed(() => new Set(Object.entries(objects.value).filter(([, l]) => l.length).map(([p]) => Number(p))));
</script>

<template>
  <draggable v-model="thumbs" item-key="index" class="thumbs" :animation="150" @end="onReorder">
    <template #item="{ element, index }">
      <div
        class="thumb"
        :class="{ current: index === currentPage, selected: selectedPages.includes(index) }"
        :data-test-id="`thumb-${index}`"
        @click="onClick(index, $event)"
      >
        <img v-if="element.src" :src="element.src" :alt="`Page ${index + 1}`" draggable="false">
        <div v-else class="placeholder" />
        <div class="meta">
          <span>{{ index + 1 }}</span>
          <span v-if="editedPages.has(element.index)" class="dot" title="Unsaved edits on this page" />
          <span class="actions">
            <c-tooltip tooltip="Rotate left"><icon-mdi-rotate-left @click.stop="rotate(index, -90)" /></c-tooltip>
            <c-tooltip tooltip="Rotate right"><icon-mdi-rotate-right @click.stop="rotate(index, 90)" /></c-tooltip>
            <c-tooltip tooltip="Delete page"><icon-mdi-delete-outline @click.stop="remove(index)" /></c-tooltip>
          </span>
        </div>
      </div>
    </template>
  </draggable>
</template>

<style lang="less" scoped>
.thumbs {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 8px;
}

.thumb {
  border: 2px solid transparent;
  border-radius: 4px;
  padding: 4px;
  cursor: pointer;
  background: rgba(127, 127, 127, 0.06);

  img {
    width: 100%;
    display: block;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
    background: #fff;
  }

  .placeholder {
    width: 100%;
    aspect-ratio: 0.707;
    background: rgba(127, 127, 127, 0.15);
  }

  &.selected {
    border-color: rgba(24, 160, 88, 0.5);
  }

  &.current {
    border-color: #18a058;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    margin-top: 4px;
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #f0a020;
  }

  .actions {
    margin-left: auto;
    display: flex;
    gap: 4px;
    opacity: 0.6;

    svg:hover {
      opacity: 1;
      color: #18a058;
    }
  }
}
</style>
