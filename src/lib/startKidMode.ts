import { supabase } from './supabase'
import { saveChildAccessToken } from './childDevice'

/**
 * Start kid watching on this device for a parent-owned child profile
 * by storing that profile's child_access_token in localStorage.
 */
export async function startKidModeForProfile(
  deviceId: string
): Promise<{ accessToken: string | null; error: Error | null }> {
  const id = deviceId.trim()
  if (!id) return { accessToken: null, error: new Error('Missing device id') }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  if (sessionError) return { accessToken: null, error: new Error(sessionError.message) }
  const userId = sessionData.session?.user?.id
  if (!userId) return { accessToken: null, error: new Error('יש להתחבר כהורה כדי להפעיל מצב ילד') }

  const { data, error } = await supabase
    .from('devices')
    .select('child_access_token')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) return { accessToken: null, error: new Error(error.message) }
  const token = (data as { child_access_token?: string | null } | null)?.child_access_token?.trim()
  if (!token) {
    return { accessToken: null, error: new Error('לא נמצא טוקן ילד לפרופיל זה') }
  }

  saveChildAccessToken(token)
  return { accessToken: token, error: null }
}
