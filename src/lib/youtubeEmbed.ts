/** Embed מוגבל ל־nocookie — ללא ניווט ל־YouTube המלא */
export function buildSafeEmbedUrl(videoId: string) {
  const params = new URLSearchParams({
    autoplay: '0',
    controls: '1',
    rel: '0',
    modestbranding: '1',
    iv_load_policy: '3',
    fs: '0',
    playsinline: '1',
    disablekb: '0',
  })
  return `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`
}
