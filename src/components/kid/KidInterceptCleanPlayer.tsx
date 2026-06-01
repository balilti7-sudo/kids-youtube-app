import { CleanPlayer, type CleanPlayerProps } from '../player/CleanPlayer'

/** Educational breaks disabled — plain player only. */
export function KidInterceptCleanPlayer(props: CleanPlayerProps) {
  return <CleanPlayer {...props} />
}
