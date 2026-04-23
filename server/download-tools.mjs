/**
 * Downloads yt-dlp (and on Windows, ffmpeg) next to this file so the Media Bridge
 * does not rely on PATH.
 */
import { createWriteStream, mkdirSync, readdirSync, copyFileSync, rmSync, chmodSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SERVER_ROOT = path.dirname(fileURLToPath(import.meta.url))

async function downloadFile(url, dest) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) {
    throw new Error(`GET ${url} → ${res.status} ${res.statusText}`)
  }
  await pipeline(res.body, createWriteStream(dest))
}

function findFileRecursive(dir, baseName) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      const f = findFileRecursive(p, baseName)
      if (f) return f
    } else if (ent.name === baseName) {
      return p
    }
  }
  return null
}

async function expandZipWindows(zipPath, destDir) {
  await new Promise((resolve, reject) => {
    const cmd = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`
    const ps = spawn('powershell', ['-NoProfile', '-Command', cmd], { stdio: 'inherit' })
    ps.on('error', reject)
    ps.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Expand-Archive exited ${code}`))))
  })
}

async function main() {
  const ytDlpRelease = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download'
  if (process.platform === 'win32') {
    const dest = path.join(SERVER_ROOT, 'yt-dlp.exe')
    console.log('Downloading yt-dlp.exe …')
    await downloadFile(`${ytDlpRelease}/yt-dlp.exe`, dest)
    console.log('Wrote', dest)
  } else {
    const dest = path.join(SERVER_ROOT, 'yt-dlp')
    console.log('Downloading yt-dlp …')
    await downloadFile(`${ytDlpRelease}/yt-dlp`, dest)
    chmodSync(dest, 0o755)
    console.log('Wrote', dest)
  }

  if (process.platform !== 'win32') {
    console.log('Skipping ffmpeg auto-download on non-Windows; install ffmpeg via your OS package manager if yt-dlp needs it.')
    return
  }

  const zipPath = path.join(SERVER_ROOT, '.ffmpeg-download.zip')
  const extractDir = path.join(SERVER_ROOT, '.ffmpeg-extract')
  const ffmpegUrl =
    'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'

  console.log('Downloading ffmpeg (win64) …')
  await downloadFile(ffmpegUrl, zipPath)
  rmSync(extractDir, { recursive: true, force: true })
  mkdirSync(extractDir, { recursive: true })
  await expandZipWindows(zipPath, extractDir)

  const found = findFileRecursive(extractDir, 'ffmpeg.exe')
  if (!found) {
    throw new Error('ffmpeg.exe not found inside archive')
  }
  const outExe = path.join(SERVER_ROOT, 'ffmpeg.exe')
  copyFileSync(found, outExe)
  rmSync(zipPath, { force: true })
  rmSync(extractDir, { recursive: true, force: true })
  console.log('Wrote', outExe)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
