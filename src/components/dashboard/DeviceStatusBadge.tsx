import { Badge } from '../ui/Badge'

export function DeviceStatusBadge({ isBlocked }: { isBlocked: boolean }) {
  if (isBlocked) return <Badge variant="danger">חסום</Badge>
  return null
}
