/**
 * Ensures CapacitorWebView keeps reporting VISIBLE while media plays in background.
 * Safe to re-run (idempotent). Invoked from npm postinstall / android:apk.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = path.join(
  root,
  'node_modules',
  '@capacitor',
  'android',
  'capacitor',
  'src',
  'main',
  'java',
  'com',
  'getcapacitor',
  'CapacitorWebView.java'
)

if (!fs.existsSync(target)) {
  console.warn('[patch-capacitor-webview] CapacitorWebView.java not found — skip')
  process.exit(0)
}

let src = fs.readFileSync(target, 'utf8')
if (src.includes('allowBackgroundMedia')) {
  console.log('[patch-capacitor-webview] already applied')
  process.exit(0)
}

if (!src.includes('import android.view.KeyEvent;')) {
  console.error('[patch-capacitor-webview] unexpected CapacitorWebView.java format')
  process.exit(1)
}

src = src.replace(
  'import android.view.KeyEvent;\n',
  'import android.view.KeyEvent;\nimport android.view.View;\n'
)

const marker = 'public class CapacitorWebView extends WebView {\n'
const insert = `public class CapacitorWebView extends WebView {

    /**
     * When true, keep reporting the WebView as VISIBLE even if the Activity is
     * backgrounded / screen-off. Required for HTML5 video/audio to keep
     * decoding while SafeTube media playback is active.
     */
    public static volatile boolean allowBackgroundMedia = false;
`

if (!src.includes(marker)) {
  console.error('[patch-capacitor-webview] class declaration not found')
  process.exit(1)
}
src = src.replace(marker, insert)

const method = `
    @Override
    public void dispatchWindowVisibilityChanged(int visibility) {
        if (allowBackgroundMedia) {
            // Trick WebView into thinking it is still on-screen so media is not suspended.
            super.onWindowVisibilityChanged(View.VISIBLE);
            return;
        }
        super.dispatchWindowVisibilityChanged(visibility);
    }
`

const afterSetBridge = `public void setBridge(Bridge bridge) {
        this.bridge = bridge;
    }
`
if (!src.includes(afterSetBridge)) {
  console.error('[patch-capacitor-webview] setBridge() not found')
  process.exit(1)
}
src = src.replace(afterSetBridge, afterSetBridge + method)

fs.writeFileSync(target, src)
console.log('[patch-capacitor-webview] applied background-media WebView patch')
