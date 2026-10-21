export async function chooseProjectDisk(page) {
  const dialog = page.locator('.task-access-dialog');
  if (!(await dialog.isVisible())) await page.getByRole('button', { name: 'Доступ к проектам', exact: true }).click();
  await dialog.getByRole('button', { name: 'Выбрать диск с проектами', exact: true }).click();
  await dialog.getByRole('button', { name: 'Продолжить', exact: true }).click();
}
