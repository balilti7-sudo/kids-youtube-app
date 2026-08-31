const DEFAULT_MUTATION_TIMEOUT_MS = 25_000

/** Fail fast when Supabase/Cloudflare hangs instead of spinning forever. */
export async function withMutationTimeout<T>(
  promise: PromiseLike<T>,
  ms = DEFAULT_MUTATION_TIMEOUT_MS,
  message = 'הפעולה ארכה יותר מדי זמן. בדקו חיבור לאינטרנט ונסו שוב.'
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms)
      }),
    ])
  } finally {
    if (timer != null) clearTimeout(timer)
  }
}
