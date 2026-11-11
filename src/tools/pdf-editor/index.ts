import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';
import FilePdfIcon from '~icons/mdi/file-pdf-box';

export const tool = defineTool({
  name: translate('tools.pdf-editor.title'),
  path: '/pdf-editor',
  description: translate('tools.pdf-editor.description'),
  keywords: [
    'pdf',
    'editor',
    'edit',
    'merge',
    'split',
    'rotate',
    'annotate',
    'highlight',
    'sign',
    'signature',
    'form',
    'fill',
    'redact',
    'password',
    'protect',
    'encrypt',
    'compress',
    'ocr',
    'compare',
    'watermark',
    'acrobat',
  ],
  component: () => import('./pdf-editor.vue'),
  icon: FilePdfIcon,
  createdAt: new Date('2026-11-11'),
});
