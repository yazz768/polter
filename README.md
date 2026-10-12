# Polter VPN — folder siap dijalankan

Folder ini adalah salinan aplikasi bisnis, bukan instalasi VPS yang sudah aktif.

## Menjalankan di laptop

1. Buka terminal di folder `Fix` dengan Node.js 24 atau lebih baru.
2. Jalankan `npm.cmd ci --omit=dev` sekali untuk menginstal komponen aplikasi.
3. Hentikan server dari folder VPN lama dengan Ctrl+C sebelum menjalankan salinan ini.
4. Jalankan `npm.cmd start`, lalu buka http://127.0.0.1:3000.
5. Versi ramah pemula tersedia di http://127.0.0.1:3000/alter/ dan admin di http://127.0.0.1:3000/admin.

Konfigurasi saat disalin masih memakai tunnel API Marzban di port lokal 18000. Jalankan tunnel dari proyek lama atau gunakan Bitvise. Kunci SSH tidak disertakan di folder ini.

## Isi folder

- `public/`: website utama dan halaman admin.
- `alter/`: versi website yang menonjolkan bantuan untuk pemula.
- `src/commerce/`: backend pesanan, admin, Marzban, dan pembayaran.
- `data/`: snapshot database produksi dan login admin yang sudah ada.
- `.env`: konfigurasi rahasia yang disalin dari proyek asal.
- `.env.example`: contoh konfigurasi.
- `index.js`, `package.json`, `package-lock.json`: menjalankan dan menginstal aplikasi.
- `.gitignore`: mencegah konfigurasi dan data rahasia masuk Git.

Tes, demo, simulasi, arsip, screenshot, kunci SSH, backup lama, dan node_modules tidak disertakan. Modul Tripay tetap ada karena masih diimpor backend, tetapi pengaktifan pembayaran mengikuti konfigurasi yang ada.

## Data dan pembayaran

Database adalah snapshot saat folder dibuat, bukan sinkronisasi otomatis dengan folder VPN asal. Pilih satu folder untuk operasional; jangan jalankan dua salinan untuk melayani pesanan. Jika masih menerima pesanan di proyek asal, data terbaru perlu dimigrasikan sebelum memakai salinan ini.

Pembayaran tetap diperiksa admin di GoPay. Setelah dikonfirmasi, sistem membuat akun VPN dan menyediakan QR. Salinan ini memakai konfigurasi produksi, bukan demo.

Jangan membagikan folder ini: `.env` dan `data/` berisi informasi rahasia. Backup baru dibuat otomatis ketika aplikasi berjalan.

## Jika dipindahkan ke VPS

Gunakan Node.js 24+, instal dengan `npm ci --omit=dev`, sesuaikan alamat Marzban di `.env` ke API lokal VPS, lalu siapkan systemd dan domain HTTPS. Penyiapan VPS tersebut belum dilakukan oleh pembuatan folder ini. Jangan menimpa database yang lebih baru dengan snapshot ini.
