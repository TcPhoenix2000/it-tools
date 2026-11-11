import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { expect, test } from '@playwright/test';

async function samplePdf(pages: number) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    doc.addPage([595, 842]).drawText(`Original page ${i + 1} contact: jane.doe@example.com`, { x: 50, y: 780, size: 14, font });
  }
  return Buffer.from(await doc.save());
}

test.describe('Tool - PDF editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/pdf-editor');
  });

  test('Has correct title', async ({ page }) => {
    await expect(page).toHaveTitle('PDF editor - IT Tools');
  });

  test('opens a PDF, adds text, downloads, and the text is in the saved file', async ({ page }) => {
    await page.locator('input[type=file]').first().setInputFiles({ name: 'sample.pdf', mimeType: 'application/pdf', buffer: await samplePdf(2) });
    await expect(page.getByTestId('page-indicator')).toHaveText('1 / 2');

    await page.getByTestId('tool-text').click();
    const layer = page.getByTestId('pdf-layer');
    await layer.click({ position: { x: 100, y: 200 } });
    await page.keyboard.type('Added by e2e');
    await layer.click({ position: { x: 400, y: 600 } });

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('download-pdf').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('sample.pdf');
    const saved = await readFile(await download.path());
    expect((await PDFDocument.load(saved)).getPageCount()).toBe(2);

    // re-open the saved file and find the added text with the editor's own search
    await page.getByLabel('Close').click();
    await page.locator('input[type=file]').first().setInputFiles({ name: 'saved.pdf', mimeType: 'application/pdf', buffer: saved });
    await page.locator('.n-tabs-tab', { hasText: 'Redact' }).click();
    await page.getByPlaceholder('Text or pattern to find').fill('Added by e2e');
    await page.getByRole('button', { name: 'Find' }).click();
    await expect(page.getByText('1 match(es) found.')).toBeVisible();
  });

  test('organizes pages: delete, blank page and undo', async ({ page }) => {
    await page.locator('input[type=file]').first().setInputFiles({ name: 'sample.pdf', mimeType: 'application/pdf', buffer: await samplePdf(3) });
    await expect(page.getByTestId('page-indicator')).toHaveText('1 / 3');
    await page.locator('.n-tabs-tab', { hasText: 'Organize' }).click();
    await page.getByRole('button', { name: 'Blank page' }).click();
    await expect(page.getByTestId('page-indicator')).toHaveText('2 / 4');
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByTestId('page-indicator')).toContainText('/ 3');
    await page.getByLabel('Undo').click();
    await expect(page.getByTestId('page-indicator')).toContainText('/ 4');
  });

  test('creates a form field and downloads a protected copy', async ({ page }) => {
    await page.locator('input[type=file]').first().setInputFiles({ name: 'form.pdf', mimeType: 'application/pdf', buffer: await samplePdf(1) });
    await page.locator('.n-tabs-tab', { hasText: 'Forms' }).click();
    await page.getByTestId('place-field').click();
    await expect(page.getByText('Drag on the page to place the field')).toBeVisible();
    const layer = page.getByTestId('pdf-layer');
    const box = (await layer.boundingBox())!;
    await page.mouse.move(box.x + 60, box.y + 120);
    await page.mouse.down();
    await page.mouse.move(box.x + 260, box.y + 145, { steps: 5 });
    await page.mouse.up();

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('download-pdf').click();
    const saved = await readFile(await (await downloadPromise).path());
    const fields = (await PDFDocument.load(saved)).getForm().getFields().map(f => f.getName());
    expect(fields).toEqual(['field']);

    await page.locator('.n-tabs-tab', { hasText: 'Protect' }).click();
    await page.getByPlaceholder('Password to open (optional)').fill('secret');
    const protectedPromise = page.waitForEvent('download');
    await page.getByTestId('protect').click();
    const protectedBytes = await readFile(await (await protectedPromise).path());
    expect(protectedBytes.toString('latin1')).toContain('/Encrypt');
  });

  test('opens a password-protected PDF after entering the password', async ({ page }) => {
    const doc = await PDFDocument.load(await samplePdf(1));
    (doc as any).encrypt({ userPassword: 'pw123', ownerPassword: 'owner' });
    const encrypted = Buffer.from(await doc.save({ useObjectStreams: false }));
    await page.locator('input[type=file]').first().setInputFiles({ name: 'locked.pdf', mimeType: 'application/pdf', buffer: encrypted });
    await expect(page.getByText('Password required')).toBeVisible();
    await page.getByPlaceholder('Password').fill('wrong');
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByText('Incorrect password.')).toBeVisible();
    await page.getByPlaceholder('Password').fill('pw123');
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByTestId('page-indicator')).toHaveText('1 / 1', { timeout: 15000 });
  });
});
