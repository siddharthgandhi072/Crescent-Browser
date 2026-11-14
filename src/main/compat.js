'use strict'
// Site compatibility. Some sites (Google sign-in above all) refuse
// browsers they don't recognise as Chrome, Safari or Firefox.
//  - Everywhere: present the "Google Chrome" brand in client hints, like Chrome.
//  - Google's sign-in page: present as Firefox, which Google always allows.
//    (The same approach other Chromium-based browsers like Min use.)

const FIREFOX_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0'

function isGoogleAuth(url) {
  return /^https:\/\/accounts\.google\.com\//.test(url)
}

function brandsHeader() {
  const major = process.versions.chrome.split('.')[0]
  return `"Chromium";v="${major}", "Google Chrome";v="${major}", "Not.A/Brand";v="99"`
}

let gpc = true
function setGpc(on) { gpc = on }

function install(session) {
  const brands = brandsHeader()
  session.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, cb) => {
    const h = details.requestHeaders
    if (isGoogleAuth(details.url)) {
      for (const k of Object.keys(h)) if (/^user-agent$/i.test(k)) delete h[k]
      h['User-Agent'] = FIREFOX_UA
      for (const k of Object.keys(h)) if (/^sec-ch-ua/i.test(k)) delete h[k]
    } else {
      for (const k of Object.keys(h)) if (/^sec-ch-ua$/i.test(k)) h[k] = brands
    }
    if (gpc) h['Sec-GPC'] = '1' // Global Privacy Control: "don't sell or share my data"
    cb({ requestHeaders: h })
  })
}

module.exports = { install, setGpc, FIREFOX_UA, isGoogleAuth }
