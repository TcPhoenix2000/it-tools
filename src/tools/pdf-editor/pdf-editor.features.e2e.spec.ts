import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { expect, test } from '@playwright/test';

// End-to-end check of the heavy features (redaction, compression, OCR, signature pad).
// Also run it against the production build behind the nginx headers: it fails on any CSP violation.
test.setTimeout(300000);

test('PDF features under the production CSP', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', m => /Content Security Policy|Refused to/i.test(m.text()) && violations.push(m.text()));
  page.on('pageerror', e => violations.push(`pageerror: ${e.message}`));
  await page.goto('/pdf-editor');

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([595, 842]).drawText('Invoice for jane.doe@example.com', { x: 50, y: 760, size: 28, font });
  await page.locator('input[type=file]').first().setInputFiles({ name: 'csp.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.getByTestId('page-indicator')).toHaveText('1 / 1');

  const tab = (name: string) => page.locator('.n-tabs-tab', { hasText: name }).click();
  const find = async (text: string) => {
    await tab('Redact');
    await page.getByPlaceholder('Text or pattern to find').fill(text);
    await page.getByRole('button', { name: 'Find' }).click();
  };

  // redaction: the text is really gone afterwards
  await find('jane.doe@example.com');
  await expect(page.getByText('1 match(es) found.')).toBeVisible();
  await page.getByRole('button', { name: /mark all/i }).click();
  await page.getByTestId('apply-redactions').click();
  await expect(page.getByTestId('page-indicator')).toBeVisible();
  await page.waitForTimeout(3000);
  await find('jane.doe');
  await expect(page.getByText('0 match(es) found.')).toBeVisible({ timeout: 30000 });

  // compression at maximum (rasterizes the page)
  await tab('Optimize');
  await page.locator('.n-radio-button', { hasText: /max/i }).click();
  await page.getByTestId('compress').click();
  await page.waitForTimeout(5000);

  // OCR brings searchable text back
  await tab('OCR');
  await page.getByTestId('run-ocr').click();
  await expect(async () => {
    await find('Invoice');
    await expect(page.getByText('1 match(es) found.')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 180000, intervals: [5000] });

  // signature dialog opens and shows its drawing canvas
  await tab('Sign');
  await page.getByTestId('create-signature').click();
  await expect(page.locator('canvas.pad')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('download-pdf').click();
  const saved = await readFile(await (await downloadPromise).path());
  expect(saved.toString('latin1')).not.toContain('jane.doe');

  expect(violations).toEqual([]);
});
