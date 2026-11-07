export async function settleSettings(page){
  await page.evaluate(async()=>{
    await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)
    await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))
  })
}
export async function settingsRoot(page){
  for(let depth=0;depth<5&&await page.getByRole('button',{name:'返回上一级',exact:true}).count();depth++){
    await page.getByRole('button',{name:'返回上一级',exact:true}).click();await settleSettings(page)
  }
}
export async function enableReminders(page){
  await settingsRoot(page)
  const enabled=page.getByRole('switch',{name:/开启日程提醒/})
  if(!await enabled.isChecked()){
    await enabled.click()
    // These are controlled inputs; a delayed native save acknowledges the value.
    await page.waitForFunction(()=>{const input=document.querySelector('.settings-sheet input[role=switch]');return input?.checked&&!input.disabled})
  }
  await page.locator('.settings-sheet [data-settings-page=categories]').waitFor({state:'visible'})
  await settleSettings(page)
}
export async function reminderCategory(page,kind='course'){
  await enableReminders(page)
  await page.locator('.settings-sheet [data-settings-page=categories]').click();await settleSettings(page)
  await page.locator('.settings-sheet [data-settings-page=category-'+kind+']').click();await settleSettings(page)
}
export async function allDaySettings(page){
  await enableReminders(page)
  await page.locator('.settings-sheet [data-settings-page=categories]').click();await settleSettings(page)
  await page.locator('.settings-sheet [data-settings-page=all-day]').click();await settleSettings(page)
}
export async function syncSettings(page){
  await settingsRoot(page);await page.locator('.settings-sheet [data-settings-page=sync]').click();await settleSettings(page)
}
