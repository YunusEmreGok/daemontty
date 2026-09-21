// İki iş yapar:
//   node scripts/surum-notu.cjs            → `npm version` sırasında: "Yayınlanmamış" bölümünü yeni sürüm olarak tarihler
//   node scripts/surum-notu.cjs notlar X   → CI'da: X sürümünün notlarını yazdırır (GitHub sürüm sayfası için)
const fs = require('fs')
const path = require('path')
const file = path.join(__dirname, '..', 'CHANGELOG.md')
const text = fs.readFileSync(file, 'utf8')

/** "## başlık" satırından bir sonraki "## " ya da bağlantı listesine kadar olan gövde */
function section(heading) {
  const start = text.indexOf(`\n## ${heading}`)
  if (start < 0) return null
  const bodyStart = text.indexOf('\n', start + 1) + 1
  const next = text.slice(bodyStart).search(/\n## |\n\[[^\]]+\]: /)
  return { start: start + 1, bodyStart, end: next < 0 ? text.length : bodyStart + next }
}

if (process.argv[2] === 'notlar') {
  const version = String(process.argv[3] || '').replace(/^v/, '')
  const s = section(`[${version}]`)
  process.stdout.write(s ? text.slice(s.bodyStart, s.end).trim() + '\n' : '')
  process.exit(0)
}

const version = require('../package.json').version
const s = section('Yayınlanmamış')
if (!s) throw new Error('CHANGELOG.md içinde "## Yayınlanmamış" bölümü yok')
const body = text.slice(s.bodyStart, s.end).trim()
if (!body) {
  console.error('\n✖ CHANGELOG.md → "Yayınlanmamış" bölümü boş. Bu sürümde ne değiştiğini yazıp yeniden deneyin.\n')
  process.exit(1)
}
const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const link = `[${version}]: https://github.com/YunusEmreGok/daemontty/releases/tag/v${version}\n`
let out = text.slice(0, s.start) + `## Yayınlanmamış\n\n## [${version}] — ${today}\n\n${body}\n` + text.slice(s.end)
const firstLink = out.search(/^\[[^\]]+\]: /m)
out = firstLink < 0 ? out.trimEnd() + '\n\n' + link : out.slice(0, firstLink) + link + out.slice(firstLink)
fs.writeFileSync(file, out)
console.log(`CHANGELOG.md: ${version} — ${today}`)
