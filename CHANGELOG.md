# Değişiklik günlüğü

Daemontty'nin her sürümünde kullanıcıyı ilgilendiren değişiklikler. En yeni sürüm en üsttedir.
Son sürümü [Releases sayfasından](https://github.com/YunusEmreGok/daemontty/releases/latest) indirebilirsiniz.

## Yayınlanmamış

### Eklendi
- **Renksiz sunucular artık renkli.** Debian/Ubuntu'da root gibi renksiz gelen bash/zsh oturumlarında istem ve `ls`/`grep` çıktısı o oturum için renklendirilir. Sunucudaki dosyalara dokunulmaz; kendi renkli isteminiz (starship, oh-my-zsh…) varsa değiştirilmez. Ayarlar → Davranış'tan kapatılabilir.

### İyileştirildi
- Terminal çubuğu yenilendi: host'un renkli avatarı ve köşesinde durum ışığı, tek kapsülde toplanmış CPU/RAM/disk/yük ölçerleri, çerçevesiz düğmeler. "Bağlı" rozeti kalktı; rozet yalnızca bağlanırken ya da bağlantı yokken görünür.
- Bağlantı kurulunca "bağlanılıyor…" adımları ekrandan silinir; oturum sunucunun karşılama metniyle temiz başlar. Bağlantı başarısız olursa adımlar yerinde kalır.

## [0.1.5] — 2026-09-21

### Eklendi
- "Yeni sürüm var" penceresi artık o sürümde nelerin değiştiğini gösterir.
- Ayarlar → Hakkında'ya bu günlüğü açan **Yenilikler** düğmesi.

### İyileştirildi
- İndirme boyutu küçüldü: macOS paketi 143 MB'tan 123 MB'a, kurulu boyut 322 MB'tan 253 MB'a indi. Arayüz kütüphaneleri pakete iki kez giriyordu; ayrıca yalnızca Türkçe ve İngilizce dil dosyaları bırakıldı.

## [0.1.4] — 2026-09-21

### Eklendi
- **Servis paneli.** Terminal çubuğundaki "Servisler" düğmesi, bağlı sunucunun systemd servislerini ve Docker kapsayıcılarını listeler; hatalı olanlar en üstte görünür. Tek tıkla başlat, durdur, yeniden başlat. Yetki gerekiyorsa sudo parolası sorulur (kaydedilmez, oturum boyunca bellekte tutulur). `journalctl` ve `docker logs` çıktısı panelde canlı akar.
- **Yerel terminal.** `⌘T` / `Ctrl+Shift+T` ya da sekme çubuğundaki `+` ile kendi bilgisayarınızda kabuk açılır.
- **Uygulama kilidi.** Ayarlar → Güvenlik'ten ana parola belirlenebilir. Uygulama açılışta, boşta kalınca ve ekran kilitlenince parola sorar; macOS'ta Touch ID ile de açılır. Verileriniz diskte ayrıca bu parolayla şifrelenir. `⌘⇧L` / `Ctrl+Shift+L` ile hemen kilitlenir.
- **SFTP'de dosya düzenleme.** Dosyaya çift tıklayınca yerleşik düzenleyicide açılır, `⌘S` / `Ctrl+S` sunucuya kaydeder. Dosya bu arada başkası tarafından değiştirildiyse üzerine yazmadan önce sorar.
- **Parametreli snippet'ler.** `systemctl restart {{servis}}` yazın, çalıştırırken sorulsun; `{{satır:100}}` ile varsayılan değer verin.
- Bir snippet'i bir grubun tüm sunucularında tek seferde çalıştırma: bağlı olmayanlar için sekme açılır, bağlantı kurulunca komut çalışır.
- **Oturum kaydı.** Ayarlar → Davranış'tan açılır; terminal çıktısı sunucu başına klasörlere düz metin olarak yazılır.
- Tünellerde "Açılışta başlat" seçeneği.
- Sekmeleri sürükleyerek sıralama.

### Düzeltildi
- GPU çizimi açıkken bağlantısı kopan oturumda "Yeniden bağlan" düğmesine fareyle tıklanamıyordu.

## [0.1.3] — 2026-09-21

### Değişti
- Güncellemeler artık kendiliğinden inmez. Yeni sürüm çıkınca uygulama sorar; "şimdi değil" derseniz üst çubukta **Yeni sürüm mevcut** düğmesi kalır.

### Eklendi
- macOS'ta uygulama içinden güncelleme: yeni sürüm indirilir, sha512 özetiyle doğrulanır ve yeniden başlatırken kurulur. Önceki sürümler indirme sayfasını açıyordu.

## [0.1.2] — 2026-09-21

### Değişti
- Ana sekmenin adı "Kasa" yerine **Sunucular**, sol alttaki rozet "Kasa şifreli" yerine **Veriler şifreli** oldu.

## [0.1.1] — 2026-09-21

### Eklendi
- Windows kurulum paketi. 0.1.0'da yalnızca macOS ve Linux paketleri yayınlanabilmişti.

## [0.1.0] — 2026-09-21

İlk genel sürüm.

### Eklendi
- SSH terminali: GPU hızlandırmalı çizim, bölünmüş ekran (4 panele kadar), tüm panellere aynı anda yazma, akıllı otomatik tamamlama, otomatik yeniden bağlanma, canlı sunucu durumu (CPU, RAM, disk, yük).
- Host yönetimi: gruplar, etiketler, jump host, `~/.ssh/config` içe aktarma, host'a özel tema, komut paleti.
- Çift panelli SFTP dosya yöneticisi; sunucudan sunucuya kopyalama.
- Anahtar zinciri: Ed25519, RSA, ECDSA anahtar üretimi, kimlikler, bilinen sunucular.
- Port yönlendirme: yerel, uzak ve dinamik (SOCKS5) tüneller.
- Snippet'ler, 13 tema ve tema düzenleyici, parolalı şifreli yedekleme.
- GitHub Releases üzerinden uygulama içi güncelleme.

### İyileştirildi
- Bellek kullanımı: gizli sekmeler artık GPU belleği tutmuyor. 8 sekme açıkken toplam bellek 700 MB'tan 317 MB'a indi.

[0.1.5]: https://github.com/YunusEmreGok/daemontty/releases/tag/v0.1.5
[0.1.4]: https://github.com/YunusEmreGok/daemontty/releases/tag/v0.1.4
[0.1.3]: https://github.com/YunusEmreGok/daemontty/releases/tag/v0.1.3
[0.1.2]: https://github.com/YunusEmreGok/daemontty/releases/tag/v0.1.2
[0.1.1]: https://github.com/YunusEmreGok/daemontty/releases/tag/v0.1.1
[0.1.0]: https://github.com/YunusEmreGok/daemontty/releases/tag/v0.1.0
