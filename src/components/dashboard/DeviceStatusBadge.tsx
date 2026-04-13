import { Badge } from '../ui/Badge'

export function DeviceStatusBadge({ isOnline, isBlocked }: { isOnline: boolean; isBlocked: boolean }) {
  if (isBlocked) return <Badge variant="danger">חסום</Badge>
  if (isOnline) return <Badge variant="success">מחובר</Badge>
  return <Badge variant="neutral">לא מקוון</Badge>
}
