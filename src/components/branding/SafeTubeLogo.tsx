type Props = {
  className?: string
}

/** Horizontal SafeTube wordmark (PNG with alpha). */
export function SafeTubeLogo({ className = 'mx-auto h-14 w-auto max-w-[min(100%,320px)]' }: Props) {
  return <img src="/logo.png" alt="SafeTube" className={className} width={560} height={160} decoding="async" />
}
