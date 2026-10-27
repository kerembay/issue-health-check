// Jest tüm testlerden önce bu dosyayı bir kez çalıştırır.
// Forge fonksiyonları UTC saat diliminde çalışır. Tarih kontrolleri (due date,
// recently updated) "bugün" ve "gün farkı" hesaplarken sunucunun saat dilimini
// kullandığı için testleri de UTC'ye sabitliyoruz. Böylece testler hem
// production ile aynı koşulda çalışır hem de geliştiricinin bilgisayarındaki
// saat diliminden bağımsız olarak her yerde aynı sonucu verir.
module.exports = async () => {
  process.env.TZ = 'UTC';
};
