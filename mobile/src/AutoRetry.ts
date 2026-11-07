/** Only read/idempotent operations use this helper. Permission dialogs and
 * notifications are never repeated automatically. No diagnostics reach UI. */
export async function autoRetry<T>(operation: () => Promise<T>, alive: () => boolean = () => true): Promise<T> {
  let failure: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!alive()) throw new Error('Canceled')
    try {
      return await operation()
    } catch (error) {
      failure = error
      if (!alive() || /401|403|forbidden|unauthori|permission|授权|登录失效/i.test(String(error))) break
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, [450, 1200][attempt]))
    }
  }
  throw failure
}
