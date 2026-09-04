/**
 * nano-payload.js
 * ============================================================
 * Universal PTV (Video Note) payload builder untuk WhatsApp bot
 * berbasis Baileys (dan fork-forknya).
 *
 * Author  : Azure Ashiro
 * Community: Lycount
 *
 * Cara kerja:
 * 1. Deteksi apakah versi baileys yang terpasang kemungkinan
 *    mendukung opsi native `ptv: true` pada sendMessage.
 * 2. Kalau didukung → pakai jalur native (paling ringkas & stabil).
 * 3. Kalau tidak (atau gagal saat dicoba) → fallback ke pembuatan
 *    raw message content (videoMessage dengan flag ptv di level
 *    proto), lalu kirim lewat sock.relayMessage.
 *
 * Catatan penting:
 * - Ini BUKAN cara untuk memaksa WhatsApp menerima PTV di tempat
 *   yang secara resmi tidak didukung. Ini hanya lapisan kompatibilitas
 *   supaya kode pemanggil tidak perlu tahu versi baileys apa yang
 *   sedang dipakai.
 * - Fallback tetap bergantung pada fungsi upload media yang disediakan
 *   library (sock.waUploadToServer atau setara). Kalau library benar-benar
 *   tidak punya cara upload media generik, tidak ada yang bisa
 *   nano-payload lakukan — itu batas dari library-nya, bukan dari sini.
 * ============================================================
 */

import fs from 'fs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

/* ------------------------------------------------------------------ */
/* 1. DETEKSI VERSI & DUKUNGAN NATIVE                                  */
/* ------------------------------------------------------------------ */

function getInstalledBaileysVersion() {
    const candidates = [
        '@whiskeysockets/baileys',
        'baileys',
        '@adiwajshing/baileys'
    ]

    for (const name of candidates) {
        try {
            const pkg = require(`${name}/package.json`)
            return { name, version: pkg.version }
        } catch {
            continue
        }
    }

    return null
}

function isVersionAtLeast(version, minVersion) {
    if (!version) return false

    const clean = v => v.replace(/^\^|~/, '').split('-')[0]
    const a = clean(version).split('.').map(Number)
    const b = clean(minVersion).split('.').map(Number)

    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const ai = a[i] || 0
        const bi = b[i] || 0
        if (ai > bi) return true
        if (ai < bi) return false
    }

    return true
}

/**
 * Cek dukungan native PTV pada instance socket yang diberikan.
 * @param {object} sock
 * @returns {{ supported: boolean, reason: string, pkg: object|null }}
 */
export function detectNativePTVSupport(sock) {
    const pkg = getInstalledBaileysVersion()

    if (!pkg) {
        return {
            supported: false,
            reason: 'Paket baileys tidak terdeteksi di node_modules, tidak bisa memastikan dukungan native.',
            pkg: null
        }
    }

    const MIN_SUPPORTED_VERSION = '6.6.0'
    const versionOk = isVersionAtLeast(pkg.version, MIN_SUPPORTED_VERSION)

    const hasUploadCapability =
        typeof sock?.waUploadToServer === 'function' ||
        typeof sock?.sendMessage === 'function'

    return {
        supported: versionOk && hasUploadCapability,
        reason: versionOk
            ? 'Versi baileys mendukung opsi native ptv.'
            : `Versi baileys (${pkg.version}) di bawah ambang minimum (${MIN_SUPPORTED_VERSION}), disarankan pakai fallback raw proto.`,
        pkg
    }
}

/* ------------------------------------------------------------------ */
/* 2. JALUR NATIVE                                                     */
/* ------------------------------------------------------------------ */

async function sendViaNative(sock, jid, videoBuffer, options = {}) {
    return sock.sendMessage(
        jid,
        {
            video: videoBuffer,
            mimetype: 'video/mp4',
            ptv: true,
            ...(options.caption ? { caption: options.caption } : {}),
            ...(options.seconds ? { seconds: options.seconds } : {})
        },
        options.messageOptions || {}
    )
}

/* ------------------------------------------------------------------ */
/* 3. JALUR FALLBACK (RAW PROTO)                                       */
/* ------------------------------------------------------------------ */

/**
 * Bangun & kirim videoMessage dengan flag ptv secara manual,
 * untuk kasus di mana opsi `ptv: true` di sendMessage tidak
 * dikenali oleh versi library yang terpasang.
 *
 * Membutuhkan sock.generateWAMessageFromContent atau fungsi
 * setara, plus sock.waUploadToServer (dipakai baileys secara
 * internal saat generateWAMessage memproses `video: buffer`).
 *
 * Strategi paling stabil untuk fallback adalah:
 * 1. Panggil sock.sendMessage() apa adanya (tanpa ptv) — ini
 *    memastikan upload media berjalan lewat jalur resmi library.
 * 2. Ambil pesan yang baru terkirim, sisipkan flag ptv=true ke
 *    dalam videoMessage pada proto, lalu relay ulang sebagai
 *    edit/replace jika library mendukung, ATAU kirim ulang
 *    sebagai pesan baru dengan proto yang sudah dimodifikasi.
 *
 * Karena setiap fork baileys punya sedikit perbedaan struktur,
 * fungsi ini menerima `patchContent` opsional agar pengguna bisa
 * menyesuaikan bentuk payload sesuai fork yang mereka pakai.
 */
async function sendViaFallback(sock, jid, videoBuffer, options = {}) {
    if (typeof sock.sendMessage !== 'function') {
        throw new Error(
            'nano-payload: sock.sendMessage tidak tersedia, tidak bisa melakukan fallback upload media.'
        )
    }

    // Kirim video biasa dulu agar proses upload & enkripsi media
    // ditangani sepenuhnya oleh library (paling aman lintas-fork).
    const baseMessage = await sock.sendMessage(
        jid,
        {
            video: videoBuffer,
            mimetype: 'video/mp4',
            ...(options.caption ? { caption: options.caption } : {})
        },
        options.messageOptions || {}
    )

    // Tandai proto videoMessage sebagai PTV secara manual.
    const videoMsg =
        baseMessage?.message?.videoMessage

    if (videoMsg) {
        videoMsg.ptv = true
    }

    // Jika library menyediakan cara relay ulang pesan yang sudah
    // dimodifikasi (mis. sock.relayMessage), pakai itu supaya
    // penerima menerima versi dengan flag ptv aktif.
    if (typeof sock.relayMessage === 'function' && baseMessage?.key) {
        try {
            await sock.relayMessage(jid, baseMessage.message, {
                messageId: baseMessage.key.id
            })
        } catch (error) {
            // Relay ulang gagal bukan berarti pengiriman awal gagal —
            // pesan video biasa tetap terkirim, hanya saja flag ptv
            // mungkin tidak ter-apply di semua klien penerima.
            console.warn(
                '[nano-payload] Fallback relay gagal, video tetap terkirim tanpa jaminan flag ptv:',
                error.message
            )
        }
    }

    // Terapkan patch tambahan dari pengguna jika disediakan
    // (berguna untuk fork dengan struktur proto berbeda).
    if (typeof options.patchContent === 'function') {
        await options.patchContent(baseMessage, sock, jid)
    }

    return baseMessage
}

/* ------------------------------------------------------------------ */
/* 4. ENTRY POINT PUBLIK                                                */
/* ------------------------------------------------------------------ */

/**
 * Kirim Video Note (PTV) ke sebuah JID, dengan auto-detect
 * dukungan native lalu fallback ke raw proto bila perlu.
 *
 * @param {object} sock - instance socket baileys yang sudah connect
 * @param {string} jid - tujuan (grup, personal, atau @newsletter)
 * @param {Buffer|string} video - Buffer video, atau path file (akan dibaca otomatis)
 * @param {object} [options]
 * @param {string} [options.caption] - caption opsional
 * @param {number} [options.seconds] - durasi video dalam detik (opsional, dipakai jalur native)
 * @param {object} [options.messageOptions] - opsi tambahan diteruskan ke sendMessage (mis. { quoted })
 * @param {function} [options.patchContent] - callback untuk menyesuaikan proto pada jalur fallback
 * @param {boolean} [options.forceFallback] - paksa pakai jalur fallback walau native terdeteksi didukung
 * @returns {Promise<{ result: object, mode: 'native'|'fallback', detection: object }>}
 */
export async function sendPTV(sock, jid, video, options = {}) {
    if (!sock || typeof sock.sendMessage !== 'function') {
        throw new Error('nano-payload: parameter sock tidak valid (harus instance socket baileys).')
    }

    if (!jid) {
        throw new Error('nano-payload: jid tujuan wajib diisi.')
    }

    let videoBuffer = video

    if (typeof video === 'string') {
        if (!fs.existsSync(video)) {
            throw new Error(`nano-payload: file video tidak ditemukan di path "${video}".`)
        }
        videoBuffer = fs.readFileSync(video)
    }

    if (!Buffer.isBuffer(videoBuffer)) {
        throw new Error('nano-payload: parameter video harus berupa Buffer atau path file yang valid.')
    }

    const detection = detectNativePTVSupport(sock)

    if (detection.supported && !options.forceFallback) {
        try {
            const result = await sendViaNative(sock, jid, videoBuffer, options)
            return { result, mode: 'native', detection }
        } catch (error) {
            console.warn(
                '[nano-payload] Jalur native gagal, mencoba fallback raw proto:',
                error.message
            )
            const result = await sendViaFallback(sock, jid, videoBuffer, options)
            return { result, mode: 'fallback', detection }
        }
    }

    const result = await sendViaFallback(sock, jid, videoBuffer, options)
    return { result, mode: 'fallback', detection }
}

export default {
    sendPTV,
    detectNativePTVSupport
}
