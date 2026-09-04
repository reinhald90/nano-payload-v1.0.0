# nano-payload

Universal PTV (Video Note) payload builder untuk WhatsApp bot berbasis [Baileys](https://github.com/WhiskeySockets/Baileys) dan fork-forknya.

Banyak fork/versi baileys yang belum (atau tidak konsisten) mendukung opsi `ptv: true` pada `sendMessage`. `nano-payload` mendeteksi otomatis dukungan tersebut, dan kalau tidak tersedia, akan fallback ke pengiriman video biasa lalu menandai proto `videoMessage` sebagai PTV secara manual.

Dibuat oleh **Azure Ashiro** untuk komunitas **Lycount**.

## Instalasi

```bash
npm install nano-payload
```

Package ini butuh `@whiskeysockets/baileys` (atau fork sejenis) sudah terpasang di project kamu sebagai peer — nano-payload tidak membawa baileys sendiri.

## Pemakaian dasar

```js
import { sendPTV } from 'nano-payload'

const { result, mode } = await sendPTV(sock, jid, '/path/ke/video.mp4', {
    caption: 'Halo dari nano-payload!'
})

console.log('Terkirim lewat mode:', mode) // 'native' atau 'fallback'
```

Atau dengan Buffer langsung:

```js
import fs from 'fs'
import { sendPTV } from 'nano-payload'

const buffer = fs.readFileSync('./video.mp4')
await sendPTV(sock, jid, buffer)
```

## Opsi

| Opsi | Tipe | Keterangan |
|---|---|---|
| `caption` | `string` | Caption opsional untuk video |
| `seconds` | `number` | Durasi video (dipakai jalur native) |
| `messageOptions` | `object` | Diteruskan langsung ke `sock.sendMessage` (mis. `{ quoted }`) |
| `patchContent` | `function` | Callback `(baseMessage, sock, jid) => {}` untuk menyesuaikan proto pada jalur fallback — berguna untuk fork dengan struktur berbeda |
| `forceFallback` | `boolean` | Paksa pakai jalur fallback walau native terdeteksi didukung |

## Cek dukungan native secara manual

```js
import { detectNativePTVSupport } from 'nano-payload'

const info = detectNativePTVSupport(sock)
console.log(info)
// { supported: true, reason: '...', pkg: { name: '@whiskeysockets/baileys', version: '6.7.x' } }
```

## Cara kerja singkat

1. Deteksi versi baileys yang terpasang (via `package.json`-nya) dan cek apakah kemungkinan mendukung opsi native `ptv`.
2. Kalau didukung → kirim langsung pakai `sendMessage({ ptv: true })`.
3. Kalau tidak didukung, atau jalur native gagal saat dicoba → kirim video biasa (supaya proses upload & enkripsi media tetap ditangani library secara resmi), lalu tandai `videoMessage.ptv = true` pada proto dan relay ulang.

## Batasan

- Ini adalah lapisan kompatibilitas, bukan cara memaksa WhatsApp menerima PTV di tempat yang secara resmi tidak didukung.
- Jalur fallback tetap bergantung pada fungsi upload media generik dari library (`sock.sendMessage` / `sock.waUploadToServer`). Kalau library benar-benar tidak menyediakan itu, tidak ada yang bisa dilakukan dari sisi nano-payload.
- Perilaku bisa sedikit berbeda antar fork baileys karena struktur proto yang tidak selalu identik — gunakan `patchContent` untuk menyesuaikan kalau perlu.

## Lisensi

MIT © Azure Ashiro
